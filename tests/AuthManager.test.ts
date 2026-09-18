import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthCancelledError, CasTokenExchangeError } from '../src/auth/authErrors.js';
import { exchangeCasForBookingToken } from '../src/auth/CasTokenProvider.js';
import { createTokenProvider } from '../src/auth/createAuth.js';
import { runAuthCommand } from '../src/auth/authCommands.js';
import { authHarness, callback, deferred, jwt, login, now } from './authFixtures.js';

test('valid secure token survives a new manager and never creates or navigates a browser', async () => {
  const h = authHarness({ token: jwt(), savedAt: now });
  assert.equal((await h.auth.initialize()).state, 'AUTHENTICATED');
  assert.equal(await h.auth.getToken(), jwt());
  assert.equal(await h.makeManager().getToken(), jwt());
  assert.equal(h.browser.windows.length, 0);
  assert.equal(h.requests.length, 0);
  assert.equal(h.store.writes, 0);
  assert.ok(!JSON.stringify(h.auth.getStatus()).includes(jwt()));
});
test('expired token silently refreshes, saves minimal data and closes hidden window', async () => {
  const h = authHarness({ token: jwt(now / 1000 - 1), savedAt: now - 10000 });
  assert.equal(await h.auth.getToken(), jwt());
  assert.equal(h.browser.windows.length, 1);
  assert.equal(h.browser.windows[0]!.shows, 0);
  assert.equal(h.browser.windows[0]!.closes, 1);
  assert.deepEqual(h.browser.windows[0]!.events.eventNames(), []);
  assert.deepEqual(h.store.value, { token: jwt(), savedAt: now, expiresAt: now + 3600000 });
  assert.deepEqual(h.requests[0]!.body, { cas: 'synthetic-cas' });
  assert.equal(h.requests[0]!.authorization, false);
  assert.equal(h.requests[0]!.cookie, false);
  assert.deepEqual(h.browser.options[0], { partition: 'persist:zju-booking-auth', show: false,
    title: '浙江大学统一身份认证', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
});
test('silent timeout at CAS login shows exactly the existing window', async () => {
  const h = authHarness();
  h.browser.setup = window => {
    window.onLoad = () => window.navigate(login);
    window.onShow = () => {
      assert.equal(h.auth.getStatus().state, 'AUTHENTICATING');
      window.navigate(callback);
    };
  };
  await h.auth.getToken();
  assert.equal(h.browser.windows.length, 1);
  assert.equal(h.browser.windows[0]!.shows, 1);
  assert.equal(h.auth.getStatus().state, 'AUTHENTICATED');
});
test('initialization does not force a login popup; explicit user action can log in', async () => {
  const h = authHarness();
  h.browser.setup = window => { window.onLoad = () => window.navigate(login); };
  assert.equal((await h.auth.initialize()).state, 'LOGIN_REQUIRED');
  assert.equal(h.browser.windows[0]!.shows, 0);
  assert.equal(h.browser.windows[0]!.closes, 1);
  await h.auth.getToken();
  assert.equal(h.browser.windows[1]!.shows, 1);
});
test('five concurrent callers share the exact promise and one window', async () => {
  const h = authHarness();
  const calls = Array.from({ length: 5 }, () => h.auth.getToken());
  assert.ok(calls.every(call => call === calls[0]));
  assert.deepEqual(await Promise.all(calls), Array(5).fill(jwt()));
  assert.equal(h.browser.windows.length, 1);
  assert.equal(h.requests.length, 1);
});
test('interactive request promotes an in-flight startup check without a second window', async () => {
  const h = authHarness();
  h.browser.setup = window => { window.onLoad = () => window.navigate(login); };
  const startup = h.auth.initialize();
  const token = h.auth.getToken();
  await Promise.all([startup, token]);
  assert.equal(h.browser.windows.length, 1);
  assert.equal(h.browser.windows[0]!.shows, 1);
});
test('closing login cancels and cleans listeners; next request starts a fresh flight', async () => {
  const h = authHarness();
  h.browser.setup = window => { window.onLoad = () => window.close(); };
  await assert.rejects(h.auth.getToken(), AuthCancelledError);
  assert.deepEqual(h.browser.windows[0]!.events.eventNames(), []);
  h.browser.setup = () => {};
  await h.auth.getToken();
  assert.equal(h.browser.windows.length, 2);
});
test('untrusted or subframe callbacks are ignored; unexpected timeout does not show login', async () => {
  const h = authHarness();
  h.browser.setup = window => { window.onLoad = () => {
    window.navigate(callback, false);
    window.navigate('https://booking.lib.zju.edu.cn.evil.com/?cas=synthetic-cas');
  }; };
  await assert.rejects(h.auth.getToken(), { code: 'CAS_SILENT_TIMEOUT' });
  assert.equal(h.browser.windows[0]!.shows, 0);
  assert.equal(h.requests.length, 0);
});
test('duplicate navigation callbacks exchange only once', async () => {
  const h = authHarness();
  h.browser.setup = window => { window.onLoad = () => { window.navigate(callback); window.navigate(callback); }; };
  await h.auth.getToken();
  assert.equal(h.requests.length, 1);
});
test('exchange validates code and token and never retains server personal information', async () => {
  for (const response of [{ code: 0, msg: 'private-cas-secret' }, { code: '1', member: { token: jwt() } },
    { code: 1 }, { code: 1, member: { token: '' } }, { code: 1, member: { token: 123 } }]) {
    const h = authHarness();
    h.respond(() => response);
    await assert.rejects(h.auth.getToken(), CasTokenExchangeError);
    assert.equal(h.store.value, null);
    assert.equal(h.auth.getStatus().state, 'FAILED');
    assert.ok(!h.logs.join('\n').includes('private-cas-secret'));
  }
});
test('CAS exchange enforces credential length bounds before networking', async () => {
  const h = authHarness();
  for (const cas of ['abc', 'x'.repeat(513), 'bad cas value']) await assert.rejects(exchangeCasForBookingToken(cas, h.http), CasTokenExchangeError);
  assert.equal(h.requests.length, 0);
  for (const cas of ['x'.repeat(8), 'x'.repeat(512)]) await exchangeCasForBookingToken(cas, h.http);
  assert.equal(h.requests.length, 2);
});
test('unknown expiry cache triggers refresh; invalid new expiry fails instead of looping', async () => {
  const h = authHarness({ token: 'opaque-token', savedAt: now, expiresAt: now + 9999999 });
  h.respond(() => ({ code: 1, member: { token: 'opaque-token' } }));
  await assert.rejects(h.auth.getToken(), { code: 'TOKEN_EXPIRY_INVALID' });
  assert.equal(h.requests.length, 1);
  assert.equal(h.store.value, null);
});
test('clear-token retains CAS; logout clears secure cache and browser session', async () => {
  const h = authHarness();
  await runAuthCommand('test', h.auth, message => h.logs.push(message));
  await runAuthCommand('clear-token', h.auth, message => h.logs.push(message));
  assert.equal(h.store.value, null);
  assert.equal(h.browser.clears, 0);
  await h.auth.getToken();
  assert.equal(h.browser.windows[1]!.shows, 0);
  await runAuthCommand('logout', h.auth, message => h.logs.push(message));
  assert.equal(h.store.value, null);
  assert.equal(h.browser.clears, 1);
  assert.deepEqual(h.auth.getStatus(), { state: 'LOGIN_REQUIRED', hasCachedToken: false, casSessionAvailable: false });
  h.browser.setup = window => { window.onLoad = () => window.navigate(login); };
  await h.auth.getToken();
  assert.equal(h.browser.windows[2]!.shows, 1);
  for (const secret of [jwt(), 'synthetic-cas', 'synthetic-private']) assert.ok(!h.logs.join('\n').includes(secret));
});
test('logout waits for an in-flight secure write and prevents a token from reappearing', async () => {
  const h = authHarness();
  const writing = deferred<void>();
  const release = deferred<void>();
  h.store.set = async value => { writing.resolve(); await release.promise; h.store.value = value; };
  const loginResult = assert.rejects(h.auth.getToken(), AuthCancelledError);
  await writing.promise;
  const logout = h.auth.logout();
  release.resolve();
  await Promise.all([loginResult, logout]);
  assert.equal(h.store.value, null);
  assert.equal(h.browser.clears, 1);
});
test('logout cancels a hidden window and next calls wait for clearing', async () => {
  const h = authHarness();
  const loaded = deferred<void>();
  h.browser.setup = window => { window.onLoad = () => { window.navigate(login); loaded.resolve(); }; };
  const cancelled = assert.rejects(h.auth.getToken(), AuthCancelledError);
  await loaded.promise;
  const logout = h.auth.logout();
  h.browser.setup = () => {};
  const next = h.auth.getToken();
  await Promise.all([cancelled, logout, next]);
  assert.equal(h.browser.clears, 1);
  assert.equal(h.browser.windows.length, 2);
});

test('closing during a secure write waits for completion and removes the cancelled login', async () => {
  const h = authHarness();
  const writing = deferred<void>();
  const release = deferred<void>();
  h.store.set = async value => { writing.resolve(); await release.promise; h.store.value = value; };
  const cancelled = assert.rejects(h.auth.getToken(), AuthCancelledError);
  await writing.promise;
  h.browser.windows[0]!.close();
  release.resolve();
  await cancelled;
  assert.equal(h.store.value, null);
  assert.equal(h.auth.getStatus().hasCachedToken, false);
});

test('save failure never returns an authenticated token or keeps a login window', async () => {
  const h = authHarness();
  h.store.set = async () => { throw new Error('secret storage error'); };
  await assert.rejects(h.auth.getToken(), { code: 'AUTH_COMPLETION_FAILED' });
  assert.equal(h.auth.getStatus().state, 'FAILED');
  assert.equal(h.browser.windows[0]!.closes, 1);
  assert.equal(h.store.value, null);
});
test('a stale 401 cannot invalidate a newer cached token', async () => {
  const h = authHarness({ token: jwt(), savedAt: now });
  await h.auth.getToken();
  await h.auth.invalidateToken('old-token');
  assert.equal(h.store.value?.token, jwt());
  await h.auth.invalidateToken(jwt());
  assert.equal(h.store.value, null);
  assert.equal(h.browser.clears, 0);
});
test('local token clear is attempted even if session clearing fails', async () => {
  const h = authHarness({ token: jwt(), savedAt: now });
  h.browser.clearSession = async () => { throw new Error('sensitive adapter detail'); };
  await assert.rejects(h.auth.logout(), { code: 'AUTH_CLEAR_FAILED' });
  assert.equal(h.store.value, null);
});
test('token clear failure does not prevent attempting session clear', async () => {
  const h = authHarness();
  h.store.clear = async () => { throw new Error('sensitive filesystem detail'); };
  await assert.rejects(h.auth.logout(), { code: 'AUTH_CLEAR_FAILED' });
  assert.equal(h.browser.clears, 1);
});
test('env mode remains compatible and persistent mode never silently falls back', async () => {
  assert.equal(await createTokenProvider({ AUTH_MODE: 'env', BOOKING_TOKEN: 'synthetic-env-token' }).getToken(), 'synthetic-env-token');
  assert.throws(() => createTokenProvider({}), { code: 'AUTH_ADAPTER_UNAVAILABLE' });
  assert.throws(() => createTokenProvider({ AUTH_MODE: 'typo' }), { code: 'INVALID_AUTH_MODE' });
});
