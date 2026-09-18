import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

await mkdir('.artifacts', { recursive: true });
await build({ entryPoints: ['tests/desktop-host.ts'], outfile: '.artifacts/desktop-host.cjs', bundle: true,
  platform: 'node', format: 'cjs', external: ['electron'] });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath, args: ['.artifacts/desktop-host.cjs'], env, timeout: 30000 });
try {
  const page = await app.firstWindow({ timeout: 15000 });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.libraryApp));
  assert.deepEqual(await page.evaluate(() => Object.keys(window.libraryApp)), ['getAuthStatus', 'login', 'logout', 'openBookingWebsite', 'runDryBooking']);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  // A real login through production IPC, using only synthetic external authentication.
  assert.equal((await page.evaluate(() => window.libraryApp.login())).ok, true);
  await page.waitForFunction(() => document.querySelector('#auth-status').textContent === '已登录');
  assert.equal(await app.evaluate(() => globalThis.desktopTest.encrypted()), true);
  assert.equal(await app.evaluate(() => globalThis.desktopTest.restored()), true);
  await page.locator('#query-button').click();
  assert.equal(await page.locator('#form-error').textContent(), '请填写座位号。');
  await page.locator('#targetDate').fill('2026-09-19');
  await page.locator('#targetSeat').fill('TEST-A23');
  await page.locator('#targetBuilding').fill('测试馆');
  await page.locator('#targetFloor').fill('二层');
  await page.locator('#targetArea').fill('北区');
  await page.locator('#startTime').fill('08:00');
  await page.locator('#endTime').fill('22:00');
  await page.locator('#query-button').click();
  assert.equal(await page.locator('#query-button').isDisabled(), true);
  assert.equal(await page.locator('#targetSeat').isDisabled(), true);
  await page.waitForFunction(() => document.querySelector('#result-badge').textContent === '空闲');
  await page.screenshot({ path: '.artifacts/ui-available.png' });
  await app.evaluate(() => globalThis.desktopTest.unavailable());
  await page.locator('#query-button').click();
  await page.waitForFunction(() => document.querySelector('#result-badge').textContent === '不可用');
  await page.screenshot({ path: '.artifacts/ui-unavailable.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 600));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '.artifacts/ui-minimum.png', fullPage: true });
  const paths = await app.evaluate(() => globalThis.desktopTest.requests());
  assert.equal(paths.includes('/api/Seat/confirm'), false);
  await page.locator('#auth-button').click();
  await page.waitForFunction(() => document.querySelector('#auth-status').textContent === '未登录');
  assert.equal(await app.evaluate(() => globalThis.desktopTest.cleared()), true);
  assert.deepEqual(errors, []);
  console.log('PASS: real Electron sandbox/preload/IPC, safeStorage encryption, cached restore, form validation, loading guard, available/unavailable UI, minimum layout, logout, zero confirm requests. External responses are synthetic.');
} finally { await app.close(); }
