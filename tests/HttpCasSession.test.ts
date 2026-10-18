import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthManager } from '../src/auth/AuthManager.js';
import { CasTokenProvider } from '../src/auth/CasTokenProvider.js';
import { PersistentCasSession } from '../src/auth/PersistentCasSession.js';
import { HttpCasSession, encryptCasPassword, trustedCasHttpUrl, type CasHttpAdapter } from '../src/auth/HttpCasSession.js';
import type { Credentials, SecureCredentialStore } from '../src/auth/Credentials.js';
import { AuthError } from '../src/auth/authErrors.js';
import { TokenValidator } from '../src/auth/TokenValidator.js';
import { authHarness, deferred, FakeBrowser, jwt, MemoryTokenStore, now } from './authFixtures.js';
import { HttpClient } from '../src/api/httpClient.js';
import { HttpTransportError } from '../src/api/HttpTransport.js';

const loginUrl = 'https://zjuam.zju.edu.cn/cas/login?service=https%3A%2F%2Fbooking.lib.zju.edu.cn%2Fapi%2Fcas%2Fcas';
const form = '<form><input type="hidden" value="synthetic-execution" name="other"><input name="execution" value="synthetic-execution&amp;state"></form>';
const key = { modulus: 'bc997489d44cd6a0f20f95ac018eec71644389920272b2796da5556fd056f354ea9a4b9004e57c00e71e7359cf08101556a04dfa76d3fb4aacea55cd8d4f9a6f', exponent: '10001' };
const input = { username: 'synthetic-user', password: 'synthetic-password', remember: true };
test('RSA matches a vector checked against the current official security.js; non-byte passwords require official verification', () => {
  assert.equal(encryptCasPassword(input.password, key.modulus, key.exponent),
    '9275af6bc81f828805d716a98af156f9859b57042f6cac60d7a7c24e400a66cac664cece779a9bb1ed09e7f50fc49f8124b155fed2628c2aba14b734419c1cc5');
  assert.throws(() => encryptCasPassword('合成密码test', key.modulus, key.exponent), { code: 'MANUAL_VERIFICATION_REQUIRED' });
});
class CredentialStore implements SecureCredentialStore {
  value: Credentials | null = null;
  writes = 0;
  async get() { return this.value; }
  async set(value: Credentials) { this.writes++; this.value = value; }
  async clear() { this.value = null; }
}
function fixture() {
  const credentials = new CredentialStore(), store = new MemoryTokenStore(), browser = new FakeBrowser();
  let mode: 'password' | 'sso' | 'captcha' | 'invalid' | 'network' | 'mfa' = 'password';
  let clock = now;
  const requests: { url: string; method: string; body?: string }[] = [];
  const adapter: CasHttpAdapter = { async request(url, method, body) {
    requests.push({ url, method, body });
    if (mode === 'network') throw new Error(input.password);
    if (url.includes('/api/cas/cas')) return { status: 302, body: '', location: mode === 'sso' || url.includes('ticket=')
      ? 'https://booking.lib.zju.edu.cn/h5/index.html#/cas?cas=synthetic-cas'
      : loginUrl.replace('https://zjuam', 'http://zjuam') };
    if (url.endsWith('getKaptchaStatus')) return { status: 200, body: mode === 'captcha' ? 'true' : 'false' };
    if (url.endsWith('getPubKey')) return { status: 200, body: JSON.stringify(key) };
    if (method === 'POST') {
      if (mode === 'mfa') return { status: 302, body: '', location: 'https://zjuam.zju.edu.cn/cas/mfa' };
      if (mode === 'invalid') return { status: 200, body: form + '<span id="errormsg">用户名或密码错误</span>' };
      return { status: 302, body: '', location: 'https://booking.lib.zju.edu.cn/api/cas/cas?ticket=synthetic-ticket' };
    }
    assert.equal(url, loginUrl);
    return { status: 200, body: form };
  } };
  const exchange = authHarness().http;
  const make = () => new AuthManager(store, new CasTokenProvider(new PersistentCasSession(browser, 5, 1000, new HttpCasSession(adapter)), exchange),
    new TokenValidator(() => clock), () => clock, undefined, credentials);
  return { auth: make(), make, requests, credentials, store, browser,
    mode(value: typeof mode) { mode = value; }, advance(ms: number) { clock += ms; } };
}

test('internal HTTP login retains service, execution and RSA encryption; stores only with consent and restores after restart', async () => {
  const h = fixture();
  await h.auth.login(input);
  assert.deepEqual(h.credentials.value, { username: input.username, password: input.password });
  assert.equal(h.browser.windows.length, 0);
  const posted = h.requests.filter(request => request.method === 'POST');
  assert.equal(posted.length, 1);
  const payload = new URLSearchParams(posted[0]!.body);
  assert.equal(posted[0]!.url, loginUrl);
  assert.equal(payload.get('execution'), 'synthetic-execution&state');
  assert.equal(payload.get('password'), encryptCasPassword(input.password, key.modulus, key.exponent));
  assert.ok(!posted[0]!.body!.includes(input.password));
  assert.equal(payload.has('rememberMe'), false);
  const count = h.requests.length;
  assert.equal((await h.make().initialize()).state, 'AUTHENTICATED');
  assert.equal(h.requests.length, count);
  h.store.value = { token: jwt(now / 1000 - 1), savedAt: now };
  assert.equal(await h.make().getToken(), jwt());
  assert.equal(h.requests.filter(request => request.method === 'POST').length, 2);
  await h.auth.logout();
  assert.equal(h.store.value, null); assert.equal(h.credentials.value, null);
  assert.doesNotMatch(JSON.stringify(h.auth.getStatus()), /synthetic/);
});

test('without consent the password is discarded; expired session requires the internal form', async () => {
  const h = fixture(); await h.auth.login({ ...input, remember: false });
  assert.equal(h.credentials.writes, 0);
  h.store.value = null;
  assert.equal((await h.make().initialize()).state, 'LOGIN_REQUIRED');
  assert.equal(h.requests.filter(request => request.method === 'POST').length, 1);
  assert.equal(h.browser.windows.length, 0);
});

test('simultaneous expired-token consumers share one HTTP login; SSO is tried before passwords', async () => {
  const h = fixture(); h.credentials.value = input;
  const calls = Array.from({ length: 5 }, () => h.auth.getToken());
  assert.ok(calls.every(call => call === calls[0]));
  await Promise.all(calls);
  assert.equal(h.requests.filter(request => request.method === 'POST').length, 1);
  await h.auth.clearBookingToken(); h.mode('sso');
  const before = h.requests.length;
  await h.auth.getToken(); assert.equal(h.requests.length - before, 1);
});

for (const challenge of ['captcha', 'mfa'] as const) test(`${challenge} requires explicit official verification and never silently opens a browser`, async () => {
  const h = fixture(); h.mode(challenge);
  await assert.rejects(h.auth.login(input), { code: 'MANUAL_VERIFICATION_REQUIRED' });
  assert.equal(h.auth.getStatus().state, 'VERIFICATION_REQUIRED');
  assert.equal(h.credentials.writes, 0); assert.equal(h.browser.windows.length, 0);
  const before = h.requests.length;
  await assert.rejects(h.auth.getToken(), { code: 'MANUAL_VERIFICATION_REQUIRED' });
  assert.equal(h.requests.length, before);
  await h.auth.verifyOfficial();
  assert.equal(h.browser.windows.length, 1); assert.equal(h.browser.windows[0]!.shows, 1);
  assert.equal(h.credentials.writes, 0); // Never persist a password unverified by the HTTP flow.
});

test('invalid credentials are cleared and repeated automatic attempts stop', async () => {
  const h = fixture(); h.credentials.value = input; h.mode('invalid');
  await assert.rejects(h.auth.getToken(), { code: 'CREDENTIALS_INVALID' });
  const before = h.requests.length;
  await assert.rejects(h.auth.getToken(), { code: 'CREDENTIALS_INVALID' });
  assert.equal(h.credentials.value, null); assert.equal(h.requests.length, before);
});

test('network errors withhold raw details, back off, and stop after two attempts', async () => {
  const h = fixture(); h.mode('network');
  await assert.rejects(h.auth.getToken(), { code: 'AUTH_NETWORK_FAILED', transient: true });
  await assert.rejects(h.auth.getToken(), { code: 'AUTH_NETWORK_FAILED' });
  assert.equal(h.requests.length, 1);
  h.advance(30000);
  await assert.rejects(h.auth.getToken(), error => {
    assert.ok(error instanceof AuthError); assert.equal(error.transient, false);
    assert.ok(!JSON.stringify(error).includes(input.password)); return true;
  });
  h.advance(300000); await assert.rejects(h.auth.getToken()); assert.equal(h.requests.length, 2);
});

test('logout joins a pending credential write; a failed write never leaves an authenticated cache', async () => {
  const h = fixture(), writing = deferred<void>(), release = deferred<void>();
  h.credentials.set = async value => { writing.resolve(); await release.promise; h.credentials.value = value; };
  const login = assert.rejects(h.auth.login(input), { code: 'AUTH_CANCELLED' });
  await writing.promise; const logout = h.auth.logout(); release.resolve(); await Promise.all([login, logout]);
  assert.equal(h.credentials.value, null); assert.equal(h.store.value, null);
  h.credentials.set = async () => { throw new AuthError('TOKEN_STORE_WRITE_FAILED', ''); };
  await assert.rejects(h.auth.login(input), { code: 'TOKEN_STORE_WRITE_FAILED' });
  assert.equal(h.store.value, null);
});

test('HTTP redirect allowlist rejects other origins, userinfo, ports and service substitution', () => {
  assert.equal(trustedCasHttpUrl(loginUrl.replace('https:', 'http:')), loginUrl);
  for (const url of ['https://evil.test/cas/login', 'https://u@zjuam.zju.edu.cn/cas/login',
    'https://zjuam.zju.edu.cn:8080/cas/login', 'https://zjuam.zju.edu.cn/cas/login?service=https://evil.test',
    'https://booking.lib.zju.edu.cn/api/Seat/confirm']) assert.throws(() => trustedCasHttpUrl(url));
});

for (const rejection of ['401', '10001'] as const) test(`${rejection} refreshes queries once, but an already sent confirm is never replayed`, async () => {
  const h = fixture(); h.credentials.value = input; await h.auth.getToken();
  let requests = 0, reject = true;
  const http = new HttpClient(jwt(), { async post(_path, _body, options) {
    requests++;
    assert.equal(options.headers.cookie, false);
    if (reject) { if (rejection === '401') throw new HttpTransportError(401); return { data: { code: 10001 } }; }
    return { data: { code: 1 } };
  } }, undefined, token => h.auth.invalidateToken(token), 0, h.auth);
  // A second rejected query stops after exactly one refresh/replay.
  await assert.rejects(http.post('/api/Seat/date', {}), { code: 'INVALID_TOKEN' });
  assert.equal(requests, 2);
  reject = false; await http.post('/api/Seat/date', {});
  reject = true; const before = requests, logins = h.requests.length;
  await assert.rejects(http.post('/api/Seat/confirm', {}), { code: 'CONFIRM_OUTCOME_UNKNOWN' });
  assert.equal(requests - before, 1); assert.equal(h.requests.length, logins);
});
