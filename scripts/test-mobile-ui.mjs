import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

await mkdir('.artifacts', { recursive: true });
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
try {
  for (const width of [320, 360, 390, 520]) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const ok = value => Promise.resolve({ ok: true, value });
      const location = { premises: '测试馆', floor: '二层', area: '北区' };
      const idle = { state: 'IDLE', message: '等待开始' };
      window.libraryApp = {
        getAuthStatus: () => ok({ state: 'AUTHENTICATED' }), login: () => ok({ state: 'AUTHENTICATED' }), logout: () => ok({ state: 'LOGIN_REQUIRED' }),
        openBookingWebsite: () => ok(), listAvailability: () => ok({ locations: [{ ...location, freeCount: 1 }], scopes: [location] }),
        listSeats: input => ok({ location, seats: ['TEST-A23'], day: input.day, startTime: '09:00', endTime: '22:00' }),
        reserveManual: () => Promise.resolve({ ok: false, error: { code: 'CONFIRM_OUTCOME_UNKNOWN', message: '预约结果未知，请在图书馆官网确认。' } }),
        startAutoSelect: () => ok(idle), stopAutoSelect: () => ok(idle), getAutoSelectStatus: () => ok(idle),
      };
    });
    await page.goto(pathToFileURL(resolve('out/renderer/index.html')).href);
    await page.locator('#day').fill('2026-09-19');
    await page.locator('#locations > details > summary').click();
    await page.locator('#locations details details > summary').click();
    await page.locator('.region').click();
    await page.locator('.seat').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const selector of ['#auth-button', '#reserve-button', '.seat', '#day', '#startTime', '#endTime']) {
      const box = await page.locator(selector).boundingBox(); assert.ok(box && box.height >= 44, `${width}: ${selector}`);
    }
    await page.locator('#reserve-button').click();
    await page.getByText('预约结果未知', { exact: true }).waitFor();
    if (width === 360) await page.screenshot({ path: '.artifacts/mobile-ui-360.png', fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: synthetic mobile UI at 320/360/390/520px, touch targets, date/time controls, seat selection and unknown result. No network bookings.');
} finally { await browser.close(); }
