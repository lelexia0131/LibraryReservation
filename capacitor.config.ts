import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cn.libraryreservation.android',
  appName: '浙江大学图书馆预约助手',
  webDir: 'out/android',
  loggingBehavior: 'none',
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false, resolveServiceWorkerRequests: false },
  server: { hostname: 'localhost', androidScheme: 'https', cleartext: false },
  plugins: { CapacitorHttp: { enabled: false }, CapacitorCookies: { enabled: false } },
};
export default config;
