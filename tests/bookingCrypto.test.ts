import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
import CryptoJS from 'crypto-js';
import { BOOKING_IV, buildDailyAesKey, encryptBookingPayload } from '../src/crypto/bookingCrypto.js';

const date = new Date(2026, 8, 18, 12);
const payload = { seat_id: '80023', segment: '411' };
test('daily key uses local current date and has 16 ASCII bytes', () => {
  assert.equal(buildDailyAesKey(date), '2026091881906202');
  assert.equal(Buffer.byteLength(buildDailyAesKey(date)), 16);
  assert.equal(buildDailyAesKey(new Date(2026, 8, 19)), '2026091991906202');
});
test('literal IV is exactly 16 UTF-8 bytes, identical to CryptoJS', () => {
  assert.equal(BOOKING_IV, 'ZZWBKJ_ZHIHUAWEI');
  assert.equal(Buffer.byteLength(BOOKING_IV), 16);
  assert.equal(CryptoJS.enc.Utf8.parse(BOOKING_IV).toString(), Buffer.from(BOOKING_IV, 'utf8').toString('hex'));
});
for (const value of [payload, { seat_id: '11', segment: '91', test: '中文 UTF-8' }]) {
  test(`native AES equals actual CryptoJS AES for ${JSON.stringify(value)}`, () => {
    const actual = encryptBookingPayload(value, date);
    const expected = CryptoJS.AES.encrypt(JSON.stringify(value), CryptoJS.enc.Utf8.parse(buildDailyAesKey(date)), {
      iv: CryptoJS.enc.Utf8.parse(BOOKING_IV), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
    }).toString();
    assert.equal(actual, expected);
    assert.equal(actual, encryptBookingPayload(value, date));
    assert.deepEqual(JSON.parse(CryptoJS.AES.decrypt(actual, CryptoJS.enc.Utf8.parse(buildDailyAesKey(date)), {
      iv: CryptoJS.enc.Utf8.parse(BOOKING_IV), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
    }).toString(CryptoJS.enc.Utf8)), value);
  });
}
test('native decrypt restores ordered confirm JSON', () => {
  const decipher = createDecipheriv('aes-128-cbc', buildDailyAesKey(date), Buffer.from(BOOKING_IV, 'utf8'));
  const decrypted = Buffer.concat([decipher.update(encryptBookingPayload(payload, date), 'base64'), decipher.final()]).toString('utf8');
  assert.equal(decrypted, '{"seat_id":"80023","segment":"411"}');
});
test('invalid encryption dates fail', () => assert.throws(() => buildDailyAesKey(new Date(NaN))));
