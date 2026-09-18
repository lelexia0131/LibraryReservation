import type { CasBrowserAdapter } from './CasBrowserAdapter.js';
import { AuthCancelledError, AuthError, LoginRequiredError } from './authErrors.js';
import { CAS_LOGIN_URL, CAS_PARTITION, extractCasFromUrl, isCasLoginUrl } from './casUrlParser.js';

export interface CasLoginOptions {
  signal: AbortSignal;
  allowInteractive(): boolean;
  onLoginRequired(): void;
  onAuthenticating(): void;
  onCallback(silent: boolean): void;
}

export class PersistentCasSession {
  private active = false;
  constructor(private readonly browser: CasBrowserAdapter, private readonly silentTimeoutMs = 8000,
    private readonly interactiveTimeoutMs = 300000) {}

  async authenticate<T>(options: CasLoginOptions, consume: (cas: string) => Promise<T>): Promise<T> {
    if (options.signal.aborted) throw new AuthCancelledError();
    if (this.active) throw new AuthError('AUTH_IN_PROGRESS', 'Authentication already in progress.');
    this.active = true;
    let window: ReturnType<CasBrowserAdapter['createWindow']> | undefined;
    const unsubscribe: Array<() => void> = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let consumption: Promise<unknown> | undefined;
    try {
      window = this.browser.createWindow({ partition: CAS_PARTITION, show: false, title: '浙江大学统一身份认证',
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
      const current = window;
      const result = await new Promise<T>((resolve, reject) => {
        let captured = false;
        let finished = false;
        let shown = false;
        const fail = (error: AuthError) => { finished = true; reject(error); };
        const cancel = () => fail(new AuthCancelledError());
        unsubscribe.push(current.onClosed(cancel), current.onLoadFailed(() => {
          if (!captured) fail(new AuthError('CAS_NAVIGATION_FAILED', 'CAS page could not be loaded.'));
        }));
        options.signal.addEventListener('abort', cancel, { once: true });
        unsubscribe.push(() => options.signal.removeEventListener('abort', cancel));
        unsubscribe.push(current.onNavigation(event => {
          if (finished || captured || !event.isMainFrame) return;
          const cas = extractCasFromUrl(event.url);
          if (!cas) return;
          captured = true;
          clearTimeout(timer);
          options.onCallback(!shown);
          // cas is retained only by this in-memory exchange; never log a navigation URL.
          consumption = consume(cas).then(value => {
            if (finished) return;
            current.setTitle('认证成功');
            finished = true;
            resolve(value);
          }).catch(error => fail(error instanceof AuthError ? error : new AuthError('AUTH_COMPLETION_FAILED', 'Authentication could not be completed.')));
        }));
        timer = setTimeout(() => {
          if (finished || captured) return;
          if (!isCasLoginUrl(current.getURL())) {
            fail(new AuthError('CAS_SILENT_TIMEOUT', 'Silent CAS navigation timed out.'));
            return;
          }
          options.onLoginRequired();
          if (!options.allowInteractive()) { fail(new LoginRequiredError()); return; }
          shown = true;
          options.onAuthenticating();
          current.show();
          timer = setTimeout(() => fail(new AuthError('CAS_LOGIN_TIMEOUT', 'Interactive CAS login timed out.')), this.interactiveTimeoutMs);
        }, this.silentTimeoutMs);
        void current.loadURL(CAS_LOGIN_URL).catch(() => {
          if (!captured) fail(new AuthError('CAS_NAVIGATION_FAILED', 'CAS page could not be loaded.'));
        });
      });
      return result;
    } finally {
      clearTimeout(timer);
      for (const remove of unsubscribe) remove();
      window?.close();
      // A logout must wait for any in-flight secure write before clearing it.
      await consumption;
      this.active = false;
    }
  }

  async clear(): Promise<void> {
    try { await this.browser.clearSession(CAS_PARTITION); }
    catch { throw new AuthError('CAS_SESSION_CLEAR_FAILED', 'Browser login state could not be cleared.'); }
  }
}
