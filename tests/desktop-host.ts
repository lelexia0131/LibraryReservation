// Integration-only entry point. Never included in the installer or production main bundle.
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AuthManager } from '../src/auth/AuthManager.js';
import { CasTokenProvider } from '../src/auth/CasTokenProvider.js';
import { PersistentCasSession } from '../src/auth/PersistentCasSession.js';
import { EncryptedFileTokenStore } from '../src/auth/SecureTokenStore.js';
import { ElectronCredentialCipher } from '../electron/adapters/ElectronCredentialCipher.js';
import { DesktopController } from '../electron/desktopController.js';
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
const hAuth = authHarness();
hAuth.respond(() => ({ code: 1, member: { token: jwt(Math.floor(Date.now() / 1000) + 3600) } }));
const provider = new CasTokenProvider(new PersistentCasSession(browser), hAuth.http);
const auth = new AuthManager(store, provider);
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
const controller = new DesktopController(auth, { openBookingWebsite: async () => {} },
  () => new BookingService(auth, () => h.api, () => {}),
  (_token, signal, authority) => new BookingApi(h.http, fixedClock, authority?.consume, signal));
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
  cleared: async () => (await store.get()) === null && browser.clears === 1,
  encrypted: async () => {
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(join(app.getPath('userData'), 'auth/token.bin'));
    return !bytes.toString('utf8').includes('synthetic') && safeStorage.isEncryptionAvailable();
  },
} });
await window.loadFile(renderer);
app.on('window-all-closed', () => { void controller.shutdown().finally(() => app.quit()); });
});
