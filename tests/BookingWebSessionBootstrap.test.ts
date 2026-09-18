import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { BookingWebSessionBootstrap, type BookingWebWindow } from '../src/auth/BookingWebSessionBootstrap.js';
import { authHarness, FakeWindow, jwt, now } from './authFixtures.js';

class WebWindow extends FakeWindow implements BookingWebWindow {
  storage = new Map<string, string>();
  reloads = 0;
  executions = 0;
  duringExecute?: () => void;
  constructor() {
    super();
    this.onLoad = () => this.events.emit('dom-ready');
    this.onShow = () => {};
  }
  onDomReady(listener: () => void) { return this.subscribe('dom-ready', listener); }
  async executeInIsolatedWorld(source: string) {
    this.executions++;
    this.duringExecute?.();
    return runInNewContext(source, { location: { origin: new URL(this.url).origin }, sessionStorage: {
      getItem: (key: string) => this.storage.get(key),
      setItem: (key: string, value: string) => this.storage.set(key, value),
    } });
  }
  reload() { this.reloads++; queueMicrotask(() => this.events.emit('dom-ready')); }
}
test('website gets token only at booking origin, reloads once and stores no UserInfo', async () => {
  const h = authHarness({ token: jwt(), savedAt: now });
  const window = new WebWindow();
  const bootstrap = new BookingWebSessionBootstrap(h.auth, { createWindow: options => {
    assert.equal(options.partition, 'persist:zju-booking-auth');
    assert.equal(options.webPreferences.sandbox, true);
    return window;
  } });
  await bootstrap.openBookingWebsite();
  assert.equal(window.storage.get('token'), jwt());
  assert.equal(window.storage.get('isCas'), 'true');
  assert.equal(window.storage.has('UserInfo'), false);
  assert.equal(window.reloads, 1);
  assert.equal(window.shows, 1);
  assert.equal(window.closes, 0);
  assert.deepEqual(window.events.eventNames(), []);
  assert.equal(h.browser.windows.length, 0);
});
test('bootstrap guard avoids reload when sessionStorage already has the current token', async () => {
  const h = authHarness({ token: jwt(), savedAt: now });
  const window = new WebWindow();
  window.storage.set('token', jwt()); window.storage.set('__appAuthBootstrapped', '1');
  await new BookingWebSessionBootstrap(h.auth, { createWindow: () => window }).openBookingWebsite();
  assert.equal(window.reloads, 0);
});
test('navigation race never injects token into another origin', async () => {
  const h = authHarness({ token: jwt(), savedAt: now });
  const window = new WebWindow();
  window.duringExecute = () => { window.url = 'https://evil.example.com/'; };
  await assert.rejects(new BookingWebSessionBootstrap(h.auth, { createWindow: () => window }).openBookingWebsite(), { code: 'WEB_BOOTSTRAP_FAILED' });
  assert.equal(window.storage.size, 0);
  assert.equal(window.closes, 1);
});
test('bootstrap refuses endless reload if website removes storage', async () => {
  const h = authHarness({ token: jwt(), savedAt: now });
  const window = new WebWindow();
  window.duringExecute = () => window.storage.clear();
  await assert.rejects(new BookingWebSessionBootstrap(h.auth, { createWindow: () => window }).openBookingWebsite(), { code: 'WEB_BOOTSTRAP_FAILED' });
  assert.equal(window.reloads, 1);
  assert.equal(window.shows, 0);
});
