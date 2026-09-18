import { test } from 'node:test';
import assert from 'node:assert/strict';
import CryptoJS from 'crypto-js';
import { BookingService } from '../src/domain/BookingService.js';
import { BOOKING_IV, buildDailyAesKey } from '../src/crypto/bookingCrypto.js';
import { parseBookingResult } from '../src/api/parsers.js';
import { area, config, datesResponse, fakeToken, fixedClock, harness, httpFailure, indexResponse, normalResponse, seat } from './fixtures.js';

function service(h: ReturnType<typeof harness>, logs: string[] = []) {
  return new BookingService({ getToken: async () => fakeToken }, () => h.api, message => logs.push(message));
}
test('full real service dry-run resolves every ID and encrypts without confirm', async () => {
  const h = harness(normalResponse);
  const logs: string[] = [];
  const result = await service(h, logs).runBooking(config);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.plan, { day: config.targetDate, area: area.name, areaId: area.id, seat: seat.no, seatId: seat.id,
    segment: '411', startTime: '08:00', endTime: '22:00' });
  assert.ok(result.dryRun && result.encryptionDate === '20260918');
  assert.deepEqual(h.requests.map(x => x.path), ['/reserve/index/index', '/reserve/index/list', '/api/Seat/date', '/api/Seat/seat']);
  assert.deepEqual(h.requests[1]!.body, { id: '1', date: config.targetDate, categoryIds: ['1'], members: 0, size: 10, page: 1, premisesIds: ['86'], authorization: `bearer${fakeToken}` });
  assert.equal(h.requests[2]!.body.build_id, area.id);
  assert.deepEqual(h.requests[3]!.body, { area: area.id, segment: '411', day: config.targetDate, startTime: '08:00', endTime: '22:00', authorization: `bearer${fakeToken}` });
  assert.ok(logs.some(log => log.includes('aesjson generated')));
  assert.ok(!logs.join('\n').includes(fakeToken));
  assert.ok(!logs.join('\n').includes(buildDailyAesKey(fixedClock.now())));
});
test('execute sends only one confirm, using clock date and exact ordered plaintext', async () => {
  const h = harness(normalResponse);
  const instance = service(h);
  const result = await instance.runBooking({ ...config, dryRun: false });
  assert.ok(!result.dryRun && result.result.success);
  assert.ok(!result.dryRun && result.result.newTime === '2026-09-19 08:00-22:00');
  const confirm = h.requests.filter(x => x.path === '/api/Seat/confirm');
  assert.equal(confirm.length, 1);
  assert.deepEqual(Object.keys(confirm[0]!.body), ['aesjson', 'authorization']);
  const plain = CryptoJS.AES.decrypt(String(confirm[0]!.body.aesjson), CryptoJS.enc.Utf8.parse(buildDailyAesKey(fixedClock.now())), {
    iv: CryptoJS.enc.Utf8.parse(BOOKING_IV), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
  }).toString(CryptoJS.enc.Utf8);
  assert.equal(plain, '{"seat_id":"80023","segment":"411"}');
  await assert.rejects(instance.runBooking({ ...config, dryRun: false }), { code: 'BOOKING_ALREADY_STARTED' });
  assert.equal(h.requests.filter(x => x.path === '/api/Seat/confirm').length, 1);
});
test('confirm regenerates ciphertext when the injected clock crosses midnight', async () => {
  let now = new Date(2026, 8, 18, 23, 59, 59);
  const h = harness(normalResponse, { now: () => now });
  const params = { seatId: seat.id, segment: '411' };
  const before = h.api.prepareConfirm(params);
  now = new Date(2026, 8, 19, 0, 0, 1);
  await h.api.confirmSeat(params);
  const after = h.api.prepareConfirm(params);
  assert.notEqual(before.aesjson, after.aesjson);
  assert.equal(h.requests[0]!.body.aesjson, after.aesjson);
});
test('HTTP 200 business rejection is a structured failure, never retried', async () => {
  const h = harness(request => request.path.endsWith('/confirm') ? { code: 0, msg: '目标座位已被预约' } : normalResponse(request));
  const result = await service(h).runBooking({ ...config, dryRun: false });
  assert.ok(!result.dryRun && !result.result.success);
  assert.ok(!result.dryRun && result.result.message === '目标座位已被预约');
  assert.equal(h.requests.filter(x => x.path.endsWith('/confirm')).length, 1);
  assert.equal(parseBookingResult({ code: '1', msg: 'unexpected string code' }).success, false);
});
test('lost confirm response reports uncertainty without retry', async () => {
  const h = harness(request => request.path.endsWith('/confirm') ? httpFailure(request) : normalResponse(request));
  await assert.rejects(service(h).runBooking({ ...config, dryRun: false }), { code: 'CONFIRM_OUTCOME_UNKNOWN' });
  assert.equal(h.requests.filter(x => x.path.endsWith('/confirm')).length, 1);
});
for (const [replacement, code] of [
  [[], 'TARGET_SEAT_NOT_FOUND'],
  [[{ ...seat, status: '2', status_name: '已预约' }], 'TARGET_SEAT_UNAVAILABLE'],
  [[{ ...seat, area: '99' }], 'SEAT_AREA_MISMATCH'],
] as const) test(`execute stops on ${code}`, async () => {
  const h = harness(request => request.path.endsWith('/seat') ? { code: 1, data: replacement } : normalResponse(request));
  await assert.rejects(service(h).runBooking({ ...config, dryRun: false }), { code });
  assert.equal(h.requests.filter(x => x.path.endsWith('/confirm')).length, 0);
});
test('all pages are examined before a unique area is selected', async () => {
  const h = harness(request => request.path.endsWith('/list') ? { code: 0, data: {
    count: 2, list: request.body.page === 1 ? [{ ...area, id: '908', name: '南区' }] : [area],
  } } : normalResponse(request));
  const result = await service(h).runBooking(config);
  assert.equal(result.plan.areaId, area.id);
  assert.deepEqual(h.requests.filter(x => x.path.endsWith('/list')).map(x => x.body.page), [1, 2]);
});
test('ambiguous areas never choose first or infer a seat prefix', async () => {
  const h = harness(request => request.path.endsWith('/list') ? { code: 0, data: { count: 2, list: [area, { ...area, id: '908', name: '南区' }] } } : normalResponse(request));
  await assert.rejects(service(h).runBooking({ ...config, targetArea: undefined }), { code: 'TARGET_AREA_AMBIGUOUS' });
  assert.equal(h.requests.length, 2);
});
test('single returned area needs no explicit area configuration', async () => {
  const h = harness(normalResponse);
  const result = await service(h).runBooking({ ...config, targetArea: undefined, targetBuilding: undefined, targetFloor: undefined });
  assert.equal(result.plan.areaId, area.id);
});
test('overlapping pagination is rejected without infinite requests', async () => {
  const h = harness(request => request.path.endsWith('/list') ? { code: 0, data: { count: 3, list: [area] } } : normalResponse(request));
  await assert.rejects(service(h).runBooking(config), { code: 'PAGINATION_CHANGED' });
  assert.equal(h.requests.length, 3);
});
test('index fields are checked, not assumed from fixtures or array indexes', async () => {
  const h = harness(() => ({ ...indexResponse, data: { unexpected: fakeToken, UserInfo: { phone: '13800000000' } } }));
  await assert.rejects(service(h).runBooking(config), error => {
    assert.ok(error instanceof Error && 'code' in error && error.code === 'RESPONSE_SCHEMA_CHANGED');
    assert.ok(error.message.includes('unexpected'));
    assert.ok(!error.message.includes(fakeToken));
    assert.ok(!error.message.includes('13800000000'));
    return true;
  });
});
test('date or segment failure prevents seat query', async () => {
  const h = harness(request => request.path.endsWith('/date') ? { ...datesResponse, data: [] } : normalResponse(request));
  await assert.rejects(service(h).runBooking(config), { code: 'TARGET_DATE_NOT_UNIQUE' });
  assert.equal(h.requests.length, 3);
});
test('invalid configuration and missing token never send requests', async () => {
  const h = harness(normalResponse);
  await assert.rejects(service(h).runBooking({ ...config, targetDate: '2026-02-30' }), { code: 'INVALID_CONFIG' });
  await assert.rejects(new BookingService({ getToken: async () => '' }, () => h.api).runBooking(config), { code: 'INVALID_TOKEN' });
  assert.equal(h.requests.length, 0);
});
