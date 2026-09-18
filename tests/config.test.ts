import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnvironmentTokenProvider, loadConfig } from '../src/config/config.js';
import { redact } from '../src/errors.js';
import { config, fakeToken } from './fixtures.js';

const env = { TARGET_DATE: config.targetDate, TARGET_SEAT: config.targetSeat };
test('CLI defaults dry, only explicit execution enables confirm', () => {
  assert.equal(loadConfig(env).dryRun, true);
  assert.equal(loadConfig({ ...env, DRY_RUN: 'true' }).dryRun, true);
  assert.equal(loadConfig({ ...env, DRY_RUN: 'false' }).dryRun, false);
  assert.equal(loadConfig({ ...env, DRY_RUN: 'true' }, ['--execute']).dryRun, false);
  assert.equal(loadConfig({ ...env, DRY_RUN: 'false' }, ['--execute', '--dry-run']).dryRun, true);
  assert.equal(loadConfig(env).startTime, '00:01');
  assert.equal(loadConfig(env).endTime, '23:59');
});
test('bad dates, times, flags and dry-run spelling fail closed', () => {
  for (const bad of [{ TARGET_DATE: '2026-02-30' }, { TARGET_DATE: 'tomorrow' }, { TARGET_SEAT: '' },
    { TARGET_START_TIME: '25:00' }, { TARGET_START_TIME: '23:59', TARGET_END_TIME: '08:00' }, { DRY_RUN: 'False' }]) {
    assert.throws(() => loadConfig({ ...env, ...bad }), { code: 'INVALID_CONFIG' });
  }
  assert.throws(() => loadConfig(env, ['--excute']), { code: 'INVALID_CONFIG' });
});
test('token provider keeps environment access centralized', async () => {
  assert.equal(await new EnvironmentTokenProvider({ BOOKING_TOKEN: fakeToken }).getToken(), fakeToken);
  for (const token of ['', '<token>', `bearer${fakeToken}`, 'has whitespace']) {
    await assert.rejects(new EnvironmentTokenProvider({ BOOKING_TOKEN: token }).getToken(), { code: 'INVALID_TOKEN' });
  }
});
test('redaction removes full tokens, email, phone, long student numbers and terminal escapes', () => {
  const value = redact(`${fakeToken} bearer${fakeToken} person@example.org 13800000000 2026012345\n\x1b`, fakeToken);
  for (const secret of [fakeToken, 'person@example.org', '13800000000', '2026012345', '\x1b', '\n']) assert.ok(!value.includes(secret));
});
