import type { BookingResult, Area } from '../api/types.js';
import { BookingError } from '../errors.js';
import { AvailabilityService, checkStopped, isUnavailablePeriod, matchesScope, type Period, type Scope } from './AvailabilityService.js';
import type { ReservationService } from './ReservationService.js';

export type AutoMode = 'main' | 'all' | 'custom';
export type AutoState = 'IDLE' | 'SCANNING' | 'WAITING' | 'FOUND' | 'RESERVING' | 'SUCCESS' | 'FAILED' | 'STOPPED';
export interface MonitorStatus { state: AutoState; mode?: AutoMode; retryAt?: number; result?: BookingResult; area?: Area; error?: unknown }
export interface AutoRequest extends Period { mode: AutoMode; scopes: Scope[] }
const MAX_TIMER = 2_147_000_000;
export function waitForPoll(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    let remaining = ms;
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const next = () => {
      const chunk = Math.min(remaining, MAX_TIMER); remaining -= chunk;
      timer = setTimeout(remaining > 0 ? next : finish, chunk);
    };
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish(); else next();
  });
}

export class AutoSelectMonitor {
  private status: MonitorStatus = { state: 'IDLE' };
  private flight?: Promise<void>;
  private controller?: AbortController;
  constructor(private readonly create: (signal: AbortSignal) => Promise<{ discovery: AvailabilityService; reservation: ReservationService }>,
    private readonly onError: (error: unknown) => void = () => {},
    private readonly sleep = waitForPoll, private readonly intervalMs = 15000) {
    if (!Number.isFinite(intervalMs) || intervalMs < 10000) throw new BookingError('INVALID_INTERVAL', '');
  }
  getStatus(): MonitorStatus { return { ...this.status }; }
  get running(): boolean { return this.flight !== undefined; }
  start(request: AutoRequest): void {
    if (this.flight) throw new BookingError('BUSY', '');
    this.controller = new AbortController();
    this.status = { state: 'SCANNING', mode: request.mode };
    this.flight = this.run(request, this.controller.signal).finally(() => { this.flight = undefined; });
  }
  async stop(): Promise<void> {
    this.controller?.abort();
    await this.flight;
    if (!['SUCCESS', 'FAILED', 'IDLE'].includes(this.status.state)) this.status = { state: 'STOPPED', mode: this.status.mode };
  }
  private async run(request: AutoRequest, signal: AbortSignal): Promise<void> {
    let failures = 0;
    try {
      const { discovery, reservation } = await this.create(signal);
      while (!signal.aborted) {
        let wait = this.intervalMs;
        this.status = { state: 'SCANNING', mode: request.mode };
        try {
          const areas = (await discovery.areas(request, request.mode === 'main' ? '主馆' : undefined))
            .filter(area => request.mode !== 'custom' || request.scopes.some(scope => matchesScope(area, scope)));
          for (const area of areas) {
            checkStopped(signal);
            if (area.freeCount === 0) continue;
            let free;
            try { free = await discovery.freeSeats(area, request); }
            catch (error) { if (isUnavailablePeriod(error)) continue; throw error; }
            const candidate = free.seats[0];
            if (!candidate) continue;
            this.status = { state: 'FOUND', mode: request.mode };
            checkStopped(signal);
            this.status = { state: 'RESERVING', mode: request.mode };
            let result: BookingResult;
            try { result = await reservation.reserve(area, candidate.no, request, signal); }
            catch (error) {
              // These errors precede confirm. No unverified server business code is retried.
              if (error instanceof BookingError && error.stage !== 'confirm'
                && ['TARGET_SEAT_UNAVAILABLE', 'SEAT_STATUS_CHANGED', 'TARGET_SEAT_NOT_FOUND'].includes(error.code)) break;
              throw error;
            }
            this.status = { state: result.success ? 'SUCCESS' : 'FAILED', mode: request.mode, result, area };
            return;
          }
          failures = 0;
        } catch (error) {
          if (signal.aborted && !(error instanceof BookingError && error.stage === 'confirm')) break;
          if (!(error instanceof BookingError) || error.stage === 'confirm'
            || !(error.httpStatus === 429 || error.transient)) throw error;
          wait = Math.max(10000, error.httpStatus === 429 && error.retryAfterMs !== undefined
            ? error.retryAfterMs : Math.min(120000, 30000 * 2 ** failures));
          failures++;
          this.onError(error);
        }
        checkStopped(signal);
        this.status = { state: 'WAITING', mode: request.mode, retryAt: Date.now() + wait };
        await this.sleep(wait, signal);
      }
      this.status = { state: 'STOPPED', mode: request.mode };
    } catch (error) {
      if (signal.aborted && !(error instanceof BookingError && error.stage === 'confirm' && error.code !== 'STOPPED')) {
        this.status = { state: 'STOPPED', mode: request.mode };
      } else { this.onError(error); this.status = { state: 'FAILED', mode: request.mode, error }; }
    }
  }
}
