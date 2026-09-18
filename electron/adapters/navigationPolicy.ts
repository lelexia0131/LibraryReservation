import { BOOKING_ORIGIN, extractCasFromUrl } from '../../src/auth/casUrlParser.js';

export function upgradeOfficialUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!url.username && !url.password && ['http://zjuam.zju.edu.cn', 'http://booking.lib.zju.edu.cn'].includes(url.origin)) {
      url.protocol = 'https:'; url.port = ''; return url.href;
    }
  } catch { /* Invalid navigations are rejected by the allowlist. */ }
  return undefined;
}

export function allowedRemoteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && [BOOKING_ORIGIN, 'https://zjuam.zju.edu.cn'].includes(url.origin);
  } catch { return false; }
}
export function blockedRemoteRequest(value: string): boolean {
  try {
    const url = new URL(value);
    // Chromium never exchanges the one-time login credential; only the main process does.
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, '').toLowerCase();
    return /\/api\/seat\/confirm(?:\/|$)/.test(path) || path === '/api/cas/user';
  } catch { return true; }
}
export function handleNavigation(url: string, isMainFrame: boolean, prevent: () => void,
  report: (url: string) => void, capture: boolean): void {
  if (!isMainFrame) return;
  if (!allowedRemoteUrl(url)) { prevent(); return; }
  if (capture && extractCasFromUrl(url)) prevent();
  report(url);
}
