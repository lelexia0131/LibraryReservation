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
  assert.deepEqual(await page.evaluate(() => Object.keys(window.libraryApp)), ['getAuthStatus', 'login', 'logout', 'openBookingWebsite',
    'listAvailability', 'listSeats', 'reserveManual', 'startAutoSelect', 'stopAutoSelect', 'getAutoSelectStatus']);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await page.locator('#day').fill('2026-09-19');
  assert.equal((await page.evaluate(() => window.libraryApp.login())).ok, true);
  await page.waitForFunction(() => document.querySelector('#auth-status').textContent === '已登录');
  assert.equal(await app.evaluate(() => globalThis.desktopTest.encrypted()), true);
  assert.equal(await app.evaluate(() => globalThis.desktopTest.restored()), true);
  await page.locator('#locations > details > summary').click();
  await page.locator('#locations details details > summary').click();
  assert.equal(await page.locator('.region').count(), 1);
  assert.match(await page.locator('.region').textContent(), /26 空位/);
  await page.locator('.region').click();
  await page.locator('.seat').click();
  assert.equal(await page.locator('.seat').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#selected-seat').textContent(), 'TEST-A23');
  await page.screenshot({ path: '.artifacts/ui-phase4-selection.png', fullPage: true });
  assert.equal((await app.evaluate(() => globalThis.desktopTest.requests())).includes('/api/Seat/confirm'), false);
  await page.locator('#reserve-button').click();
  assert.equal(await page.locator('#reserve-button').isDisabled(), true);
  await page.waitForFunction(() => document.querySelector('#result-badge').textContent === '预约成功');
  assert.equal(await page.locator('#result-arrival').textContent(), '暂未获取');
  assert.equal((await app.evaluate(() => globalThis.desktopTest.requests())).filter(path => path.endsWith('/confirm')).length, 1);
  await page.screenshot({ path: '.artifacts/ui-phase4-success.png', fullPage: true });
  // The unavailable view is reached through the production UI and synthetic data only.
  await app.evaluate(() => globalThis.desktopTest.unavailable());
  await page.locator('#refresh-button').click();
  await page.waitForFunction(() => document.querySelector('#locations').textContent.includes('暂无空位'));
  await page.locator('.start[data-mode="all"]').click();
  await page.waitForFunction(() => document.querySelector('#status-all').textContent === '暂无空位，继续等待');
  await page.screenshot({ path: '.artifacts/ui-phase4-waiting.png', fullPage: true });
  await page.locator('.stop[data-mode="all"]').click();
  await page.waitForFunction(() => document.querySelector('#status-all').textContent === '已停止');
  // Custom scopes include currently full regions and work at premises/floor/area granularity.
  await page.locator('#scope-panel > summary').click();
  await page.locator('#scopes > details > summary').click();
  await page.getByLabel('整个主馆').check();
  await page.locator('#scopes details details > summary').click();
  assert.equal(await page.getByLabel('南区', { exact: true }).count(), 1);
  await page.locator('.start[data-mode="custom"]').click();
  await page.waitForFunction(() => document.querySelector('#status-custom').textContent === '暂无空位，继续等待');
  await page.locator('.stop[data-mode="custom"]').click();
  await page.waitForFunction(() => document.querySelector('#status-custom').textContent === '已停止');
  await app.evaluate(() => globalThis.desktopTest.available());
  await page.locator('.start[data-mode="main"]').click();
  await page.waitForFunction(() => document.querySelector('#status-main').textContent === '预约成功');
  assert.equal((await app.evaluate(() => globalThis.desktopTest.requests())).filter(path => path.endsWith('/confirm')).length, 2);
  await app.evaluate(() => globalThis.desktopTest.unknown());
  await page.locator('.start[data-mode="all"]').click();
  await page.waitForFunction(() => document.querySelector('#result-message').textContent.includes('预约结果未知'));
  assert.equal((await app.evaluate(() => globalThis.desktopTest.requests())).filter(path => path.endsWith('/confirm')).length, 3);
  await page.screenshot({ path: '.artifacts/ui-phase4-unknown.png', fullPage: true });
  assert.doesNotMatch(await page.locator('body').innerText(), /seat_id|segment|AES|API|dry-run|synthetic|错误码/);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 600));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '.artifacts/ui-phase4-minimum.png', fullPage: true });
  await page.locator('#auth-button').click();
  await page.waitForFunction(() => document.querySelector('#auth-status').textContent === '未登录');
  assert.equal(await app.evaluate(() => globalThis.desktopTest.cleared()), true);
  assert.deepEqual(errors, []);
  console.log('PASS: real Electron security, safeStorage, restore, automatic locations, hierarchy, grid selection, manual revalidation, synthetic success, waiting/stop, all three scopes, unknown outcome, minimum layout, logout. Exactly three SYNTHETIC confirms; zero real website confirms.');
} finally { await app.close(); }
