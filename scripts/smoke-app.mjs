import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2] ? resolve(process.argv[2]) : electronPath;
const args = [...(process.argv[2] ? [] : ['.']), `--user-data-dir=${resolve('.artifacts/smoke-profile')}`];
const app = await electron.launch({ executablePath, args, env, timeout: 30000 });
try {
  const page = await app.firstWindow({ timeout: 15000 });
  page.setDefaultTimeout(20000);
  await page.waitForFunction(() => Boolean(window.libraryApp));
  await page.waitForFunction(() => ['未登录', '登录失败', '已登录'].includes(document.querySelector('#auth-status').textContent));
  const status = await page.locator('#auth-status').textContent();
  console.log(`Main window: ${await page.title()}; startup: ${status}`);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:'));
    const { sandbox, nodeIntegration, contextIsolation } = window.webContents.getLastWebPreferences();
    return { sandbox, nodeIntegration, contextIsolation, visible: window.isVisible() };
  });
  assert.deepEqual(prefs, { sandbox: true, nodeIntegration: false, contextIsolation: true, visible: true });
  await page.screenshot({ path: '.artifacts/ui-production.png' });
  await page.locator('#auth-button').click();
  const login = await app.waitForEvent('window', { timeout: 15000 });
  await login.waitForURL('https://zjuam.zju.edu.cn/cas/login**', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('#auth-status').textContent === '正在登录');
  console.log('Official HTTPS login window visible; startup remained silent; no credentials entered.');
  // Close the test application as a whole; never fill or submit the authentication page.
} finally { await app.close(); }
