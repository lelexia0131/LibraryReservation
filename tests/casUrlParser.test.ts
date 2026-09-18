import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCasFromUrl } from '../src/auth/casUrlParser.js';

for (const url of [
  'https://booking.lib.zju.edu.cn/h5/index.html#/cas?cas=abc',
  'https://booking.lib.zju.edu.cn/h5/#/cas?cas=abc',
  'https://booking.lib.zju.edu.cn/h5/?cas=abc',
  'https://booking.lib.zju.edu.cn/another-path?cas=abc',
]) test(`extract cas from ${url}`, () => assert.equal(extractCasFromUrl(url), 'abc'));
for (const url of [
  'https://evil.example.com/?cas=abc', 'https://booking.lib.zju.edu.cn.evil.com/?cas=abc',
  'http://booking.lib.zju.edu.cn/?cas=abc', 'malformed url',
  'https://booking.lib.zju.edu.cn:444/?cas=abc', 'https://someone@booking.lib.zju.edu.cn/?cas=abc',
  'https://booking.lib.zju.edu.cn/?cas=', 'https://booking.lib.zju.edu.cn/',
]) test(`reject untrusted or missing callback ${url}`, () => assert.equal(extractCasFromUrl(url), null));
test('URL decoding preserves encoded plus and does not infer CAS tickets', () => {
  assert.equal(extractCasFromUrl('https://booking.lib.zju.edu.cn/?cas=abc%2Bdefgh'), 'abc+defgh');
  assert.equal(extractCasFromUrl('https://booking.lib.zju.edu.cn/?ticket=abc'), null);
});
