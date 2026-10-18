import { AuthManager } from '../../../src/auth/AuthManager.js';
import { CasTokenProvider } from '../../../src/auth/CasTokenProvider.js';
import { PersistentCasSession } from '../../../src/auth/PersistentCasSession.js';
import { HttpCasSession, casExchangeTransport } from '../../../src/auth/HttpCasSession.js';
import { AndroidCasHttpAdapter } from './AndroidCasHttpAdapter.js';
import { HttpClient } from '../../../src/api/httpClient.js';
import { BookingApi } from '../../../src/api/bookingApi.js';
import { LibraryController } from '../../../src/application/LibraryController.js';
import { dispatch } from '../../../src/application/dispatch.js';
import { AndroidSecureTokenStore, AndroidSecureCredentialStore } from './AndroidSecureTokenStore.js';
import { AndroidHttpTransport } from './AndroidHttpTransport.js';
import { AndroidCasBrowserAdapter, casEvent } from './AndroidCasBrowserAdapter.js';
import { nativeCall, nativeReady, nativeReply, resolveNative } from './nativePort.js';

// This entry is loaded only in the private offline WebView, never in the UI asset directory.
const transport = new AndroidHttpTransport();
const casHttp = new AndroidCasHttpAdapter();
const auth = new AuthManager(new AndroidSecureTokenStore(), new CasTokenProvider(
  new PersistentCasSession(new AndroidCasBrowserAdapter(), undefined, undefined, new HttpCasSession(casHttp)),
  new HttpClient(null, casExchangeTransport(casHttp))), undefined, undefined, undefined, new AndroidSecureCredentialStore());
const controller = new LibraryController(auth, { openBookingWebsite: () => nativeCall('openWebsite') },
  (token, signal, authority) => new BookingApi(new HttpClient(token, transport, undefined,
    rejected => auth.invalidateToken(rejected), 0, auth), undefined, authority?.consume, signal));
Object.defineProperty(globalThis, 'TrustedCore', { value: Object.freeze({
  resolve: resolveNative, event: casEvent,
  dispatch: async (id: string, command: string, input?: unknown) => {
    nativeReply(id, JSON.stringify(await dispatch(controller, command, input)));
  },
  suspend: () => controller.suspend(),
  resume: () => controller.resume(),
  shutdown: async () => { await controller.shutdown(); nativeReply('shutdown', '{}'); },
}), writable: false, configurable: false });
nativeReady();
void auth.initialize().catch(() => {});
