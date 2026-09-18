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
import { authHarness, FakeBrowser, jwt } from './authFixtures.js';
import { harness, normalResponse, seat } from './fixtures.js';

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
const h = harness(async request => {
  await new Promise(resolve => setTimeout(resolve, 100));
  return unavailable && request.path.endsWith('/seat') ? { code: 1, data: [{ ...seat, status: '2', status_name: '已预约' }] } : normalResponse(request);
});
const controller = new DesktopController(auth, { openBookingWebsite: async () => {} },
  () => new BookingService(auth, () => h.api, () => {}));
const renderer = join(process.cwd(), 'out/renderer/index.html');
const window = new BrowserWindow({ width: 1000, height: 780, minWidth: 760, minHeight: 600, show: false,
  webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: join(process.cwd(), 'out/preload.cjs') } });
window.setMenu(null);
registerIpc(ipcMain, window, pathToFileURL(renderer).href, controller);
Object.assign(globalThis, { desktopTest: {
  unavailable: () => { unavailable = true; },
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
app.on('window-all-closed', () => app.quit());
});
