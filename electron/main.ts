import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AuthManager } from '../src/auth/AuthManager.js';
import { CasTokenProvider } from '../src/auth/CasTokenProvider.js';
import { PersistentCasSession } from '../src/auth/PersistentCasSession.js';
import { EncryptedFileTokenStore } from '../src/auth/SecureTokenStore.js';
import { BookingWebSessionBootstrap } from '../src/auth/BookingWebSessionBootstrap.js';
import { ElectronCredentialCipher } from './adapters/ElectronCredentialCipher.js';
import { ElectronCasBrowserAdapter, RemoteWindowHost } from './adapters/ElectronCasBrowserAdapter.js';
import { ElectronBookingWebBrowserAdapter } from './adapters/ElectronBookingWebBrowserAdapter.js';
import { DesktopController } from './desktopController.js';
import { registerIpc } from './ipc.js';

app.setName('LibraryReservation');
app.setAppUserModelId('cn.libraryreservation.desktop');
let mainWindow: BrowserWindow | undefined;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show(); mainWindow?.focus();
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const host = new RemoteWindowHost();
    const store = new EncryptedFileTokenStore(app.getPath('userData'), new ElectronCredentialCipher(safeStorage));
    const auth = new AuthManager(store, new CasTokenProvider(new PersistentCasSession(new ElectronCasBrowserAdapter(host))));
    const website = new BookingWebSessionBootstrap(auth, new ElectronBookingWebBrowserAdapter(host));
    const controller = new DesktopController(auth, website);
    let shuttingDown = false;
    app.on('before-quit', event => {
      if (shuttingDown) return;
      event.preventDefault(); shuttingDown = true;
      void controller.shutdown().finally(() => app.quit());
    });
    const renderer = join(__dirname, 'renderer', 'index.html');
    mainWindow = new BrowserWindow({ width: 1160, height: 900, minWidth: 760, minHeight: 600, show: false,
      title: '浙江大学图书馆预约助手', backgroundColor: '#f5f7fa', icon: join(__dirname, 'icon.ico'),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true,
        devTools: !app.isPackaged, preload: join(__dirname, 'preload.cjs') } });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', event => event.preventDefault());
    mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
    mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    mainWindow.webContents.session.setPermissionCheckHandler(() => false);
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    mainWindow.on('closed', () => { mainWindow = undefined; app.quit(); });
    registerIpc(ipcMain, mainWindow, pathToFileURL(renderer).href, controller);
    // Start silently; status polling renders progress without exposing credentials.
    void auth.initialize().catch(() => {});
    await mainWindow.loadFile(renderer);
    mainWindow.show();
  }).catch(() => {
    dialog.showErrorBox('无法打开应用', '应用启动失败，请重新安装后再试。');
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
}
