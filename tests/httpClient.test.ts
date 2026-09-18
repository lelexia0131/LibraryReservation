import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, httpFailure, fakeToken } from './fixtures.js';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import { HttpClient } from '../src/api/httpClient.js';
import { authHarness, jwt, now } from './authFixtures.js';

for (const status of [undefined, 502, 503, 504]) test(`temporary query error ${status} retries twice with backoff`, async () => {
  const h = harness(request => httpFailure(request, status));
  await assert.rejects(h.http.post('/api/Seat/date', { build_id: '77' }), { code: 'HTTP_ERROR' });
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.waits, [500, 1000]);
});
for (const status of [400, 401, 403, 429, 500]) test(`query HTTP ${status} is not retried`, async () => {
  const h = harness(request => httpFailure(request, status));
  await assert.rejects(h.http.post('/api/Seat/date', {}), { code: 'HTTP_ERROR' });
  assert.equal(h.requests.length, 1);
});
for (const status of [undefined, 502, 503, 504, 401]) test(`confirm error ${status} is never retried or leaked`, async () => {
  const h = harness(request => httpFailure(request, status));
  await assert.rejects(h.http.post('/api/Seat/confirm', { aesjson: 'test' }), error => {
    assert.ok(error instanceof Error);
    assert.ok(!JSON.stringify(error).includes(fakeToken));
    assert.ok(!error.message.includes(fakeToken));
    return true;
  });
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.waits, []);
});
test('query recovers on second attempt and injects auth once into body and header', async () => {
  const h = harness((request, call) => call === 1 ? httpFailure(request, 503) : { code: 1, data: [] });
  await h.api.fetchSeatDate({ build_id: '77' });
  assert.equal(h.requests.length, 2);
  const request = h.requests[1]!;
  assert.deepEqual(request.body, { build_id: '77', authorization: `bearer${fakeToken}` });
  assert.equal(request.config.headers.get('authorization'), `bearer${fakeToken}`);
  assert.equal(request.config.timeout, 8000);
  assert.equal(request.config.maxRedirects, 0);
});
test('business failures and non-transient TLS errors are not retried', async () => {
  const h = harness(() => ({ code: 10001, msg: fakeToken }));
  await assert.rejects(h.api.fetchSeatDate({ build_id: '77' }), { code: 'API_BUSINESS_ERROR' });
  assert.equal(h.requests.length, 1);
  const tls = harness(request => httpFailure(request, undefined, 'CERT_HAS_EXPIRED'));
  await assert.rejects(tls.http.post('/api/Seat/date', {}));
  assert.equal(tls.requests.length, 1);
});

for (const path of ['/api/Seat/date', '/api/Seat/confirm']) test(`401 invalidates persistent token without replay: ${path}`, async () => {
  const h = authHarness({ token: jwt(), savedAt: now });
  const token = await h.auth.getToken();
  let requests = 0;
  const http = new HttpClient(token, axios.create({ adapter: async config => {
    requests++;
    throw new AxiosError('private transport data', 'ERR_BAD_REQUEST', config, undefined,
      { status: 401, statusText: 'Unauthorized', headers: new AxiosHeaders(), data: { token }, config });
  } }), undefined, () => h.auth.invalidateToken(token));
  await assert.rejects(http.post(path, {}), { code: 'HTTP_ERROR' });
  assert.equal(requests, 1);
  assert.equal(h.store.value, null);
  assert.equal(h.browser.windows.length, 0);
});

test('unauthenticated CAS exchange removes inherited auth headers and never retries', async () => {
  let requests = 0;
  const http = new HttpClient(fakeToken, axios.create({ headers: { authorization: 'secret-default', cookie: 'secret-cookie' }, adapter: async config => {
    requests++;
    assert.equal(config.headers.get('authorization'), false);
    assert.equal(config.headers.get('cookie'), false);
    assert.deepEqual(JSON.parse(config.data), { cas: 'synthetic-cas' });
    throw new AxiosError('secret', 'ECONNRESET', config);
  } }));
  await assert.rejects(http.post('/api/cas/user', { cas: 'synthetic-cas' }, { authRequired: false }), { code: 'HTTP_ERROR' });
  assert.equal(requests, 1);
});

test('HTTP rejects absolute URLs and credential-bearing query paths without logging them', async () => {
  const h = harness(() => ({}));
  for (const path of ['https://evil.example.com/', '//evil.example.com/', '/api/cas/user?cas=private']) {
    await assert.rejects(h.http.post(path, {}), { code: 'INVALID_API_PATH' });
  }
  assert.equal(h.requests.length, 0);
});
