import axios, { type AxiosInstance } from 'axios';
import { setTimeout as delay } from 'node:timers/promises';
import { ensureToken } from '../config/config.js';
import { BookingError } from '../errors.js';

export const BASE_URL = 'https://booking.lib.zju.edu.cn';
const transientCodes = new Set(['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'ERR_NETWORK']);

export class HttpClient {
  private readonly authorization?: string;
  constructor(token: string | null, private readonly transport: AxiosInstance = axios.create({
    baseURL: BASE_URL, timeout: 8000, maxRedirects: 0,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', lang: 'zh' },
  }), private readonly sleep: (ms: number) => Promise<unknown> = delay,
  private readonly onUnauthorized?: () => Promise<void>) {
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
        return response.data;
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status === 401 && authRequired) {
          try { await this.onUnauthorized?.(); }
          catch { throw new BookingError('AUTH_INVALIDATION_FAILED', 'Rejected token could not be cleared; request not retried.'); }
        }
        const transient = axios.isAxiosError(error) && (status !== undefined
          ? [502, 503, 504].includes(status) : transientCodes.has(error.code ?? ''));
        if (authRequired && !confirm && transient && attempt < 2) { await this.sleep(500 * 2 ** attempt); continue; }
        // Never retain AxiosError: it contains headers, token and request body.
        throw new BookingError(confirm && (!status || status >= 500) ? 'CONFIRM_OUTCOME_UNKNOWN' : 'HTTP_ERROR',
          `${path}: ${status ? `HTTP ${status}` : 'network request failed'}${confirm ? '; not retried. Check the official reservation record before any new submission.' : ''}`);
      }
    }
  }
}
