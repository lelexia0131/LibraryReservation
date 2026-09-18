import type { AuthManager } from './AuthManager.js';
import { AuthError } from './authErrors.js';

export async function runAuthCommand(command: string, auth: AuthManager, log: (message: string) => void): Promise<void> {
  switch (command) {
    case 'test': await auth.getToken(); log('[Auth] Authentication successful.'); return;
    case 'clear-token': await auth.clearBookingToken(); log('[Auth] Booking token cleared; CAS session retained.'); return;
    case 'logout': await auth.logout(); log('[Auth] Local booking and CAS login state cleared.'); return;
    default: throw new AuthError('INVALID_AUTH_COMMAND', 'Expected test, clear-token or logout.');
  }
}
