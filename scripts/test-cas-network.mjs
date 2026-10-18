// Public GET-only smoke check in real Electron. No accounts, saved user profile or bookings.
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import electron from 'electron';

await mkdir('.artifacts', { recursive: true });
await build({ stdin: { resolveDir: process.cwd(), contents: `
  import { app, net } from 'electron';
  import { resolve } from 'node:path';
  import assert from 'node:assert/strict';
  import { RemoteWindowHost } from './electron/adapters/ElectronCasBrowserAdapter';
  import { ElectronCasHttpAdapter } from './electron/adapters/ElectronCasHttpAdapter';
  import { HttpCasSession } from './src/auth/HttpCasSession';
  app.setPath('userData', resolve('.artifacts/cas-network-profile'));
  void app.whenReady().then(async () => {
    const host = new RemoteWindowHost();
    try {
      await host.clear();
      const http = new ElectronCasHttpAdapter(host.session, options => net.request(options));
      const signal = AbortSignal.timeout(30000);
      await assert.rejects(new HttpCasSession(http).authenticate({ signal,
        allowInteractive: () => false, credentials: async () => null,
        onLoginRequired() {}, onAuthenticating() {}, onCallback() {},
      }, async () => { throw new Error('Unexpected authenticated callback'); }), { code: 'LOGIN_REQUIRED' });
      const captcha = await http.request('https://zjuam.zju.edu.cn/cas/v2/getKaptchaStatus', 'GET', undefined, signal);
      assert.ok(captcha.status === 200 && ['true', 'false'].includes(captcha.body.trim()));
      const key = await http.request('https://zjuam.zju.edu.cn/cas/v2/getPubKey', 'GET', undefined, signal);
      const data = JSON.parse(key.body);
      assert.ok(key.status === 200 && typeof data.modulus === 'string' && typeof data.exponent === 'string');
      for (const name of ['PHPSESSID', 'JSESSIONID']) assert.ok((await host.session.cookies.get({ name })).length);
      console.log('PASS: real Electron library redirect, CAS login page, session Cookies, challenge status and RSA key; GET only.');
    } finally { await host.clear(); app.quit(); }
  }).catch(() => { console.error('FAIL: public CAS network check'); app.exit(1); });
` }, outfile: '.artifacts/cas-network-host.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.artifacts/cas-network-host.cjs'], { env, windowsHide: true, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
