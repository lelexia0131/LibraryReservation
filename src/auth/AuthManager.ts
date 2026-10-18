import { AuthCancelledError, AuthError, LoginRequiredError } from './authErrors.js';
import type { CasTokenProvider } from './CasTokenProvider.js';
import type { SavedToken, SecureTokenStore } from './SecureTokenStore.js';
import type { TokenProvider } from './TokenProvider.js';
import { parseJwtExpiry, TokenValidator } from './TokenValidator.js';
import type { LoginInput, SecureCredentialStore } from './Credentials.js';

export type AuthState = 'UNKNOWN' | 'CHECKING' | 'AUTHENTICATED' | 'SILENT_REFRESH' | 'LOGIN_REQUIRED' | 'AUTHENTICATING' | 'VERIFICATION_REQUIRED' | 'FAILED';
export interface AuthStatus {
  state: AuthState; hasCachedToken: boolean; tokenExpiresAt?: number; casSessionAvailable?: boolean; errorCode?: string;
}

export class AuthManager implements TokenProvider {
  private status: AuthStatus = { state: 'UNKNOWN', hasCachedToken: false };
  private cached: SavedToken | null = null;
  private authPromise?: Promise<string>;
  private mutation?: Promise<void>;
  private controller?: AbortController;
  private interactive = false;
  private pendingCredentials?: LoginInput;
  private official = false;
  private failure?: { error: AuthError; until: number };
  private networkFailures = 0;
  constructor(private readonly store: SecureTokenStore, private readonly cas: CasTokenProvider,
    private readonly validator = new TokenValidator(), private readonly now: () => number = Date.now,
    private readonly logger: (message: string) => void = () => {}, private readonly credentials?: SecureCredentialStore) {}

  getStatus(): AuthStatus { return { ...this.status }; }

  async initialize(): Promise<AuthStatus> {
    try { await this.acquire(false); }
    catch (error) { if (!(error instanceof LoginRequiredError)) throw error; }
    return this.getStatus();
  }

  getToken(): Promise<string> { return this.acquire(true); }
  async login(input: LoginInput): Promise<string> {
    await this.clear(true);
    this.pendingCredentials = { ...input };
    try { return await this.acquire(false); }
    finally { this.pendingCredentials = undefined; }
  }
  async verifyOfficial(): Promise<string> {
    await this.cancelAuthentication();
    this.failure = undefined;
    this.official = true;
    try { return await this.acquire(true); }
    finally { this.official = false; this.pendingCredentials = undefined; }
  }
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
    if (this.failure && this.now() < this.failure.until) return Promise.reject(this.failure.error);
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
    let saving = false;
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
        official: this.official,
        credentials: async () => this.pendingCredentials ?? await this.credentials?.get() ?? null,
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
        saving = true;
        await this.store.set(saved);
        checkCancelled();
        if (this.pendingCredentials?.remember) {
          if (!this.credentials) throw new AuthError('SECURE_STORAGE_UNAVAILABLE', '');
          await this.credentials.set({ username: this.pendingCredentials.username, password: this.pendingCredentials.password });
          checkCancelled();
        }
        this.cached = saved;
        this.logger('[Auth] Token saved securely.');
      });
      checkCancelled();
      this.status = { state: 'AUTHENTICATED', hasCachedToken: true, tokenExpiresAt: parseJwtExpiry(token), casSessionAvailable: true };
      this.failure = undefined;
      this.networkFailures = 0;
      this.logger('[Auth] Booking authentication successful.');
      this.logger('[Auth] Booking token refreshed.');
      return token;
    } catch (error) {
      if (saving) {
        this.cached = null;
        const cleared = await Promise.allSettled([this.store.clear(), ...(this.pendingCredentials?.remember ? [this.credentials?.clear()] : [])]);
        if (cleared.some(result => result.status === 'rejected')) error = new AuthError('AUTH_CLEAR_FAILED', '');
      }
      // One later retry after a network outage; repeated authentication failure stops polling.
      if (error instanceof AuthError && error.transient && ++this.networkFailures >= 2) error = new AuthError(error.code, '');
      if (error instanceof AuthCancelledError) {
        this.cached = null;
        try { await this.store.clear(); }
        catch {
          this.status = { state: 'FAILED', hasCachedToken: false };
          throw new AuthError('AUTH_CLEAR_FAILED', 'Cancelled login state could not be cleared.');
        }
        this.status = { state: 'LOGIN_REQUIRED', hasCachedToken: false };
      }
      this.status = { ...this.status, state: error instanceof AuthError && error.code === 'MANUAL_VERIFICATION_REQUIRED' ? 'VERIFICATION_REQUIRED'
        : error instanceof LoginRequiredError || error instanceof AuthCancelledError || (error instanceof AuthError && error.code === 'CREDENTIALS_INVALID') ? 'LOGIN_REQUIRED' : 'FAILED',
        ...(error instanceof AuthError ? { errorCode: error.code } : {}) };
      if (error instanceof AuthError && !(error instanceof AuthCancelledError) && !(error instanceof LoginRequiredError)) {
        this.failure = { error, until: error.transient ? this.now() + 30000 : Infinity };
        if (error.code === 'CREDENTIALS_INVALID') {
          this.pendingCredentials = undefined;
          try { await this.credentials?.clear(); } catch { throw new AuthError('AUTH_CLEAR_FAILED', ''); }
        }
      }
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
      this.failure = undefined;
      if (full) { this.pendingCredentials = undefined; this.networkFailures = 0; }
      this.status = { state: 'LOGIN_REQUIRED', hasCachedToken: false, ...(full ? { casSessionAvailable: false } : {}) };
      // Always attempt both clears, even if either adapter fails.
      const results = await Promise.allSettled([this.store.clear(), ...(full ? [this.cas.clearSession(), this.credentials?.clear()] : [])]);
      if (results.some(result => result.status === 'rejected')) {
        this.status.state = 'FAILED';
        throw new AuthError('AUTH_CLEAR_FAILED', 'Login state could not be fully cleared; retry logout.');
      }
    }).finally(() => { this.mutation = undefined; });
    return this.mutation;
  }
}
