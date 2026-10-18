// Integration-only entry point. Never included in the installer or production main bundle.
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AuthManager } from '../src/auth/AuthManager.js';
import { CasTokenProvider } from '../src/auth/CasTokenProvider.js';
import { PersistentCasSession } from '../src/auth/PersistentCasSession.js';
import { HttpCasSession } from '../src/auth/HttpCasSession.js';
import { EncryptedFileCredentialStore } from '../src/auth/stores/EncryptedFileCredentialStore.js';
import { EncryptedFileTokenStore } from '../src/auth/stores/EncryptedFileTokenStore.js';
import { ElectronCredentialCipher } from '../electron/adapters/ElectronCredentialCipher.js';
import { LibraryController } from '../src/application/LibraryController.js';
import { registerIpc } from '../electron/ipc.js';
import { BookingService } from '../src/domain/BookingService.js';
import { BookingApi } from '../src/api/bookingApi.js';
import { AxiosError } from 'axios';
import { authHarness, FakeBrowser, jwt } from './authFixtures.js';
import { area, fixedClock, harness, indexResponse, normalResponse, seat } from './fixtures.js';

app.setPath('userData', join(process.cwd(), '.artifacts', 'integration-profile'));
void app.whenReady().then(async () => {
const store = new EncryptedFileTokenStore(app.getPath('userData'), new ElectronCredentialCipher(safeStorage));
await store.clear();
const browser = new FakeBrowser();
const credentials = new EncryptedFileCredentialStore(app.getPath('userData'), new ElectronCredentialCipher(safeStorage));
await credentials.clear();
const hAuth = authHarness();
hAuth.respond(() => ({ code: 1, member: { token: jwt(Math.floor(Date.now() / 1000) + 3600) } }));
const provider = new CasTokenProvider(new PersistentCasSession(browser, undefined, undefined, new HttpCasSession({
  async request(url, method, body) {
    if (url.includes('/api/cas/cas')) return { status: 302, body: '', location: 'https://zjuam.zju.edu.cn/cas/login' };
    if (url.endsWith('getKaptchaStatus')) return { status: 200, body: 'false' };
    if (url.endsWith('getPubKey')) return { status: 200, body: JSON.stringify({ modulus: 'b'.repeat(128), exponent: '10001' }) };
    if (method === 'POST') {
      if (new URLSearchParams(body).get('username') !== 'synthetic-user') throw new Error('Invalid test input');
      return { status: 302, body: '', location: 'https://booking.lib.zju.edu.cn/h5/index.html#/cas?cas=synthetic-cas' };
    }
    return { status: 200, body: '<input name="execution" value="synthetic-execution">' };
  },
})), hAuth.http);
const auth = new AuthManager(store, provider, undefined, undefined, undefined, credentials);
let unavailable = false;
let unknownConfirm = false;
const h = harness(async request => {
  await new Promise(resolve => setTimeout(resolve, 100));
  if (request.path.endsWith('/index')) return { code: 0, data: { ...indexResponse.data, premises: [{ id: '86', name: '主馆' }] } };
  if (request.path.endsWith('/list')) return { code: 0, data: { count: 2, list: [
    { ...area, premisesName: '主馆', free_num: unavailable ? 0 : 26, total_num: 30 },
    { ...area, id: '908', premisesName: '主馆', name: '南区', free_num: 0, total_num: 20 },
  ] } };
  if (request.path.endsWith('/confirm') && unknownConfirm) throw new AxiosError('synthetic timeout', 'ETIMEDOUT', request.config);
  return unavailable && request.path.endsWith('/seat') ? { code: 1, data: [{ ...seat, status: '2', status_name: '已预约' }] } : normalResponse(request);
});
const controller = new LibraryController(auth, { openBookingWebsite: async () => {} },
  (_token, signal, authority) => new BookingApi(h.http, fixedClock, authority?.consume, signal),
  () => new BookingService(auth, () => h.api, () => {}));
const renderer = join(process.cwd(), 'out/renderer/index.html');
const window = new BrowserWindow({ width: 1160, height: 900, minWidth: 760, minHeight: 600, show: false,
  webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: join(process.cwd(), 'out/preload.cjs') } });
window.setMenu(null);
registerIpc(ipcMain, window, pathToFileURL(renderer).href, controller);
Object.assign(globalThis, { desktopTest: {
  unavailable: () => { unavailable = true; },
  available: () => { unavailable = false; },
  unknown: () => { unknownConfirm = true; },
  requests: () => h.requests.map(request => request.path),
  restored: async () => {
    const before = browser.windows.length;
    const restored = await new AuthManager(store, provider).initialize();
    return restored.state === 'AUTHENTICATED' && before === browser.windows.length;
  },
  cleared: async () => (await store.get()) === null && (await credentials.get()) === null && browser.clears === 2,
  encrypted: async () => {
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(join(app.getPath('userData'), 'auth/token.bin'));
    const secrets = await readFile(join(app.getPath('userData'), 'auth/credentials.bin'));
    return !bytes.toString('utf8').includes('synthetic') && !secrets.toString('utf8').includes('synthetic') && safeStorage.isEncryptionAvailable();
  },
} });
void auth.initialize().catch(() => {});
await window.loadFile(renderer);
app.on('window-all-closed', () => { void controller.shutdown().finally(() => app.quit()); });
});
