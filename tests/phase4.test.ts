import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import { BookingApi } from '../src/api/bookingApi.js';
import { HttpClient } from '../src/api/httpClient.js';
import { parseReserveList } from '../src/api/parsers.js';
import { BookingError } from '../src/errors.js';
import { AvailabilityService, locationOf, type Period } from '../src/domain/AvailabilityService.js';
import { ReservationService } from '../src/domain/ReservationService.js';
import { AutoSelectMonitor, waitForPoll, type AutoRequest } from '../src/domain/AutoSelectMonitor.js';
import { ConfirmationAuthority } from '../electron/ConfirmationAuthority.js';
import { DesktopController, safeError } from '../electron/desktopController.js';
import { area, config, fakeToken, fixedClock, indexResponse, normalResponse, seat, type Request } from './fixtures.js';

const period: Period = { day: config.targetDate, startTime: '08:00', endTime: '22:00' };
const location = locationOf(area);
const all: AutoRequest = { ...period, mode: 'all', scopes: [] };
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) { if (check()) return; await tick(); }
  assert.fail('Expected state did not arrive');
}
function setup(respond: (request: Request) => unknown = normalResponse) {
  const requests: Request[] = [];
  const transport = axios.create({ adapter: async config => {
    const request: Request = { path: config.url!, body: JSON.parse(config.data), config };
    requests.push(request);
    return { data: await respond(request), status: 200, statusText: 'OK', headers: new AxiosHeaders(), config };
  } });
  const factory = (signal: AbortSignal, authority?: ConfirmationAuthority) => new BookingApi(
    new HttpClient(fakeToken, transport, async () => { assert.fail('Desktop must not do immediate retries'); }, undefined, 0), fixedClock, authority?.consume, signal);
  const controller = new AbortController();
  const api = factory(controller.signal, new ConfirmationAuthority(controller.signal));
  const discovery = new AvailabilityService(api, controller.signal);
  const reservation = new ReservationService(api, discovery);
  const waits: number[] = [], releases: (() => void)[] = [];
  const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
    waits.push(ms);
    const finish = () => { signal.removeEventListener('abort', finish); resolve(); };
    releases.push(finish); signal.addEventListener('abort', finish, { once: true }); if (signal.aborted) finish();
  });
  const monitor = new AutoSelectMonitor(async signal => {
    const api = factory(signal, new ConfirmationAuthority(signal));
    const discovery = new AvailabilityService(api, signal);
    return { discovery, reservation: new ReservationService(api, discovery) };
  }, undefined, sleep);
  let loggedIn = true;
  const auth = { getStatus: () => ({ state: loggedIn ? 'AUTHENTICATED' as const : 'LOGIN_REQUIRED' as const, hasCachedToken: loggedIn }),
    getToken: async () => fakeToken, logout: async () => { loggedIn = false; } };
  const desktop = new DesktopController(auth, { openBookingWebsite: async () => {} }, undefined,
    (_token, signal, authority) => factory(signal, authority));
  return { requests, factory, api, discovery, reservation, monitor, controller, waits, releases, desktop };
}
const confirms = (h: ReturnType<typeof setup>) => h.requests.filter(request => request.path.endsWith('/confirm'));

test('safeError preserves unknown safe BookingError codes and discards ordinary Error codes', () => {
  const logs: string[] = [];
  const result = safeError(new BookingError('NEW_SAFE_BUSINESS_CODE', fakeToken, 'reserve-list'), line => logs.push(line));
  assert.equal(result.error.code, 'NEW_SAFE_BUSINESS_CODE');
  assert.equal(result.error.stage, 'reserve-list');
  assert.match(result.error.message, /加载位置/);
  assert.deepEqual(logs, ['[Desktop] operation failed code=NEW_SAFE_BUSINESS_CODE stage=reserve-list']);
  assert.doesNotMatch(JSON.stringify(result), /synthetic|authorization|cookie|Axios|stack/);
  assert.equal(safeError(Object.assign(new Error(fakeToken), { code: 'HTTP_ERROR' })).error.code, 'UNEXPECTED_ERROR');
});
for (const [path, stage] of [['/reserve/index/index', 'reserve-index'], ['/reserve/index/list', 'reserve-list'], ['/api/Seat/date', 'seat-date'], ['/api/Seat/seat', 'seat-list']] as const) {
  test(`business failure is diagnosable at ${stage}`, async () => {
    const h = setup(request => request.path === path ? { code: 987, msg: fakeToken } : normalResponse(request));
    await assert.rejects(h.discovery.list(period), { code: 'API_BUSINESS_ERROR', stage });
    const error = safeError(new BookingError('API_BUSINESS_ERROR', fakeToken, stage));
    assert.notEqual(error.error.code, 'UNEXPECTED_ERROR'); assert.doesNotMatch(error.error.message, /synthetic/);
  });
}
test('verified free_num/total_num counts avoid every per-area seat request and preserve zero-count scopes', async () => {
  const h = setup(request => request.path.endsWith('/list') ? { code: 0, data: { count: 2, list: [
    { ...area, free_num: '26', total_num: '30' }, { ...area, id: '908', name: '南区', free_num: 0, total_num: 20 },
  ] } } : normalResponse(request));
  const result = await h.discovery.list(period);
  assert.deepEqual(result.locations, [{ ...location, freeCount: 26 }]); assert.equal(result.scopes.length, 2);
  assert.deepEqual(h.requests.map(r => r.path), ['/reserve/index/index', '/reserve/index/list']);
  assert.equal(h.requests[1]!.body.startTime, '08:00'); assert.equal(h.requests[1]!.body.endTime, '22:00');
});
test('invalid or contradictory official counts are not accepted', () => {
  for (const free_num of [-1, 'unknown', 31, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseReserveList({ code: 0, data: { count: 1, list: [{ ...area, free_num, total_num: 30 }] } }), { code: 'RESPONSE_SCHEMA_CHANGED' });
  }
});
test('fallback queries each region serially, counts only the two required free status fields', async () => {
  let inFlight = 0, peak = 0;
  const h = setup(async request => {
    inFlight++; peak = Math.max(peak, inFlight); await tick(); inFlight--;
    if (request.path.endsWith('/list')) return { code: 0, data: { count: 2, list: [area, { ...area, id: '908', name: '南区' }] } };
    if (request.path.endsWith('/seat')) return { code: 1, data: [
      { ...seat, area: request.body.area }, { ...seat, id: '2', no: 'OTHER', area: request.body.area, status_name: '占用' },
    ] };
    return normalResponse(request);
  });
  const result = await h.discovery.list(period);
  assert.equal(peak, 1); assert.deepEqual(result.locations.map(item => item.freeCount), [1, 1]);
  assert.deepEqual(h.requests.slice(2).map(r => r.path), ['/api/Seat/date', '/api/Seat/seat', '/api/Seat/date', '/api/Seat/seat']);
});
test('discovery paginates and keeps official order', async () => {
  const h = setup(request => request.path.endsWith('/list') ? { code: 0, data: { count: 2, list: [request.body.page === 1 ? area : { ...area, id: '909', name: '南区' }] } } : normalResponse(request));
  assert.deepEqual((await h.discovery.areas(period)).map(a => a.name), ['北区', '南区']);
});
test('desktop uses a ten-second cache, explicit refresh bypasses it, seats expose only display values', async () => {
  const h = setup();
  await h.desktop.listAvailability(period); const count = h.requests.length;
  await h.desktop.listAvailability(period); assert.equal(h.requests.length, count);
  await h.desktop.listAvailability({ ...period, refresh: true }); assert.equal(h.requests.length, count * 2);
  const result = await h.desktop.listSeats({ ...period, location });
  assert.deepEqual(result.seats, [seat.no]); assert.equal(result.startTime, '08:00');
  assert.doesNotMatch(JSON.stringify(result), /token|authorization|seat_id|segment|area_id|aesjson|80023|411/);
});
test('manual revalidates live IDs instead of trusting displayed seat data, exactly one confirm', async () => {
  let seatReads = 0;
  const h = setup(request => request.path.endsWith('/seat') ? { code: 1, data: [{ ...seat, id: ++seatReads === 1 ? '1' : '80023' }] } : normalResponse(request));
  await h.desktop.listSeats({ ...period, location });
  const result = await h.desktop.reserveManual({ ...period, location, seat: seat.no });
  assert.equal(result.success, true); assert.equal(seatReads, 2); assert.equal(confirms(h).length, 1);
  assert.equal(result.arrival, '暂未获取'); assert.doesNotMatch(JSON.stringify(result), /token|segment|aesjson|newTime/);
});
test('manual business failure is a failed result, without reflecting server text', async () => {
  const h = setup(request => request.path.endsWith('/confirm') ? { code: 42, msg: fakeToken } : normalResponse(request));
  const result = await h.desktop.reserveManual({ ...period, location, seat: seat.no });
  assert.equal(result.success, false); assert.equal(confirms(h).length, 1); assert.doesNotMatch(JSON.stringify(result), /synthetic/);
});
test('manual state changes before confirm prevent submission', async () => {
  let reads = 0;
  const h = setup(request => request.path.endsWith('/seat') ? { code: 1, data: [{ ...seat, status: ++reads > 1 ? '2' : '1', status_name: reads > 1 ? '已预约' : '空闲' }] } : normalResponse(request));
  await h.desktop.listSeats({ ...period, location });
  await assert.rejects(h.desktop.reserveManual({ ...period, location, seat: seat.no }), { code: 'TARGET_SEAT_UNAVAILABLE', stage: 'seat-select' });
  assert.equal(confirms(h).length, 0);
});
test('confirmation capability is one-use and is revoked by stop', () => {
  const c = new AbortController(), permit = new ConfirmationAuthority(c.signal);
  permit.consume(); assert.throws(permit.consume, { code: 'CONFIRM_ALREADY_SENT' });
  const second = new ConfirmationAuthority(c.signal); c.abort(); assert.throws(second.consume, { code: 'STOPPED' });
});
for (const mode of ['main', 'all', 'custom'] as const) {
  test(`${mode} selection respects scope and website order, revalidates, permanently stops after success`, async () => {
    const areas = [{ ...area, id: '101', premisesName: '其他馆' }, { ...area, id: '102', premisesName: '主馆' }, { ...area, id: '103', premisesName: '主馆', name: '南区' }];
    const h = setup(request => {
      if (request.path.endsWith('/index')) return { code: 0, data: { ...indexResponse.data, premises: [{ id: '1', name: '主馆' }, { id: '2', name: '其他馆' }] } };
      if (request.path.endsWith('/list')) return { code: 0, data: { count: 3, list: areas } };
      if (request.path.endsWith('/seat')) return { code: 1, data: [{ ...seat, area: request.body.area }, { ...seat, id: '55', no: 'SECOND', area: request.body.area }] };
      return normalResponse(request);
    });
    h.monitor.start({ ...all, mode, scopes: mode === 'custom' ? [{ premises: '主馆', floor: '二层', area: '南区' }] : [] });
    await until(() => !h.monitor.running);
    assert.equal(h.monitor.getStatus().state, 'SUCCESS'); assert.equal(confirms(h).length, 1);
    const expected = mode === 'all' ? '101' : mode === 'main' ? '102' : '103';
    assert.deepEqual(h.requests.filter(r => r.path.endsWith('/seat')).map(r => r.body.area), [expected, expected]);
    if (mode === 'main') assert.deepEqual(h.requests.find(r => r.path.endsWith('/list'))!.body.premisesIds, ['1']);
    assert.equal(h.waits.length, 0); const count = h.requests.length; await tick(); await tick(); assert.equal(h.requests.length, count);
  });
}
test('no seats waits 15 seconds, next round can succeed, and simultaneous monitor is rejected', async () => {
  let available = false;
  const h = setup(request => request.path.endsWith('/seat') ? { code: 1, data: available ? [seat] : [] } : normalResponse(request));
  h.monitor.start(all); assert.throws(() => h.monitor.start(all), { code: 'BUSY' });
  await until(() => h.waits.length === 1); assert.equal(h.monitor.getStatus().state, 'WAITING'); assert.deepEqual(h.waits, [15000]);
  available = true; h.releases[0]!(); await until(() => !h.monitor.running);
  assert.equal(h.monitor.getStatus().state, 'SUCCESS'); assert.equal(confirms(h).length, 1);
});
test('stop clears pending wait; no later scan or confirm', async () => {
  const h = setup(request => request.path.endsWith('/seat') ? { code: 1, data: [] } : normalResponse(request));
  h.monitor.start(all); await until(() => h.waits.length === 1); const count = h.requests.length;
  await h.monitor.stop(); h.releases[0]!(); await tick();
  assert.equal(h.monitor.getStatus().state, 'STOPPED'); assert.equal(h.requests.length, count); assert.equal(confirms(h).length, 0);
});
test('stop during final revalidation prevents confirm', async () => {
  let reads = 0, release!: () => void;
  const h = setup(async request => {
    if (request.path.endsWith('/seat') && ++reads === 2) await new Promise<void>(resolve => { release = resolve; });
    return normalResponse(request);
  });
  h.monitor.start(all); await until(() => Boolean(release)); const stopping = h.monitor.stop(); release(); await stopping;
  assert.equal(h.monitor.getStatus().state, 'STOPPED'); assert.equal(confirms(h).length, 0);
});
for (const action of ['logout', 'shutdown', 'stopAutoSelect'] as const) {
  test(`desktop ${action} stops waiting and prevents later requests`, async () => {
    const h = setup(request => request.path.endsWith('/seat') ? { code: 1, data: [] } : normalResponse(request));
    await h.desktop.startAutoSelect(all); await until(() => h.desktop.autoStatus().state === 'WAITING');
    await h.desktop[action](); assert.equal(h.desktop.autoStatus().state, 'STOPPED'); assert.equal(confirms(h).length, 0);
    if (action === 'logout') assert.equal(h.desktop.status().state, 'LOGIN_REQUIRED');
  });
}
test('switching mode joins stopped task before starting its replacement', async () => {
  const h = setup(request => request.path.endsWith('/seat') ? { code: 1, data: [] } : normalResponse(request));
  await h.desktop.startAutoSelect(all); await until(() => h.desktop.autoStatus().state === 'WAITING');
  await h.desktop.startAutoSelect({ ...all, mode: 'custom', scopes: [{ premises: '测试馆' }] });
  await until(() => h.desktop.autoStatus().state === 'WAITING'); assert.equal(h.desktop.autoStatus().mode, 'custom');
  await h.desktop.shutdown(); assert.equal(confirms(h).length, 0);
});
for (const retryAfter of [undefined, '45', '1'] as const) {
  test(`429 respects Retry-After ${retryAfter ?? 'absent'} with minimum interval and exponential fallback`, async () => {
    const h = setup(request => { throw new AxiosError(fakeToken, 'ERR_BAD_REQUEST', request.config, undefined, {
      data: fakeToken, status: 429, statusText: '', headers: new AxiosHeaders(retryAfter ? { 'retry-after': retryAfter } : {}), config: request.config,
    }); });
    h.monitor.start(all); await until(() => h.waits.length === 1);
    assert.equal(h.waits[0], retryAfter === '45' ? 45000 : retryAfter === '1' ? 10000 : 30000);
    if (!retryAfter) { h.releases[0]!(); await until(() => h.waits.length === 2); assert.equal(h.waits[1], 60000); h.releases[1]!(); await until(() => h.waits.length === 3); assert.equal(h.waits[2], 120000); }
    await h.monitor.stop(); assert.equal(confirms(h).length, 0);
  });
}
test('network errors back off rather than invoking HttpClient immediate retries', async () => {
  const h = setup(request => { throw new AxiosError(fakeToken, 'ECONNRESET', request.config); });
  h.monitor.start(all); await until(() => h.waits.length === 1); assert.deepEqual(h.waits, [30000]); assert.equal(h.requests.length, 1);
  h.releases[0]!(); await until(() => h.waits.length === 2); assert.deepEqual(h.waits, [30000, 60000]); await h.monitor.stop();
});
for (const response of ['timeout', '5xx', 'malformed', 'business'] as const) {
  test(`confirm ${response} stops permanently after exactly one synthetic submission`, async () => {
    const h = setup(request => {
      if (request.path.endsWith('/confirm')) {
        if (response === 'timeout') throw new AxiosError(fakeToken, 'ETIMEDOUT', request.config);
        if (response === '5xx') throw new AxiosError(fakeToken, 'ERR_BAD_RESPONSE', request.config, undefined, { data: {}, status: 503, statusText: '', headers: {}, config: request.config });
        if (response === 'malformed') return { nonsense: true };
        return { code: 777, msg: fakeToken };
      }
      return normalResponse(request);
    });
    h.monitor.start(all); await until(() => !h.monitor.running);
    assert.equal(h.monitor.getStatus().state, 'FAILED'); assert.equal(confirms(h).length, 1); assert.deepEqual(h.waits, []);
    if (response !== 'business') assert.equal((h.monitor.getStatus().error as BookingError).code, 'CONFIRM_OUTCOME_UNKNOWN');
  });
}
test('manual timeout has no retry and is an explicit unknown outcome', async () => {
  const h = setup(request => { if (request.path.endsWith('/confirm')) throw new AxiosError(fakeToken, 'ETIMEDOUT', request.config); return normalResponse(request); });
  await assert.rejects(h.desktop.reserveManual({ ...period, location, seat: seat.no }), { code: 'CONFIRM_OUTCOME_UNKNOWN', stage: 'confirm' });
  assert.equal(confirms(h).length, 1);
});
test('login business invalidation stops monitor and does not submit', async () => {
  const h = setup(() => ({ code: 10001, msg: fakeToken })); h.monitor.start(all); await until(() => !h.monitor.running);
  assert.equal((h.monitor.getStatus().error as BookingError).code, 'INVALID_TOKEN'); assert.equal(h.waits.length, 0); assert.equal(confirms(h).length, 0);
});
test('desktop denies forged authority, IDs, arbitrary paths, invalid periods and empty custom scopes', async () => {
  const h = setup();
  for (const input of [null, [], { ...period, confirmEnabled: true }, { ...period, day: '2026-02-30' }, { ...period, endTime: '07:00' }, { ...period, refresh: 1 }]) await assert.rejects(h.desktop.listAvailability(input), BookingError);
  for (const extra of [{ seat_id: '5' }, { segment: '4' }, { token: fakeToken }, { url: 'https://evil.test' }]) await assert.rejects(h.desktop.reserveManual({ ...period, location, seat: seat.no, ...extra }), { code: 'INVALID_INPUT' });
  await assert.rejects(h.desktop.startAutoSelect({ ...all, intervalMs: 1 }), { code: 'INVALID_INPUT' });
  await assert.rejects(h.desktop.startAutoSelect({ ...all, mode: 'custom' }), { code: 'INVALID_INPUT' });
  await assert.rejects(h.desktop.listSeats({ ...period, location: { premises: '测试馆', area: '北区' } }), { code: 'INVALID_INPUT' });
  assert.equal(h.requests.length, 0);
});
test('poll minimum is enforced and real timer abort releases its listener', async () => {
  assert.throws(() => new AutoSelectMonitor(async () => { throw new Error(); }, undefined, undefined, 9999), { code: 'INVALID_INTERVAL' });
  const controller = new AbortController(); const pending = waitForPoll(15000, controller.signal); controller.abort(); await pending;
});

test('concurrent reservation calls share no submission opportunity', async () => {
  const h = setup();
  const first = h.reservation.reserve(area, seat.no, period);
  await assert.rejects(h.reservation.reserve(area, seat.no, period), { code: 'BUSY' });
  await first;
  await assert.rejects(h.reservation.reserve(area, seat.no, period), { code: 'CONFIRM_ALREADY_SENT' });
  assert.equal(confirms(h).length, 1);
});
for (const outcome of ['success', 'unknown'] as const) {
  test(`stop after dispatch preserves ${outcome} receipt and never replays confirm`, async () => {
    let release!: () => void;
    const h = setup(async request => {
      if (request.path.endsWith('/confirm')) {
        await new Promise<void>(resolve => { release = resolve; });
        if (outcome === 'unknown') throw new AxiosError(fakeToken, 'ECONNRESET', request.config);
      }
      return normalResponse(request);
    });
    h.monitor.start(all); await until(() => Boolean(release));
    const stopping = h.monitor.stop(); release(); await stopping;
    assert.equal(h.monitor.getStatus().state, outcome === 'success' ? 'SUCCESS' : 'FAILED');
    if (outcome === 'unknown') assert.equal((h.monitor.getStatus().error as BookingError).code, 'CONFIRM_OUTCOME_UNKNOWN');
    assert.equal(confirms(h).length, 1); assert.equal(h.waits.length, 0);
  });
}
test('revalidation race returns to WAITING before any confirm and later round may select a fresh candidate', async () => {
  let reads = 0;
  const h = setup(request => request.path.endsWith('/seat') ? { code: 1, data: [++reads === 2
    ? { ...seat, status: '2', status_name: '已预约' } : seat] } : normalResponse(request));
  h.monitor.start(all); await until(() => h.waits.length === 1); assert.equal(confirms(h).length, 0);
  h.releases[0]!(); await until(() => !h.monitor.running);
  assert.equal(h.monitor.getStatus().state, 'SUCCESS'); assert.equal(confirms(h).length, 1);
});
test('Retry-After HTTP date is parsed without carrying headers or response bodies into the error', async () => {
  const future = new Date(Date.now() + 90000).toUTCString();
  const h = setup(request => { throw new AxiosError(fakeToken, 'ERR_BAD_REQUEST', request.config, undefined, {
    data: { token: fakeToken }, status: 429, statusText: '', headers: new AxiosHeaders({ 'retry-after': future }), config: request.config,
  }); });
  h.monitor.start(all); await until(() => h.waits.length === 1);
  assert.ok(h.waits[0]! >= 88000 && h.waits[0]! <= 90000); await h.monitor.stop();
});
test('ordinary category missing is diagnosed at reserve-index before listing', async () => {
  const h = setup(() => ({ code: 0, data: { ...indexResponse.data, category: [] } }));
  await assert.rejects(h.discovery.list(period), { code: 'SEAT_CATEGORY_NOT_FOUND', stage: 'reserve-index' });
  assert.equal(h.requests.length, 1);
});
test('business login invalidation clears auth once, does not replay, and reports safe auth errors', async () => {
  let clears = 0, calls = 0;
  const http = new HttpClient(fakeToken, axios.create({ adapter: async config => {
    calls++; return { data: { code: '10001', msg: fakeToken }, status: 200, statusText: 'OK', headers: {}, config };
  } }), undefined, async () => { clears++; });
  await assert.rejects(new BookingApi(http).fetchReserveIndex(), { code: 'INVALID_TOKEN', stage: 'reserve-index' });
  assert.equal(calls, 1); assert.equal(clears, 1);
});
test('read-only discovery APIs cannot consume a confirmation authority', async () => {
  const h = setup();
  const api = h.factory(new AbortController().signal);
  await assert.rejects(api.confirmSeat({ seatId: seat.id, segment: '411' }), { code: 'REAL_CONFIRM_DISABLED' });
  assert.equal(h.requests.length, 0);
});
