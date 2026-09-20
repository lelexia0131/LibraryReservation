import { createAxiosTransport } from '../src/platform/node/AxiosTransport.js';
const testTransport = (options: Parameters<typeof axios.create>[0]) => createAxiosTransport(axios.create(options));
import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { HttpClient } from '../src/api/httpClient.js';
import { BookingApi } from '../src/api/bookingApi.js';
import type { BookingConfig } from '../src/config/config.js';
import type { Clock } from '../src/crypto/bookingCrypto.js';

// Entirely synthetic, deliberately different from the supplied captured IDs.
export const fakeToken = 'synthetic-token-for-tests-only';
export const config: BookingConfig = { targetDate: '2026-09-19', targetSeat: 'TEST-A23', targetArea: '北区',
  targetBuilding: '测试馆', targetFloor: '二层', startTime: '08:00', endTime: '22:00', dryRun: true };
export const indexResponse = { code: 0, data: {
  premises: [{ id: '87', name: '其他馆' }, { id: '86', name: '测试馆' }],
  category: [{ id: '4', name: '其他类别' }, { id: '1', name: '普通座位' }], storey: [{ id: '88', name: '二层' }],
} };
export const area = { id: '907', name: '北区', premisesName: '测试馆', storeyName: '二层' };
export const datesResponse = { code: 1, data: [
  { day: '2026-09-18', times: [{ id: '410', start: '00:01', end: '23:59', status: '1' }] },
  { day: config.targetDate, times: [{ id: '411', start: '08:00', end: '22:00', status: '1' }] },
] };
export const seat = { id: '80023', no: config.targetSeat, area: area.id, status: '1', status_name: '空闲' };
export const successResponse = { code: 1, msg: '预约成功', seat: '测试馆 北区 TEST-A23', no: config.targetSeat,
  area: '测试馆 北区', time: '08:00-22:00', new_time: '2026-09-19 08:00-22:00' };
export const fixedClock: Clock = { now: () => new Date(2026, 8, 18, 23, 59, 59) };
export interface Request { path: string; body: Record<string, unknown>; config: InternalAxiosRequestConfig }
export function harness(respond: (request: Request, call: number) => unknown, clock = fixedClock) {
  const requests: Request[] = [];
  const waits: number[] = [];
  const transport = testTransport({ adapter: async requestConfig => {
    const request = { path: requestConfig.url!, body: JSON.parse(requestConfig.data), config: requestConfig };
    requests.push(request);
    return { data: await respond(request, requests.length), status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: requestConfig };
  } });
  const http = new HttpClient(fakeToken, transport, async ms => { waits.push(ms); });
  // Only this synthetic in-memory transport may exercise confirmation protocol tests.
  return { requests, waits, http, api: new BookingApi(http, clock, () => {}) };
}
export function normalResponse(request: Request): unknown {
  switch (request.path) {
    case '/reserve/index/index': return indexResponse;
    case '/reserve/index/list': return { code: 0, data: { list: [area], count: 1 } };
    case '/api/Seat/date': return datesResponse;
    case '/api/Seat/seat': return { code: 1, data: [seat] };
    case '/api/Seat/confirm': return successResponse;
    default: throw new Error('Unexpected endpoint');
  }
}
export function httpFailure(request: Request, status?: number, code = 'ECONNRESET'): never {
  throw new AxiosError('secret transport message ' + fakeToken, code, request.config, undefined,
    status ? { data: { token: fakeToken }, status, statusText: 'Error', headers: new AxiosHeaders(), config: request.config } : undefined);
}
