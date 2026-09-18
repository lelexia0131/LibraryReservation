import { EventEmitter } from 'node:events';
import axios, { AxiosHeaders } from 'axios';
import { HttpClient } from '../src/api/httpClient.js';
import { AuthManager } from '../src/auth/AuthManager.js';
import type { CasBrowserAdapter, CasBrowserWindow, CasNavigation } from '../src/auth/CasBrowserAdapter.js';
import { CasTokenProvider } from '../src/auth/CasTokenProvider.js';
import { PersistentCasSession } from '../src/auth/PersistentCasSession.js';
import type { SavedToken, SecureTokenStore } from '../src/auth/SecureTokenStore.js';
import { TokenValidator } from '../src/auth/TokenValidator.js';

export const now = 1800000000000;
export const jwt = (exp: unknown = now / 1000 + 3600) => `e30.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.synthetic`;
export const callback = 'https://booking.lib.zju.edu.cn/h5/index.html#/cas?cas=synthetic-cas';
export const login = 'https://zjuam.zju.edu.cn/cas/login';
export class MemoryTokenStore implements SecureTokenStore {
  writes = 0;
  clears = 0;
  constructor(public value: SavedToken | null = null) {}
  async get() { return this.value; }
  async set(value: SavedToken) { this.writes++; this.value = value; }
  async clear() { this.clears++; this.value = null; }
}
export class FakeWindow implements CasBrowserWindow {
  events = new EventEmitter();
  url = '';
  shows = 0;
  closes = 0;
  title = '';
  onLoad: () => void = () => this.navigate(callback);
  onShow: () => void = () => this.navigate(callback);
  subscribe(name: string, listener: (...args: any[]) => void) {
    this.events.on(name, listener);
    return () => { this.events.off(name, listener); };
  }
  onNavigation(listener: (event: CasNavigation) => void) { return this.subscribe('navigation', listener); }
  onClosed(listener: () => void) { return this.subscribe('closed', listener); }
  onLoadFailed(listener: () => void) { return this.subscribe('failed', listener); }
  async loadURL(url: string) { this.url = url; queueMicrotask(this.onLoad); }
  navigate(url: string, isMainFrame = true) { if (isMainFrame) this.url = url; this.events.emit('navigation', { url, isMainFrame }); }
  getURL() { return this.url; }
  show() { this.shows++; queueMicrotask(this.onShow); }
  setTitle(title: string) { this.title = title; }
  close() { this.closes++; this.events.emit('closed'); }
}
export class FakeBrowser implements CasBrowserAdapter {
  windows: FakeWindow[] = [];
  options: Parameters<CasBrowserAdapter['createWindow']>[0][] = [];
  clears = 0;
  setup: (window: FakeWindow) => void = () => {};
  createWindow(options: Parameters<CasBrowserAdapter['createWindow']>[0]) {
    const window = new FakeWindow();
    this.setup(window);
    this.windows.push(window); this.options.push(options);
    return window;
  }
  async clearSession() { this.clears++; }
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
export function authHarness(saved: SavedToken | null = null) {
  const store = new MemoryTokenStore(saved);
  const browser = new FakeBrowser();
  const requests: Array<{ body: unknown; authorization: unknown; cookie: unknown }> = [];
  let respond: () => unknown = () => ({ code: 1, member: { token: jwt(), mobile: 'synthetic-private' } });
  const http = new HttpClient(null, axios.create({ adapter: async config => {
    requests.push({ body: JSON.parse(config.data), authorization: config.headers.get('authorization'), cookie: config.headers.get('cookie') });
    return { status: 200, statusText: 'OK', headers: new AxiosHeaders(), config, data: await respond() };
  } }));
  const logs: string[] = [];
  const session = new PersistentCasSession(browser, 10, 1000);
  const provider = new CasTokenProvider(session, http);
  const makeManager = () => new AuthManager(store, provider, new TokenValidator(() => now), () => now, message => logs.push(message));
  return { store, browser, requests, logs, http, makeManager, auth: makeManager(), respond: (fn: () => unknown) => { respond = fn; } };
}
