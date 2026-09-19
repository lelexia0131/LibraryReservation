import type { AuthManager } from '../src/auth/AuthManager.js';
import type { BookingWebSessionBootstrap } from '../src/auth/BookingWebSessionBootstrap.js';
import { BookingService } from '../src/domain/BookingService.js';
import { isDay, isTime, type BookingConfig } from '../src/config/config.js';
import { atStage, BookingError, redact, type OperationStage } from '../src/errors.js';
import { BookingApi } from '../src/api/bookingApi.js';
import { HttpClient } from '../src/api/httpClient.js';
import type { Area, BookingResult } from '../src/api/types.js';
import { AvailabilityService, locationOf, type Location, type Period, type Scope } from '../src/domain/AvailabilityService.js';
import { ReservationService } from '../src/domain/ReservationService.js';
import { AutoSelectMonitor, type AutoRequest } from '../src/domain/AutoSelectMonitor.js';
import { ConfirmationAuthority } from './ConfirmationAuthority.js';
import type { AvailabilityView, AutoView, PublicAuthStatus, QueryResult, Reply, ReservationView, SeatsView } from './contracts.js';

const messages: Record<string, string> = {
  INVALID_DATE: '请选择有效的查询日期。', INVALID_SEAT: '请填写座位号。',
  INVALID_TIME: '请检查时间，结束时间必须晚于开始时间。', INVALID_INPUT: '查询条件有误，请检查后重试。',
  BUSY: '当前操作尚未完成，请稍候。', LOGIN_REQUIRED: '请先登录浙江大学账号。',
  AUTH_CANCELLED: '已取消登录。', AUTH_FAILED: '登录失败，请重试。',
  CAS_NAVIGATION_FAILED: '登录页面无法打开，请检查网络连接。', CAS_SILENT_TIMEOUT: '登录检查超时，请检查网络后重试。',
  CAS_LOGIN_TIMEOUT: '登录已超时，请重新登录。', CAS_TOKEN_EXCHANGE_FAILED: '登录未完成，请重新登录。',
  TOKEN_EXPIRY_INVALID: '登录已失效，请重新登录。',
  SECURE_STORAGE_UNAVAILABLE: '系统无法安全保存登录状态，请重新启动应用。',
  TOKEN_STORE_WRITE_FAILED: '登录状态保存失败，请检查磁盘空间后重试。',
  TOKEN_STORE_READ_FAILED: '登录状态读取失败，请重新登录。', AUTH_CLEAR_FAILED: '退出未完成，请再次退出登录。',
  WEB_BOOTSTRAP_FAILED: '图书馆页面打开失败，请重试。',
  TARGET_BUILDING_NOT_UNIQUE: '未找到该馆舍，请刷新位置。',
  TARGET_AREA_AMBIGUOUS: '位置数据存在重名，请刷新位置。',
  TARGET_AREA_NOT_FOUND: '该位置已变化，请刷新位置。',
  TARGET_SEAT_NOT_FOUND: '该座位已变化，请重新选择。', TARGET_SEAT_NOT_UNIQUE: '找到多个同号座位，请重新选择位置。',
  TARGET_DATE_NOT_UNIQUE: '该日期暂不可查询，请更换日期。',
  SEGMENT_AMBIGUOUS: '该时段对应多个开放时间，请缩小查询时间范围。',
  SEGMENT_UNAVAILABLE: '该时段暂未开放，请调整开始和结束时间。',
  TARGET_SEAT_AMBIGUOUS: '找到多个同号座位，请核对区域。',
  SEAT_STATUS_CHANGED: '座位状态正在变化，请重新查询。',
  SEAT_AREA_MISMATCH: '座位与区域不匹配，请核对查询条件。',
  PAGINATION_CHANGED: '可查询区域已变化，请重新查询。',
  PAGINATION_LIMIT: '位置加载范围过大，请稍后重试。',
  HTTP_ERROR: '查询服务连接失败，请检查网络或重新登录。',
  RESPONSE_SCHEMA_CHANGED: '图书馆返回了暂不支持的数据，请稍后重试。',
  REAL_CONFIRM_DISABLED: '当前仅支持测试查询。', FORBIDDEN: '无法执行此操作，请重新打开应用。',
  API_BUSINESS_ERROR: '图书馆未能完成本次查询，请打开图书馆核对。',
  SEAT_CATEGORY_NOT_FOUND: '普通座位位置暂不可用，请稍后重试。',
  INVALID_TOKEN: '登录已失效，请重新登录。', AUTH_INVALIDATION_FAILED: '登录已失效，请退出后重新登录。',
  TARGET_SEAT_UNAVAILABLE: '该座位刚刚被占用，请重新选择。',
  CONFIRM_OUTCOME_UNKNOWN: '预约结果未知，请在图书馆官网确认。',
  CONFIRM_ALREADY_SENT: '本次预约已提交，请查看预约结果。',
  STOPPED: '已停止。', UNEXPECTED_ERROR: '操作未完成，请稍后重试。',
};

const stages: Record<OperationStage, string> = { auth: '登录检查', 'reserve-index': '加载馆舍', 'reserve-list': '加载位置',
  'seat-date': '读取开放时段', 'seat-list': '读取座位', 'seat-select': '检查所选座位', confirm: '提交预约' };
export function safeError(error: unknown, logger?: (line: string) => void): Reply<never> & { ok: false } {
  const booking = error instanceof BookingError;
  // Application codes are uppercase constants. Never treat arbitrary server text as a code.
  const code = booking ? (/^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) ? error.code : 'BOOKING_ERROR') : 'UNEXPECTED_ERROR';
  const stage = booking && error.stage && Object.hasOwn(stages, error.stage) ? error.stage : undefined;
  const message = booking && error.httpStatus === 401 ? messages.INVALID_TOKEN! : messages[code]
    ?? (stage === 'confirm' ? '预约失败，请打开图书馆确认。' : '查询未完成，请刷新后重试。');
  logger?.(`[Desktop] operation failed code=${code} stage=${stage ?? 'unknown'}`);
  return { ok: false, error: { code, message: stage ? `${stages[stage]}：${message}` : message, ...(stage ? { stage } : {}) } };
}

function objectInput(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new BookingError('INVALID_INPUT', '');
  return value as Record<string, unknown>;
}
function textInput(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\x00-\x1f\x7f]/.test(value)) throw new BookingError('INVALID_INPUT', '');
  return value;
}
export function validatePeriod(input: Record<string, unknown>): Period {
  if (typeof input.day !== 'string' || !isDay(input.day)) throw new BookingError('INVALID_DATE', '');
  if (typeof input.startTime !== 'string' || typeof input.endTime !== 'string' || !isTime(input.startTime)
    || !isTime(input.endTime) || input.startTime >= input.endTime) throw new BookingError('INVALID_TIME', '');
  return { day: input.day, startTime: input.startTime, endTime: input.endTime };
}
function validateScope(value: unknown, full = false): Scope {
  const input = objectInput(value, ['premises', 'floor', 'area']);
  const scope: Scope = { premises: textInput(input.premises) };
  if (input.floor !== undefined || full) scope.floor = textInput(input.floor);
  if (input.area !== undefined || full) { scope.area = textInput(input.area); if (!scope.floor) throw new BookingError('INVALID_INPUT', ''); }
  return scope;
}
const periodKeys = ['day', 'startTime', 'endTime'];
function resultView(result: BookingResult, area: Area, period: Period, no: string): ReservationView {
  return { success: result.success, seat: redact(result.no ?? no), location: Object.values(locationOf(area)).join(' · '),
    period: result.time && /^[\d\s:–—\-年月日/]+$/.test(result.time) ? `${period.day} ${result.time}` : '请在图书馆官网查看', arrival: '暂未获取' };
}

export function validateForm(value: unknown): BookingConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BookingError('INVALID_INPUT', '');
  const input = value as Record<string, unknown>;
  const keys = ['targetDate', 'targetSeat', 'targetBuilding', 'targetFloor', 'targetArea', 'startTime', 'endTime'];
  if (Object.keys(input).some(key => !keys.includes(key))) throw new BookingError('INVALID_INPUT', '');
  for (const key of keys) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || (input[key] as string).length > 100
      || /[\x00-\x1f\x7f]/.test(input[key] as string))) throw new BookingError('INVALID_INPUT', '');
  }
  if (typeof input.targetDate !== 'string' || !isDay(input.targetDate)) throw new BookingError('INVALID_DATE', '');
  if (typeof input.targetSeat !== 'string' || !input.targetSeat.trim()) throw new BookingError('INVALID_SEAT', '');
  if (typeof input.startTime !== 'string' || typeof input.endTime !== 'string' || !isTime(input.startTime)
    || !isTime(input.endTime) || input.startTime >= input.endTime) throw new BookingError('INVALID_TIME', '');
  return { targetDate: input.targetDate, targetSeat: input.targetSeat.trim(), startTime: input.startTime,
    endTime: input.endTime, targetBuilding: (input.targetBuilding as string | undefined)?.trim() || undefined,
    targetFloor: (input.targetFloor as string | undefined)?.trim() || undefined,
    targetArea: (input.targetArea as string | undefined)?.trim() || undefined, dryRun: true };
}

export class DesktopController {
  private busy = false;
  private readonly monitor: AutoSelectMonitor;
  private cache?: { key: string; at: number; value: AvailabilityView };
  private autoPeriod?: Period;
  private action?: AbortController;
  private taskVersion = 0;
  private closed = false;
  constructor(private readonly auth: Pick<AuthManager, 'getStatus' | 'getToken' | 'logout'> & Partial<Pick<AuthManager, 'invalidateToken'>>,
    private readonly website: Pick<BookingWebSessionBootstrap, 'openBookingWebsite'>,
    private readonly createService = () => new BookingService(auth, undefined, () => {}),
    private readonly apiFactory = (token: string, signal: AbortSignal, authority?: ConfirmationAuthority) =>
      new BookingApi(new HttpClient(token, undefined, undefined, () => auth.invalidateToken?.(token) ?? Promise.resolve(), 0), undefined, authority?.consume, signal)) {
    this.monitor = new AutoSelectMonitor(signal => this.services(signal, true), error => { safeError(error, console.warn); });
  }

  status(): PublicAuthStatus { return { state: this.auth.getStatus().state }; }
  async login(): Promise<PublicAuthStatus> { return this.exclusive(async () => { await atStage('auth', () => this.auth.getToken()); return this.status(); }); }
  async logout(): Promise<PublicAuthStatus> {
    this.taskVersion++;
    await this.monitor.stop();
    return this.exclusive(async () => { this.cache = undefined; await atStage('auth', () => this.auth.logout()); return this.status(); });
  }
  async openWebsite(): Promise<void> { return this.exclusive(() => this.website.openBookingWebsite()); }
  private async services(signal: AbortSignal, confirm = false) {
    if (this.closed || signal.aborted) throw new BookingError('STOPPED', '');
    if (this.status().state !== 'AUTHENTICATED') throw new BookingError('LOGIN_REQUIRED', '', 'auth');
    const token = await atStage('auth', () => this.auth.getToken());
    const api = this.apiFactory(token, signal, confirm ? new ConfirmationAuthority(signal) : undefined);
    const discovery = new AvailabilityService(api, signal);
    return { discovery, reservation: new ReservationService(api, discovery) };
  }
  private async foreground<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      if (this.monitor.running) throw new BookingError('BUSY', '');
      this.action = new AbortController();
      try { return await work(this.action.signal); } finally { this.action = undefined; }
    });
  }
  async listAvailability(value: unknown): Promise<AvailabilityView> {
    const input = objectInput(value, [...periodKeys, 'refresh']);
    const period = validatePeriod(input);
    if (input.refresh !== undefined && typeof input.refresh !== 'boolean') throw new BookingError('INVALID_INPUT', '');
    return this.foreground(async signal => {
      const { discovery } = await this.services(signal);
      const key = JSON.stringify(period);
      if (!input.refresh && this.cache?.key === key && Date.now() - this.cache.at < 10000) return this.cache.value;
      const result = await discovery.list(period);
      this.cache = { key, at: Date.now(), value: result };
      return result;
    });
  }
  async listSeats(value: unknown): Promise<SeatsView> {
    const input = objectInput(value, [...periodKeys, 'location']);
    const period = validatePeriod(input), location = validateScope(input.location, true) as Location;
    return this.foreground(async signal => {
      const { discovery } = await this.services(signal);
      const area = await discovery.resolve(period, location);
      const { seats, segment } = await discovery.freeSeats(area, period);
      return { location: locationOf(area), seats: seats.map(seat => seat.no), day: period.day, startTime: segment.start, endTime: segment.end };
    });
  }
  async reserveManual(value: unknown): Promise<ReservationView> {
    const input = objectInput(value, [...periodKeys, 'location', 'seat']);
    const period = validatePeriod(input), location = validateScope(input.location, true) as Location, no = textInput(input.seat);
    return this.foreground(async signal => {
      this.cache = undefined;
      const { discovery, reservation } = await this.services(signal, true);
      const area = await discovery.resolve(period, location);
      const result = await reservation.reserve(area, no, period, signal);
      return resultView(result, area, period, no);
    });
  }
  async startAutoSelect(value: unknown): Promise<AutoView> {
    const input = objectInput(value, [...periodKeys, 'mode', 'scopes']);
    const period = validatePeriod(input);
    if (!['main', 'all', 'custom'].includes(String(input.mode)) || !Array.isArray(input.scopes) || input.scopes.length > 1000) throw new BookingError('INVALID_INPUT', '');
    const scopes = input.scopes.map(scope => validateScope(scope));
    if (input.mode === 'custom' && !scopes.length) throw new BookingError('INVALID_INPUT', '');
    return this.exclusive(async () => {
      const version = ++this.taskVersion;
      await this.monitor.stop();
      if (this.closed || version !== this.taskVersion) throw new BookingError('STOPPED', '');
      if (this.status().state !== 'AUTHENTICATED') throw new BookingError('LOGIN_REQUIRED', '', 'auth');
      this.cache = undefined; this.autoPeriod = period;
      this.monitor.start({ ...period, mode: input.mode as AutoRequest['mode'], scopes });
      return this.autoStatus();
    });
  }
  async stopAutoSelect(): Promise<AutoView> { this.taskVersion++; await this.monitor.stop(); return this.autoStatus(); }
  autoStatus(): AutoView {
    const status = this.monitor.getStatus();
    const labels = { IDLE: '等待开始', SCANNING: '正在寻找空位', WAITING: '暂无空位，继续等待', FOUND: '发现空位',
      RESERVING: '正在预约', SUCCESS: '预约成功', FAILED: '预约失败', STOPPED: '已停止' };
    return { state: status.state, ...(status.mode ? { mode: status.mode } : {}),
      message: status.error ? safeError(status.error).error.message : labels[status.state],
      ...(status.result && status.area && this.autoPeriod ? { result: resultView(status.result, status.area, this.autoPeriod, '') } : {}) };
  }
  async shutdown(): Promise<void> { this.closed = true; this.taskVersion++; this.action?.abort(); await this.monitor.stop(); }
  async query(input: unknown): Promise<QueryResult> {
    const config = validateForm(input);
    return this.exclusive(async () => {
      if (this.status().state !== 'AUTHENTICATED') throw new BookingError('LOGIN_REQUIRED', '');
      try {
        const result = await this.createService().runBooking(config);
        return { available: true, seat: result.plan.seat, area: result.plan.area, day: result.plan.day,
          startTime: result.plan.startTime, endTime: result.plan.endTime };
      } catch (error) {
        if (error instanceof BookingError && error.code === 'TARGET_SEAT_UNAVAILABLE') {
          return { available: false, seat: config.targetSeat, area: config.targetArea ?? '所选区域', day: config.targetDate,
            startTime: config.startTime, endTime: config.endTime };
        }
        throw error;
      }
    });
  }
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) throw new BookingError('BUSY', '');
    this.busy = true;
    try { return await work(); } finally { this.busy = false; }
  }
}
