import { BrowserWindow, session, type Session } from 'electron';
import type { CasBrowserAdapter, CasNavigation } from '../../src/auth/CasBrowserAdapter.js';
import type { BookingWebWindow } from '../../src/auth/BookingWebSessionBootstrap.js';
import { CAS_PARTITION, extractCasFromUrl } from '../../src/auth/casUrlParser.js';
import { allowedRemoteUrl, blockedRemoteRequest, handleNavigation, upgradeOfficialUrl } from './navigationPolicy.js';

export type RemoteWindowOptions = Parameters<CasBrowserAdapter['createWindow']>[0];

// Shared by both adapters: one request interceptor per persistent session.
export class RemoteWindowHost {
  private readonly windows = new Map<number, ElectronRemoteWindow>();
  readonly session: Session;
  constructor() {
    this.session = session.fromPartition(CAS_PARTITION);
    this.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    this.session.setPermissionCheckHandler(() => false);
    this.session.on('will-download', event => event.preventDefault());
    this.session.webRequest.onBeforeRequest((details, callback) => {
      const window = this.windows.get(details.webContentsId ?? -1);
      const main = details.resourceType === 'mainFrame';
      const upgraded = main ? upgradeOfficialUrl(details.url) : undefined;
      if (upgraded) { callback({ redirectURL: upgraded }); return; }
      const captured = main && window?.captureCallback(details.url);
      callback({ cancel: Boolean(captured) || blockedRemoteRequest(details.url) || (main && !allowedRemoteUrl(details.url)) });
    });
  }
  create(options: RemoteWindowOptions, capture: boolean): ElectronRemoteWindow {
    const native = new BrowserWindow({ width: 980, height: 760, minWidth: 760, minHeight: 600,
      show: false, title: options.title, autoHideMenuBar: true,
      webPreferences: { ...options.webPreferences, partition: options.partition, devTools: false } });
    native.setMenu(null);
    const remote = new ElectronRemoteWindow(native, capture);
    const id = native.webContents.id;
    this.windows.set(id, remote);
    native.on('closed', () => this.windows.delete(id));
    return remote;
  }
  async clear(): Promise<void> {
    for (const window of this.windows.values()) window.close();
    await this.session.clearStorageData();
    await this.session.clearCache();
    await this.session.closeAllConnections();
  }
}

export class ElectronRemoteWindow implements BookingWebWindow {
  private readonly navigation = new Set<(event: CasNavigation) => void>();
  constructor(readonly window: BrowserWindow, private readonly capture: boolean) {
    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('will-navigate', (event, url) => this.navigate(url, true, () => event.preventDefault()));
    contents.on('will-redirect', (event, url, _inPlace, main) => this.navigate(url, main, () => event.preventDefault()));
    contents.on('did-navigate', (_event, url) => this.navigate(url, true, () => contents.stop()));
    contents.on('did-navigate-in-page', (_event, url, main) => this.navigate(url, main, () => contents.stop()));
  }
  private report(url: string): void { for (const listener of this.navigation) listener({ url, isMainFrame: true }); }
  private navigate(url: string, main: boolean, prevent: () => void): void {
    const upgraded = main ? upgradeOfficialUrl(url) : undefined;
    if (upgraded) {
      prevent();
      void this.loadURL(upgraded).catch(() => {});
      return;
    }
    handleNavigation(url, main, prevent, value => this.report(value), this.capture);
  }
  captureCallback(url: string): boolean {
    if (!this.capture || !extractCasFromUrl(url)) return false;
    this.report(url);
    return true;
  }
  onNavigation(listener: (event: CasNavigation) => void): () => void {
    this.navigation.add(listener); return () => { this.navigation.delete(listener); };
  }
  onClosed(listener: () => void): () => void {
    this.window.on('closed', listener); return () => { this.window.removeListener('closed', listener); };
  }
  onLoadFailed(listener: () => void): () => void {
    const handler = (_event: Electron.Event, code: number, _description: string, _url: string, main: boolean) => {
      if (main && code !== -3) listener(); // ERR_ABORTED is expected when capturing the callback.
    };
    this.window.webContents.on('did-fail-load', handler);
    return () => { this.window.webContents.removeListener('did-fail-load', handler); };
  }
  async loadURL(url: string): Promise<void> {
    if (!allowedRemoteUrl(url)) throw new Error('Navigation denied');
    try { await this.window.loadURL(url); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ERR_ABORTED')) throw error;
    }
  }
  getURL(): string { return this.window.webContents.getURL(); }
  show(): void { if (!this.window.isDestroyed()) this.window.show(); }
  setTitle(title: string): void { if (!this.window.isDestroyed()) this.window.setTitle(title); }
  close(): void { if (!this.window.isDestroyed()) this.window.destroy(); }
  onDomReady(listener: () => void): () => void {
    this.window.webContents.on('dom-ready', listener);
    return () => { this.window.webContents.removeListener('dom-ready', listener); };
  }
  async executeInIsolatedWorld(source: string): Promise<unknown> {
    return this.window.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: source }]);
  }
  reload(): void { this.window.webContents.reload(); }
}

export class ElectronCasBrowserAdapter implements CasBrowserAdapter {
  constructor(private readonly host: RemoteWindowHost) {}
  createWindow(options: RemoteWindowOptions): ElectronRemoteWindow { return this.host.create(options, true); }
  async clearSession(_partition: typeof CAS_PARTITION): Promise<void> { await this.host.clear(); }
}
