import type { CAS_PARTITION } from './casUrlParser.js';

export interface CasNavigation { url: string; isMainFrame: boolean }
export interface CasBrowserWindow {
  // Include full navigations and same-document/hash navigations, main frame only.
  onNavigation(listener: (event: CasNavigation) => void): () => void;
  onClosed(listener: () => void): () => void;
  onLoadFailed(listener: () => void): () => void;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  show(): void;
  setTitle(title: string): void;
  close(): void;
}
export interface CasBrowserAdapter {
  // Host must deny unexpected navigation/popups/permissions and never bypass TLS errors.
  createWindow(options: {
    partition: typeof CAS_PARTITION; show: false; title: string;
    webPreferences: { nodeIntegration: false; contextIsolation: true; sandbox: true };
  }): CasBrowserWindow;
  // Close all windows using this partition, then clear cookies AND all site data.
  // The dedicated partition contains both booking and zjuam login state. Do not export cookies.
  clearSession(partition: typeof CAS_PARTITION): Promise<void>;
}
