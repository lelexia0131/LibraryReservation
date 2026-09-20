import { AuthCancelledError, AuthError, LoginRequiredError } from './authErrors.js';
import type { CasTokenProvider } from './CasTokenProvider.js';
import type { SavedToken, SecureTokenStore } from './SecureTokenStore.js';
import type { TokenProvider } from './TokenProvider.js';
import { parseJwtExpiry, TokenValidator } from './TokenValidator.js';

export type AuthState = 'UNKNOWN' | 'CHECKING' | 'AUTHENTICATED' | 'SILENT_REFRESH' | 'LOGIN_REQUIRED' | 'AUTHENTICATING' | 'FAILED';
export interface AuthStatus {
  state: AuthState; hasCachedToken: boolean; tokenExpiresAt?: number; casSessionAvailable?: boolean;
}

export class AuthManager implements TokenProvider {
  private status: AuthStatus = { state: 'UNKNOWN', hasCachedToken: false };
  private cached: SavedToken | null = null;
  private authPromise?: Promise<string>;
  private mutation?: Promise<void>;
  private controller?: AbortController;
  private interactive = false;
  constructor(private readonly store: SecureTokenStore, private readonly cas: CasTokenProvider,
    private readonly validator = new TokenValidator(), private readonly now: () => number = Date.now,
    private readonly logger: (message: string) => void = () => {}) {}

  getStatus(): AuthStatus { return { ...this.status }; }

  async initialize(): Promise<AuthStatus> {
    try { await this.acquire(false); }
    catch (error) { if (!(error instanceof LoginRequiredError)) throw error; }
    return this.getStatus();
  }

  getToken(): Promise<string> { return this.acquire(true); }
  async cancelAuthentication(): Promise<void> {
    this.controller?.abort();
    await this.authPromise?.catch(() => {});
  }

  private acquire(interactive: boolean): Promise<string> {
    if (this.mutation) return this.mutation.then(() => this.acquire(interactive));
    if (this.authPromise) {
      this.interactive ||= interactive;
      return this.authPromise;
    }
    this.interactive = interactive;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.authPromise = this.authenticate(signal).finally(() => {
      this.authPromise = undefined;
      this.controller = undefined;
    });
    return this.authPromise;
  }

  private async authenticate(signal: AbortSignal): Promise<string> {
    const checkCancelled = () => { if (signal.aborted) throw new AuthCancelledError(); };
    this.status = { ...this.status, state: 'CHECKING' };
    try {
      this.cached ??= await this.store.get();
      checkCancelled();
      if (this.cached && this.validator.isUsable(this.cached.token)) {
        this.status = { ...this.status, state: 'AUTHENTICATED', hasCachedToken: true, tokenExpiresAt: parseJwtExpiry(this.cached.token) };
        this.logger('[Auth] Cached booking token is valid.');
        return this.cached.token;
      }
      this.cached = null;
      await this.store.clear();
      checkCancelled();
      this.status = { state: 'SILENT_REFRESH', hasCachedToken: false };
      this.logger('[Auth] Cached token unavailable.');
      this.logger('[Auth] Trying silent CAS SSO...');
      const token = await this.cas.authenticate({ signal, allowInteractive: () => this.interactive,
        onLoginRequired: () => {
          this.status = { state: 'LOGIN_REQUIRED', hasCachedToken: false, casSessionAvailable: false };
          this.logger('[Auth] Interactive login required.');
        },
        onAuthenticating: () => { this.status = { ...this.status, state: 'AUTHENTICATING' }; },
        onCallback: silent => {
          this.status = { ...this.status, casSessionAvailable: true };
          this.logger('[Auth] CAS callback received.');
          if (silent) this.logger('[Auth] Silent CAS SSO successful.');
        },
      }, async token => {
        checkCancelled();
        // Unknown or already expired exp cannot become a permanently reusable cache entry.
        if (!this.validator.isUsable(token)) throw new AuthError('TOKEN_EXPIRY_INVALID', 'New booking token has no usable expiry.');
        const saved = { token, savedAt: this.now(), expiresAt: parseJwtExpiry(token) };
        await this.store.set(saved);
        checkCancelled();
        this.cached = saved;
        this.logger('[Auth] Token saved securely.');
      });
      checkCancelled();
      this.status = { state: 'AUTHENTICATED', hasCachedToken: true, tokenExpiresAt: parseJwtExpiry(token), casSessionAvailable: true };
      this.logger('[Auth] Booking authentication successful.');
      this.logger('[Auth] Booking token refreshed.');
      return token;
    } catch (error) {
      if (error instanceof AuthCancelledError) {
        this.cached = null;
        try { await this.store.clear(); }
        catch {
          this.status = { state: 'FAILED', hasCachedToken: false };
          throw new AuthError('AUTH_CLEAR_FAILED', 'Cancelled login state could not be cleared.');
        }
        this.status = { state: 'LOGIN_REQUIRED', hasCachedToken: false };
      }
      this.status = { ...this.status, state: error instanceof LoginRequiredError || error instanceof AuthCancelledError ? 'LOGIN_REQUIRED' : 'FAILED' };
      if (error instanceof AuthError) throw error;
      throw new AuthError('AUTH_FAILED', 'Authentication failed; details withheld.');
    }
  }

  clearBookingToken(): Promise<void> { return this.clear(false); }
  logout(): Promise<void> { return this.clear(true); }
  invalidateToken(rejectedToken: string): Promise<void> { return this.clear(false, rejectedToken); }

  private clear(full: boolean, rejectedToken?: string): Promise<void> {
    if (this.mutation) return this.mutation.then(() => this.clear(full, rejectedToken));
    // Block new getToken calls synchronously, including while checking a stale 401.
    this.mutation = Promise.resolve().then(async () => {
      if (rejectedToken !== undefined) {
        const saved = this.cached ?? await this.store.get();
        if (!saved || saved.token !== rejectedToken) return;
      }
      this.controller?.abort();
      await this.authPromise?.catch(() => {});
      this.cached = null;
      this.status = { state: 'LOGIN_REQUIRED', hasCachedToken: false, ...(full ? { casSessionAvailable: false } : {}) };
      // Always attempt both clears, even if either adapter fails.
      const results = await Promise.allSettled([this.store.clear(), ...(full ? [this.cas.clearSession()] : [])]);
      if (results.some(result => result.status === 'rejected')) {
        this.status.state = 'FAILED';
        throw new AuthError('AUTH_CLEAR_FAILED', 'Login state could not be fully cleared; retry logout.');
      }
    }).finally(() => { this.mutation = undefined; });
    return this.mutation;
  }
}
