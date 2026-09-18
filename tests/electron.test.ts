import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { ElectronCredentialCipher } from '../electron/adapters/ElectronCredentialCipher.js';
import { allowedRemoteUrl, blockedRemoteRequest, handleNavigation, upgradeOfficialUrl } from '../electron/adapters/navigationPolicy.js';
import { DesktopController, safeError, validateForm } from '../electron/desktopController.js';
import { registerIpc, trustedSender } from '../electron/ipc.js';
import { BookingApi } from '../src/api/bookingApi.js';
import { BookingService } from '../src/domain/BookingService.js';
import { REAL_CONFIRM_ENABLED } from '../src/config/runtimePolicy.js';
import { config, fakeToken, harness, normalResponse, seat } from './fixtures.js';
import { BookingError } from '../src/errors.js';
import type { AuthStatus } from '../src/auth/AuthManager.js';

const { dryRun: _dryRun, ...form } = config;
function desktop(respond = normalResponse) {
  let status: AuthStatus = { state: 'AUTHENTICATED', hasCachedToken: true };
  const h = harness(respond);
  const auth = {
    getStatus: () => ({ ...status, token: fakeToken }),
    getToken: async () => fakeToken,
    logout: async () => { status = { state: 'LOGIN_REQUIRED', hasCachedToken: false }; },
  };
  const controller = new DesktopController(auth, { openBookingWebsite: async () => {} },
    () => new BookingService(auth, () => h.api, () => {}));
  return { controller, ...h };
}

test('credential cipher delegates bytes to OS encryption without conversion', () => {
  const bytes = Buffer.from([0, 255, 4]);
  const cipher = new ElectronCredentialCipher({
    isEncryptionAvailable: () => false,
    encryptString: value => { assert.equal(value, 'private'); return bytes; },
    decryptString: value => { assert.equal(value, bytes); return 'private'; },
  });
  assert.equal(cipher.isEncryptionAvailable(), false);
  assert.equal(cipher.encryptString('private'), bytes);
  assert.equal(cipher.decryptString(bytes), 'private');
});
test('desktop input reconstructs an allowlist and forces dry run', () => {
  assert.deepEqual(validateForm(form), config);
  for (const value of [null, [], 'bad', { ...form, dryRun: false }, { ...form, token: fakeToken },
    { ...form, targetDate: '2026-02-30' }, { ...form, targetSeat: ' ' }, { ...form, startTime: '24:00' },
    { ...form, endTime: form.startTime }, { ...form, targetBuilding: 4 }, { ...form, targetSeat: 'a'.repeat(101) }]) {
    assert.throws(() => validateForm(value), BookingError);
  }
});
test('desktop strips credentials and internal IDs from auth and query replies', async () => {
  const h = desktop();
  assert.deepEqual(h.controller.status(), { state: 'AUTHENTICATED' });
  assert.deepEqual(await h.controller.login(), { state: 'AUTHENTICATED' });
  const result = await h.controller.query(form);
  assert.deepEqual(result, { available: true, area: '北区', seat: form.targetSeat,
    day: form.targetDate, startTime: form.startTime, endTime: form.endTime });
  assert.doesNotMatch(JSON.stringify(result), /token|seatId|segment|encryptionDate/);
  assert.equal(h.requests.some(request => request.path.endsWith('/confirm')), false);
});
test('unavailable seat is a user result with no confirm request', async () => {
  const h = desktop(request => request.path.endsWith('/seat') ? { code: 1, data: [{ ...seat, status: '2', status_name: '已预约' }] } : normalResponse(request));
  assert.equal((await h.controller.query(form)).available, false);
  assert.equal(h.requests.some(request => request.path.endsWith('/confirm')), false);
});
test('main rejects simultaneous queries and conflicting account actions, then permits retry', async () => {
  const h = desktop();
  const first = h.controller.query(form);
  await assert.rejects(h.controller.query(form), { code: 'BUSY' });
  await assert.rejects(h.controller.logout(), { code: 'BUSY' });
  await first;
  await h.controller.query(form);
  assert.equal(h.requests.filter(request => request.path.endsWith('/seat')).length, 2);
});
test('query failure releases running guard and logout prevents later querying', async () => {
  const h = desktop(() => { throw new BookingError('HTTP_ERROR', fakeToken); });
  await assert.rejects(h.controller.query(form));
  assert.deepEqual(await h.controller.logout(), { state: 'LOGIN_REQUIRED' });
  await assert.rejects(h.controller.query(form), { code: 'LOGIN_REQUIRED' });
});
test('real API confirmation and alias are disabled before transport despite valid parameters', async () => {
  const h = harness(normalResponse);
  const api = new BookingApi(h.http);
  assert.equal(REAL_CONFIRM_ENABLED, false);
  await assert.rejects(api.confirmSeat({ seatId: '1', segment: '2' }), { code: 'REAL_CONFIRM_DISABLED' });
  await assert.rejects(api.submitSeatConfirm({ seat_id: '1', segment: '2' }), { code: 'REAL_CONFIRM_DISABLED' });
  const service = new BookingService({ getToken: async () => fakeToken }, () => api, () => {});
  await assert.rejects(service.runBooking({ ...config, dryRun: false }), { code: 'REAL_CONFIRM_DISABLED' });
  assert.equal(h.requests.some(request => request.path.endsWith('/confirm')), false);
});
test('safe errors never reflect server text, stack, headers or arbitrary error codes', () => {
  for (const error of [new Error(fakeToken), new BookingError(fakeToken, fakeToken), new BookingError('HTTP_ERROR', fakeToken)]) {
    assert.doesNotMatch(JSON.stringify(safeError(error)), new RegExp(`${fakeToken}|stack|headers`));
  }
});
test('IPC accepts only exact local main window and exposes precisely five actions', async () => {
  const mainFrame = { url: 'file:///app/renderer/index.html' };
  const contents = { mainFrame };
  const window = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow;
  const event = { sender: contents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input?: unknown) => unknown>();
  registerIpc({ handle: (channel, handler) => { handlers.set(channel, handler); } }, window, mainFrame.url, desktop().controller);
  assert.deepEqual([...handlers.keys()], ['auth:get-status', 'auth:login', 'auth:logout', 'booking:open-web', 'booking:dry-run']);
  assert.equal(trustedSender(event, window, mainFrame.url), true);
  for (const other of [
    { ...event, sender: {} }, { ...event, senderFrame: { url: mainFrame.url } },
    { ...event, senderFrame: { url: 'https://booking.lib.zju.edu.cn' } }, { ...event, senderFrame: null },
  ]) {
    const result = await handlers.get('auth:get-status')!(other as IpcMainInvokeEvent);
    assert.deepEqual(result, safeError(new BookingError('FORBIDDEN', '')));
  }
  const result = await handlers.get('booking:dry-run')!(event, { ...form, dryRun: false });
  assert.deepEqual(result, safeError(new BookingError('INVALID_INPUT', '')));
  assert.equal(handlers.has('auth:get-token'), false);
});
test('callback is prevented before reporting, only for trusted main frame', () => {
  const events: string[] = [];
  const callback = 'https://booking.lib.zju.edu.cn/h5/index.html#/cas?cas=synthetic';
  handleNavigation(callback, true, () => events.push('prevent'), () => events.push('report'), true);
  assert.deepEqual(events, ['prevent', 'report']);
  events.length = 0;
  handleNavigation(callback, false, () => events.push('prevent'), () => events.push('report'), true);
  assert.equal(events.length, 0);
  handleNavigation('https://evil.example/?cas=synthetic', true, () => events.push('prevent'), () => events.push('report'), true);
  assert.deepEqual(events, ['prevent']);
});
test('remote windows deny unsafe schemes and Chromium confirmation and credential exchange', () => {
  for (const value of ['javascript:alert(1)', 'file:///C:/secret', 'https://booking.lib.zju.edu.cn.evil.test', 'https://u@zjuam.zju.edu.cn/']) assert.equal(allowedRemoteUrl(value), false);
  assert.equal(allowedRemoteUrl('https://zjuam.zju.edu.cn/cas/login'), true);
  for (const path of ['/api/Seat/confirm', '/api/Seat/confirm/', '/api/Seat/%63onfirm?x=1', '/api/cas/user']) assert.equal(blockedRemoteRequest(`https://booking.lib.zju.edu.cn${path}`), true);
  assert.equal(blockedRemoteRequest('https://booking.lib.zju.edu.cn/api/Seat/seat'), false);
});
test('official legacy HTTP redirect is upgraded to HTTPS without expanding the allowlist', () => {
  assert.equal(upgradeOfficialUrl('http://zjuam.zju.edu.cn:80/cas/login?service=library'), 'https://zjuam.zju.edu.cn/cas/login?service=library');
  for (const url of ['http://zjuam.zju.edu.cn:8080/', 'http://evil.test/', 'http://u@zjuam.zju.edu.cn/']) assert.equal(upgradeOfficialUrl(url), undefined);
});
test('preload has no raw IPC or token accessor and renderer has no privileged imports', async () => {
  const preload = await readFile('electron/preload.ts', 'utf8');
  const renderer = await readFile('renderer/renderer.ts', 'utf8');
  assert.doesNotMatch(preload, /getToken|send\s*\(|exposeInMainWorld\(['"](?:ipc|require)/);
  assert.doesNotMatch(renderer, /from ['"](?:electron|node:|axios)|getToken|\.invoke\(/);
});
