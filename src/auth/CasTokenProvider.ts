import { HttpClient } from '../api/httpClient.js';
import { ensureToken } from '../config/config.js';
import { CasTokenExchangeError } from './authErrors.js';
import type { CasLoginOptions, PersistentCasSession } from './PersistentCasSession.js';

export async function exchangeCasForBookingToken(cas: string, http = new HttpClient(null), signal?: AbortSignal): Promise<string> {
  if (cas.length < 8 || cas.length > 512 || /\s|[\x00-\x1f\x7f]/.test(cas)) throw new CasTokenExchangeError();
  try {
    const response = await http.post('/api/cas/user', { cas }, { authRequired: false, signal });
    if (!response || typeof response !== 'object' || !('code' in response) || response.code !== 1
      || !('member' in response) || !response.member || typeof response.member !== 'object'
      || !('token' in response.member) || typeof response.member.token !== 'string') throw new CasTokenExchangeError();
    return ensureToken(response.member.token);
  } catch { throw new CasTokenExchangeError(); }
}

export class CasTokenProvider {
  constructor(private readonly session: PersistentCasSession, private readonly http = new HttpClient(null)) {}
  authenticate(options: CasLoginOptions, save: (token: string) => Promise<void>): Promise<string> {
    return this.session.authenticate(options, async cas => {
      const token = await exchangeCasForBookingToken(cas, this.http, options.signal);
      await save(token);
      return token;
    });
  }
  clearSession(): Promise<void> { return this.session.clear(); }
}
