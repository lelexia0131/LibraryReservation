import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function cli(args: string[], settings: Record<string, string> = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(BOOKING_|TARGET_|DRY_RUN$)/.test(key)) delete env[key];
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/booking.ts', ...args], {
    cwd: process.cwd(), env: { ...env, ...settings }, encoding: 'utf8', timeout: 10000,
  });
}
test('CLI starts and reports invalid config with nonzero exit', () => {
  const result = cli([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /INVALID_CONFIG/);
  assert.doesNotMatch(result.stderr, /Error:| at /);
});
test('CLI refuses missing token before querying in both modes', () => {
  for (const mode of ['--dry-run', '--execute']) {
    const result = cli([mode], { TARGET_DATE: '2026-09-19', TARGET_SEAT: 'TEST-A23' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /INVALID_TOKEN/);
    assert.equal(result.stdout, '');
  }
});
test('CLI rejects misspelled execution flag rather than silently running', () => {
  const result = cli(['--excute']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /INVALID_CONFIG/);
});
