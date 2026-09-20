import { HttpTransportError, type HttpTransport } from './HttpTransport.js';
import { ensureToken } from '../config/config.js';
import { BookingError } from '../errors.js';

export const BASE_URL = 'https://booking.lib.zju.edu.cn';
const transientCodes = new Set(['ECONNRESET', 'ECONNABORTED', 'ECONNREFUSED', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'ERR_NETWORK']);
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export class HttpClient {
  private readonly authorization?: string;
  constructor(token: string | null, private readonly transport: HttpTransport,
  private readonly sleep: (ms: number) => Promise<unknown> = delay,
  private readonly onUnauthorized?: () => Promise<void>, private readonly queryRetries = 2) {
    this.authorization = token === null ? undefined : `bearer${ensureToken(token)}`;
  }

  async post(path: string, payload: object, options: { authRequired?: boolean; signal?: AbortSignal } = {}): Promise<unknown> {
    if (!/^\/[a-zA-Z0-9/_]+$/.test(path) || path.startsWith('//')) throw new BookingError('INVALID_API_PATH', 'Expected a booking API path.');
    const authRequired = options.authRequired !== false;
    if (authRequired && !this.authorization) throw new BookingError('INVALID_TOKEN', 'Authenticated request requires a token.');
    const confirm = path === '/api/Seat/confirm';
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.transport.post(path, authRequired ? { ...payload, authorization: this.authorization } : payload, {
          baseURL: BASE_URL,
          headers: { authorization: authRequired ? this.authorization : false, cookie: false },
          timeout: 8000, maxRedirects: 0, signal: options.signal,
        });
        // Official response interceptor clears the session on business code 10001.
        if (authRequired && response.data && typeof response.data === 'object' && 'code' in response.data && String(response.data.code) === '10001') {
          try { await this.onUnauthorized?.(); }
          catch { throw new BookingError('AUTH_INVALIDATION_FAILED', ''); }
          throw new BookingError('INVALID_TOKEN', '');
        }
        return response.data;
      } catch (error) {
        if (!confirm && options.signal?.aborted) throw new BookingError('STOPPED', '');
        if (error instanceof BookingError) throw error;
        const status = error instanceof HttpTransportError ? error.status : undefined;
        if (status === 401 && authRequired) {
          try { await this.onUnauthorized?.(); }
          catch { throw new BookingError('AUTH_INVALIDATION_FAILED', 'Rejected token could not be cleared; request not retried.'); }
        }
        const transient = error instanceof HttpTransportError && (status !== undefined
          ? [502, 503, 504].includes(status) : transientCodes.has(error.code ?? ''));
        if (authRequired && !confirm && transient && !options.signal?.aborted && attempt < this.queryRetries) { await this.sleep(500 * 2 ** attempt); continue; }
        const retryHeader = error instanceof HttpTransportError ? error.retryAfter : undefined;
        const retryText = typeof retryHeader === 'string' || typeof retryHeader === 'number' ? String(retryHeader) : '';
        const retryAfterMs = /^\d+(\.\d+)?$/.test(retryText) ? Number(retryText) * 1000 : retryText ? Math.max(0, Date.parse(retryText) - Date.now()) : undefined;
        // Never retain AxiosError: it contains headers, token and request body.
        throw new BookingError(confirm && (!status || status >= 500) ? 'CONFIRM_OUTCOME_UNKNOWN' : 'HTTP_ERROR',
          `${path}: ${status ? `HTTP ${status}` : 'network request failed'}${confirm ? '; not retried. Check the official reservation record before any new submission.' : ''}`,
          undefined, status, Number.isFinite(retryAfterMs) ? retryAfterMs : undefined, transient);
      }
    }
  }
}
