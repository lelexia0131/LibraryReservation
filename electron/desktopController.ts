import type { AuthManager } from '../src/auth/AuthManager.js';
import type { BookingWebSessionBootstrap } from '../src/auth/BookingWebSessionBootstrap.js';
import { BookingService } from '../src/domain/BookingService.js';
import { isDay, isTime, type BookingConfig } from '../src/config/config.js';
import { BookingError } from '../src/errors.js';
import type { PublicAuthStatus, QueryResult, Reply } from './contracts.js';

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
  TARGET_BUILDING_NOT_UNIQUE: '未找到该馆舍，请填写官网上的完整馆舍名称。',
  TARGET_AREA_AMBIGUOUS: '找到多个区域，请补全馆舍、楼层和区域。',
  TARGET_AREA_NOT_FOUND: '未找到该区域，请检查馆舍、楼层和区域名称。',
  TARGET_SEAT_NOT_FOUND: '该区域没有此座位，请检查座位号。', TARGET_SEAT_NOT_UNIQUE: '找到多个同号座位，请核对区域。',
  TARGET_DATE_NOT_UNIQUE: '该日期暂不可查询，请更换日期。',
  SEGMENT_AMBIGUOUS: '该时段对应多个开放时间，请缩小查询时间范围。',
  SEGMENT_UNAVAILABLE: '该时段暂未开放，请调整开始和结束时间。',
  TARGET_SEAT_AMBIGUOUS: '找到多个同号座位，请核对区域。',
  SEAT_STATUS_CHANGED: '座位状态正在变化，请重新查询。',
  SEAT_AREA_MISMATCH: '座位与区域不匹配，请核对查询条件。',
  PAGINATION_CHANGED: '可查询区域已变化，请重新查询。',
  PAGINATION_LIMIT: '查询范围过大，请填写馆舍名称。',
  HTTP_ERROR: '查询服务连接失败，请检查网络或重新登录。',
  RESPONSE_SCHEMA_CHANGED: '图书馆返回了暂不支持的数据，请稍后重试。',
  REAL_CONFIRM_DISABLED: '当前仅支持测试查询。', FORBIDDEN: '无法执行此操作，请重新打开应用。',
};

export function safeError(error: unknown): Reply<never> {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    && Object.hasOwn(messages, error.code) ? error.code : 'UNEXPECTED_ERROR';
  return { ok: false, error: { code, message: messages[code] ?? '操作未完成，请稍后重试。' } };
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
  constructor(private readonly auth: Pick<AuthManager, 'getStatus' | 'getToken' | 'logout'>,
    private readonly website: Pick<BookingWebSessionBootstrap, 'openBookingWebsite'>,
    private readonly createService = () => new BookingService(auth, undefined, () => {})) {}

  status(): PublicAuthStatus { return { state: this.auth.getStatus().state }; }
  async login(): Promise<PublicAuthStatus> { return this.exclusive(async () => { await this.auth.getToken(); return this.status(); }); }
  async logout(): Promise<PublicAuthStatus> { return this.exclusive(async () => { await this.auth.logout(); return this.status(); }); }
  async openWebsite(): Promise<void> { return this.exclusive(() => this.website.openBookingWebsite()); }
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
