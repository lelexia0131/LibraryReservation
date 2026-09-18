import { EnvironmentTokenProvider } from './EnvironmentTokenProvider.js';
import type { TokenProvider } from './TokenProvider.js';
import type { SecureTokenStore } from './SecureTokenStore.js';
import type { CasBrowserAdapter } from './CasBrowserAdapter.js';
import { AuthManager } from './AuthManager.js';
import { CasTokenProvider } from './CasTokenProvider.js';
import { PersistentCasSession } from './PersistentCasSession.js';
import { AuthError, adapterUnavailable } from './authErrors.js';

export interface DesktopAuthAdapters { store: SecureTokenStore; browser: CasBrowserAdapter }

export function createPersistentAuth(adapters?: DesktopAuthAdapters, logger?: (message: string) => void): AuthManager {
  if (!adapters) throw adapterUnavailable();
  return new AuthManager(adapters.store, new CasTokenProvider(new PersistentCasSession(adapters.browser)), undefined, undefined, logger);
}

// Desktop hosts default to persistent-cas; the existing Node CLI explicitly defaults to env.
export function createTokenProvider(env: NodeJS.ProcessEnv, adapters?: DesktopAuthAdapters, defaultMode = 'persistent-cas'): TokenProvider {
  const mode = env.AUTH_MODE ?? defaultMode;
  if (mode === 'env') return new EnvironmentTokenProvider(env);
  if (mode === 'persistent-cas') return createPersistentAuth(adapters);
  throw new AuthError('INVALID_AUTH_MODE', 'AUTH_MODE must be env or persistent-cas.');
}
