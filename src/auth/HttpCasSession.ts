import { AuthCancelledError, AuthError, LoginRequiredError } from './authErrors.js';
import { CAS_LOGIN_URL, extractCasFromUrl, isCasLoginUrl } from './casUrlParser.js';
import type { CasLoginOptions } from './PersistentCasSession.js';
import { HttpTransportError, type HttpTransport } from '../api/HttpTransport.js';

const CAS_ORIGIN = 'https://zjuam.zju.edu.cn';
export interface CasHttpResponse { status: number; body: string; location?: string }
// Cookies stay in the platform's private session, never in the public bridge or UI.
export interface CasHttpAdapter {
  request(url: string, method: 'GET' | 'POST', body: string | undefined, signal: AbortSignal): Promise<CasHttpResponse>;
}
export function trustedCasHttpUrl(value: string): string {
  const url = new URL(value);
  if (url.origin === 'http://zjuam.zju.edu.cn' && url.pathname === '/cas/login') url.protocol = 'https:';
  if (url.username || url.password || !((url.origin === CAS_ORIGIN && ['/cas/login', '/cas/v2/getPubKey', '/cas/v2/getKaptchaStatus'].includes(url.pathname))
    || (url.origin === 'https://booking.lib.zju.edu.cn' && ['/api/cas/cas', '/api/cas/user', '/h5/', '/h5/index.html'].includes(url.pathname)))) {
    throw new AuthError('MANUAL_VERIFICATION_REQUIRED', 'Official verification required.');
  }
  const service = url.searchParams.get('service');
  if (url.origin === CAS_ORIGIN && service !== null && service !== CAS_LOGIN_URL) throw new AuthError('MANUAL_VERIFICATION_REQUIRED', '');
  return url.href;
}

// The official frontend exchanges cas in the same library Cookie session as the callback.
// Keep this auth-only transport separate from Cookie-free reservation requests.
export function casExchangeTransport(adapter: CasHttpAdapter): HttpTransport {
  return { async post(path, payload, options) {
    if (path !== '/api/cas/user') throw new AuthError('CAS_PROTOCOL_CHANGED', '');
    const response = await adapter.request(`https://booking.lib.zju.edu.cn${path}`, 'POST', JSON.stringify(payload), options.signal ?? new AbortController().signal);
    if (response.status < 200 || response.status >= 300) throw new HttpTransportError(response.status);
    try { return { data: JSON.parse(response.body) }; }
    catch { throw new AuthError('CAS_PROTOCOL_CHANGED', ''); }
  } };
}

// Matches the official login.js/security.js reversed UTF-16, little-endian RSA blocks.
export function encryptCasPassword(password: string, modulus: string, exponent: string): string {
  // The school's legacy JS bigint implementation has non-byte UTF-16 behavior.
  // Delegate such passwords to its official page rather than sending a different ciphertext.
  if (/[^\x00-\xff]/.test(password)) throw new AuthError('MANUAL_VERIFICATION_REQUIRED', '');
  if (!/^[a-f\d]{64,1024}$/i.test(modulus) || !/^[a-f\d]{1,8}$/i.test(exponent)) throw new AuthError('CAS_PROTOCOL_CHANGED', '');
  const n = BigInt(`0x${modulus}`), e = BigInt(`0x${exponent}`);
  if (e < 3n || n % 2n === 0n) throw new AuthError('CAS_PROTOCOL_CHANGED', '');
  const chunk = 2 * (Math.ceil(n.toString(16).length / 4) - 1);
  const chars = password.split('').reverse().map(char => char.charCodeAt(0));
  const blocks: string[] = [];
  for (let i = 0; i < chars.length; i += chunk) {
    let value = 0n;
    for (let j = 0; j < chunk; j += 2) value += BigInt((chars[i + j] ?? 0) + ((chars[i + j + 1] ?? 0) << 8)) << BigInt(j * 8);
    let result = 1n, power = e;
    while (power) { if (power & 1n) result = result * value % n; value = value * value % n; power >>= 1n; }
    const hex = result.toString(16);
    blocks.push(hex.padStart(Math.ceil(hex.length / 4) * 4, '0'));
  }
  return blocks.join(' ');
}

function executionFrom(html: string): string {
  const tag = html.match(/<input\b[^>]*\bname\s*=\s*["']execution["'][^>]*>/i)?.[0];
  const value = tag?.match(/\bvalue\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!value || value.length > 20000) throw new AuthError('MANUAL_VERIFICATION_REQUIRED', '');
  return value.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

export class HttpCasSession {
  constructor(private readonly http: CasHttpAdapter) {}
  private async request(url: string, signal: AbortSignal, method: 'GET' | 'POST' = 'GET', body?: string): Promise<CasHttpResponse> {
    if (signal.aborted) throw new AuthCancelledError();
    try {
      const response = await this.http.request(trustedCasHttpUrl(url), method, body, signal);
      if (signal.aborted) throw new AuthCancelledError();
      if (response.status === 429 || response.status >= 500) throw new AuthError('AUTH_NETWORK_FAILED', '', true);
      if (response.status < 200 || response.status >= 400) throw new AuthError('MANUAL_VERIFICATION_REQUIRED', '');
      return response;
    } catch (error) {
      if (signal.aborted) throw new AuthCancelledError();
      if (error instanceof AuthError) throw error;
      throw new AuthError('AUTH_NETWORK_FAILED', '', true);
    }
  }
  private async follow(url: string, options: CasLoginOptions, initial?: CasHttpResponse): Promise<{ url: string; response: CasHttpResponse; cas?: string }> {
    for (let count = 0; count < 10; count++) {
      url = trustedCasHttpUrl(url);
      if (new URL(url).pathname === '/api/cas/user') throw new AuthError('MANUAL_VERIFICATION_REQUIRED', '');
      const cas = extractCasFromUrl(url);
      if (cas) return { url, response: { status: 200, body: '' }, cas };
      const response = initial ?? await this.request(url, options.signal);
      initial = undefined;
      if (response.status >= 300 && response.status < 400 && response.location) { url = new URL(response.location, url).href; continue; }
      return { url, response };
    }
    throw new AuthError('CAS_PROTOCOL_CHANGED', '');
  }
  async authenticate<T>(options: CasLoginOptions, consume: (cas: string) => Promise<T>): Promise<T> {
    let page = await this.follow(CAS_LOGIN_URL, options);
    if (page.cas) { options.onCallback(true); return consume(page.cas); }
    if (!isCasLoginUrl(page.url)) throw new AuthError('MANUAL_VERIFICATION_REQUIRED', '');
    const credentials = await options.credentials?.();
    if (!credentials) { options.onLoginRequired(); throw new LoginRequiredError(); }
    options.onAuthenticating();
    const execution = executionFrom(page.response.body);
    const captcha = await this.request(`${CAS_ORIGIN}/cas/v2/getKaptchaStatus`, options.signal);
    // Unknown challenge formats fail closed; never submit around an official challenge.
    if (captcha.body.trim() !== 'false') throw new AuthError('MANUAL_VERIFICATION_REQUIRED', '');
    const keyResponse = await this.request(`${CAS_ORIGIN}/cas/v2/getPubKey`, options.signal);
    let key: { modulus: string; exponent: string };
    try { key = JSON.parse(keyResponse.body); }
    catch { throw new AuthError('CAS_PROTOCOL_CHANGED', ''); }
    if (!key || typeof key.modulus !== 'string' || typeof key.exponent !== 'string') throw new AuthError('CAS_PROTOCOL_CHANGED', '');
    const body = new URLSearchParams({ username: credentials.username, password: encryptCasPassword(credentials.password, key.modulus, key.exponent), execution, _eventId: 'submit' }).toString();
    const submitted = await this.request(page.url, options.signal, 'POST', body);
    page = await this.follow(page.url, options, submitted);
    if (page.cas) { options.onCallback(false); return consume(page.cas); }
    if (isCasLoginUrl(page.url)) {
      const captchaAfter = await this.request(`${CAS_ORIGIN}/cas/v2/getKaptchaStatus`, options.signal);
      if (captchaAfter.body.trim() !== 'false') throw new AuthError('MANUAL_VERIFICATION_REQUIRED', '');
      if (/(?:用户名|账号|学号|密码).{0,30}(?:错误|不正确|无效)|(?:invalid|incorrect)\s+(?:username|password|credentials)/i.test(page.response.body)) {
        throw new AuthError('CREDENTIALS_INVALID', '');
      }
    }
    throw new AuthError('MANUAL_VERIFICATION_REQUIRED', '');
  }
}
