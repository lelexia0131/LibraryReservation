import type { CasBrowserAdapter, CasBrowserWindow, CasNavigation } from '../../../src/auth/CasBrowserAdapter.js';
import { nativeCall } from './nativePort.js';

let next = 0;
const windows = new Map<string, AndroidCasWindow>();
export function casEvent(event: { id: string; kind: string; url?: string }): void { windows.get(event.id)?.event(event); }
class AndroidCasWindow implements CasBrowserWindow {
  private readonly id = String(++next);
  private readonly created = nativeCall('casCreate', { id: this.id });
  private url = '';
  private navigation = new Set<(event: CasNavigation) => void>();
  private closed = new Set<() => void>();
  private failed = new Set<() => void>();
  constructor() { windows.set(this.id, this); }
  event(event: { kind: string; url?: string }): void {
    if (event.kind === 'navigation' && event.url) {
      this.url = event.url;
      for (const listener of this.navigation) listener({ url: event.url, isMainFrame: true });
    } else for (const listener of event.kind === 'closed' ? this.closed : this.failed) listener();
  }
  onNavigation(listener: (event: CasNavigation) => void) { this.navigation.add(listener); return () => { this.navigation.delete(listener); }; }
  onClosed(listener: () => void) { this.closed.add(listener); return () => { this.closed.delete(listener); }; }
  onLoadFailed(listener: () => void) { this.failed.add(listener); return () => { this.failed.delete(listener); }; }
  async loadURL(url: string) { await this.created; await nativeCall('casLoad', { id: this.id, url }); }
  getURL() { return this.url; }
  show() { void nativeCall('casShow', { id: this.id }).catch(() => this.event({ kind: 'failed' })); }
  setTitle(_title: string) { /* Native login window has a fixed, non-sensitive title. */ }
  close() { windows.delete(this.id); void this.created.then(() => nativeCall('casClose', { id: this.id })).catch(() => {}); }
}
export class AndroidCasBrowserAdapter implements CasBrowserAdapter {
  createWindow(): CasBrowserWindow { return new AndroidCasWindow(); }
  clearSession(): Promise<void> { return nativeCall('casClear'); }
}
