import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJwtExpiry, TokenValidator } from '../src/auth/TokenValidator.js';
import { jwt, now } from './authFixtures.js';

test('JWT exp is an expiry hint in milliseconds, with a strict 60 second boundary', () => {
  const validator = new TokenValidator(() => now);
  assert.equal(parseJwtExpiry(jwt()), now + 3600000);
  for (const offset of [-1, 0, 59, 60]) assert.equal(validator.isUsable(jwt(now / 1000 + offset)), false);
  assert.equal(validator.isUsable(jwt(now / 1000 + 61)), true);
});
test('unknown, malformed and nonnumeric exp never become permanent tokens', () => {
  for (const token of ['opaque-token', 'e30.bad.sig', jwt('9999999999'), jwt(null), jwt(-1), jwt(1.5), jwt(Number.MAX_SAFE_INTEGER)]) {
    assert.equal(parseJwtExpiry(token), undefined);
    assert.equal(new TokenValidator(() => now).isUsable(token), false);
  }
});
