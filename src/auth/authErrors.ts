import { BookingError } from '../errors.js';

export class AuthError extends BookingError {
  constructor(code: string, message: string) { super(code, message); this.name = 'AuthError'; }
}
export class AuthCancelledError extends AuthError {
  constructor() { super('AUTH_CANCELLED', 'Authentication cancelled.'); }
}
export class LoginRequiredError extends AuthError {
  constructor() { super('LOGIN_REQUIRED', 'Interactive login required.'); }
}
export class CasTokenExchangeError extends AuthError {
  constructor() { super('CAS_TOKEN_EXCHANGE_FAILED', 'CAS token exchange failed; details withheld.'); }
}
export function adapterUnavailable(): AuthError {
  return new AuthError('AUTH_ADAPTER_UNAVAILABLE', 'This Node CLI has no desktop adapters. Supply CasBrowserAdapter and SecureTokenStore from a desktop host; see docs/auth.md.');
}
