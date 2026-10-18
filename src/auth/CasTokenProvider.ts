import { HttpClient } from '../api/httpClient.js';
import { ensureToken } from '../config/config.js';
import { AuthCancelledError, AuthError, CasTokenExchangeError } from './authErrors.js';
import { BookingError } from '../errors.js';
import type { CasLoginOptions, PersistentCasSession } from './PersistentCasSession.js';

export async function exchangeCasForBookingToken(cas: string, http: HttpClient, signal?: AbortSignal): Promise<string> {
  if (cas.length < 8 || cas.length > 512 || /\s|[\x00-\x1f\x7f]/.test(cas)) throw new CasTokenExchangeError();
  try {
    const response = await http.post('/api/cas/user', { cas }, { authRequired: false, signal });
    if (!response || typeof response !== 'object' || !('code' in response) || response.code !== 1
      || !('member' in response) || !response.member || typeof response.member !== 'object'
      || !('token' in response.member) || typeof response.member.token !== 'string') throw new CasTokenExchangeError();
    return ensureToken(response.member.token);
  } catch (error) {
    if (signal?.aborted) throw new AuthCancelledError();
    if (error instanceof AuthError && ['AUTH_TIMEOUT', 'AUTH_DNS_FAILED', 'AUTH_TLS_FAILED', 'AUTH_BRIDGE_FAILED'].includes(error.code)) throw error;
    if (error instanceof BookingError && (error.transient || error.httpStatus === 429 || (error.httpStatus !== undefined && error.httpStatus >= 500))) {
      throw new AuthError('AUTH_NETWORK_FAILED', '', true);
    }
    throw new CasTokenExchangeError();
  }
}

export class CasTokenProvider {
  constructor(private readonly session: PersistentCasSession, private readonly http: HttpClient) {}
  authenticate(options: CasLoginOptions, save: (token: string) => Promise<void>): Promise<string> {
    return this.session.authenticate(options, async cas => {
      const token = await exchangeCasForBookingToken(cas, this.http, options.signal);
      await save(token);
      return token;
    });
  }
  clearSession(): Promise<void> { return this.session.clear(); }
}
