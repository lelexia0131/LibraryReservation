import { BookingApi } from '../api/bookingApi.js';
import { HttpClient } from '../api/httpClient.js';
import { ensureToken, validateConfig, type BookingConfig, type TokenProvider } from '../config/config.js';
import { BookingError, redact } from '../errors.js';
import { resolveTargetArea } from './areaResolver.js';
import { resolveTargetDateAndSegment } from './segmentResolver.js';
import { findTargetSeat, validateSeatAvailable } from './seatSelector.js';

export class BookingService {
  private started = false;
  constructor(private readonly tokenProvider: TokenProvider,
    private readonly apiFactory: (token: string) => BookingApi = token => new BookingApi(new HttpClient(token, undefined, undefined,
      () => this.tokenProvider.invalidateToken?.(token) ?? Promise.resolve())),
    private readonly logger: (message: string) => void = console.log) {}

  async runBooking(config: BookingConfig) {
    if (this.started) throw new BookingError('BOOKING_ALREADY_STARTED', 'Create a new service for a new explicit booking attempt.');
    this.started = true;
    validateConfig(config);
    const token = ensureToken(await this.tokenProvider.getToken());
    const log = (message: string) => this.logger(`[Booking] ${redact(message, token)}`);
    try {
      log('Token loaded (hidden).');
      log(`Target date: ${config.targetDate}; target seat: ${config.targetSeat}`);
      const api = this.apiFactory(token);
      const index = await api.fetchReserveIndex();
      log('Resolving area...');
      const area = await resolveTargetArea(api, index, config);
      log(`Area resolved: ${area.name} (id=${area.id})`);
      const dates = await api.fetchSeatDate({ build_id: area.id });
      const segment = resolveTargetDateAndSegment(dates, config.targetDate, config.startTime, config.endTime);
      log(`Segment resolved: ${segment.id}; available window: ${segment.start}-${segment.end}`);
      const seats = await api.fetchSeatList({ area: area.id, segment: segment.id, day: config.targetDate, startTime: config.startTime, endTime: config.endTime });
      const seat = findTargetSeat(seats, config.targetSeat);
      if (seat.area !== undefined && seat.area !== area.id) throw new BookingError('SEAT_AREA_MISMATCH', 'The returned seat belongs to a different area.');
      log(`Seat ${seat.no}: id=${seat.id}, status=${seat.status}, status_name=${seat.status_name ?? '(missing)'}`);
      validateSeatAvailable(seat);
      const params = { seatId: seat.id, segment: segment.id };
      const plan = { day: config.targetDate, area: area.name, areaId: area.id, seat: seat.no, seatId: seat.id,
        segment: segment.id, startTime: config.startTime, endTime: config.endTime };
      if (config.dryRun) {
        const prepared = api.prepareConfirm(params);
        log(`AES key date: ${prepared.encryptionDate}; aesjson generated (hidden).`);
        log(`Dry-run plan: ${JSON.stringify(plan)}; confirm not sent.`);
        return { dryRun: true as const, plan, encryptionDate: prepared.encryptionDate };
      }
      log('Submitting one confirm request...');
      const result = await api.confirmSeat(params);
      log(result.success ? 'Booking succeeded.' : `Booking failed (code=${result.code}).`);
      return { dryRun: false as const, plan, result };
    } catch (error) {
      if (error instanceof BookingError) throw new BookingError(error.code, redact(error.message, token));
      throw new BookingError('UNEXPECTED_ERROR', 'Unexpected booking failure; request details withheld.');
    }
  }
}
