import type { AuthManager } from './AuthManager.js';
import type { CasBrowserAdapter, CasBrowserWindow } from './CasBrowserAdapter.js';
import { AuthCancelledError, AuthError } from './authErrors.js';
import { BOOKING_ORIGIN, CAS_PARTITION, isBookingUrl } from './casUrlParser.js';

export interface BookingWebWindow extends CasBrowserWindow {
  onDomReady(listener: () => void): () => void;
  // Host executes in an isolated world, never exposes this method to a renderer.
  executeInIsolatedWorld(source: string): Promise<unknown>;
  reload(): void;
}
export interface BookingWebBrowserAdapter {
  createWindow(options: Parameters<CasBrowserAdapter['createWindow']>[0]): BookingWebWindow;
}

export class BookingWebSessionBootstrap {
  constructor(private readonly auth: AuthManager, private readonly browser: BookingWebBrowserAdapter,
    private readonly timeoutMs = 15000) {}

  async openBookingWebsite(): Promise<void> {
    const token = await this.auth.getToken();
    const window = this.browser.createWindow({ partition: CAS_PARTITION, show: false, title: '浙江大学图书馆',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    const unsubscribe: Array<() => void> = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let success = false;
    try {
      await new Promise<void>((resolve, reject) => {
        let busy = false;
        let reloaded = false;
        let finished = false;
        const fail = () => { finished = true; reject(new AuthError('WEB_BOOTSTRAP_FAILED', 'Booking website login could not be restored.')); };
        timer = setTimeout(fail, this.timeoutMs);
        unsubscribe.push(window.onClosed(() => { finished = true; reject(new AuthCancelledError()); }), window.onLoadFailed(fail));
        unsubscribe.push(window.onDomReady(() => {
          if (finished || busy) return;
          if (!isBookingUrl(window.getURL())) { fail(); return; }
          busy = true;
          // Check the origin again inside the document to prevent a navigation race.
          const script = `(() => {
            if (location.origin !== ${JSON.stringify(BOOKING_ORIGIN)}) return 'wrong-origin';
            const token = ${JSON.stringify(token)};
            if (sessionStorage.getItem('__appAuthBootstrapped') === '1' && sessionStorage.getItem('token') === token) return 'ready';
            sessionStorage.setItem('token', token);
            sessionStorage.setItem('isCas', 'true');
            sessionStorage.setItem('__appAuthBootstrapped', '1');
            return 'reload';
          })()`;
          void window.executeInIsolatedWorld(script).then(result => {
            busy = false;
            if (finished) return;
            if (result === 'reload' && !reloaded) { reloaded = true; window.reload(); }
            else if (result === 'ready') { finished = true; window.show(); resolve(); }
            else fail();
          }).catch(fail);
        }));
        void window.loadURL(`${BOOKING_ORIGIN}/h5/index.html`).catch(fail);
      });
      success = true;
    } finally {
      clearTimeout(timer);
      for (const remove of unsubscribe) remove();
      if (!success) window.close();
    }
  }
}
