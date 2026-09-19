import { encryptBookingPayload, encryptionDate, systemClock, type Clock } from '../crypto/bookingCrypto.js';
import { HttpClient } from './httpClient.js';
import { envelope, id, parseBookingResult, parseReserveIndex, parseReserveList, parseSeatDates, parseSeats, record } from './parsers.js';
import type { ReserveListParams, SeatListParams } from './types.js';
import { assertRealConfirmEnabled } from '../config/runtimePolicy.js';
import { atStage } from '../errors.js';

export class BookingApi {
  constructor(private readonly http: HttpClient, private readonly clock: Clock = systemClock,
    private readonly assertConfirmAllowed: () => void = assertRealConfirmEnabled, private readonly signal?: AbortSignal) {}
  async fetchReserveIndex() { return atStage('reserve-index', async () => parseReserveIndex(await this.http.post('/reserve/index/index', { id: '1' }, { signal: this.signal }))); }
  async fetchReserveList(params: ReserveListParams) { return atStage('reserve-list', async () => parseReserveList(await this.http.post('/reserve/index/list', params, { signal: this.signal }))); }
  async fetchReserveDetail(params: { id: string; areaId: string; date?: string }) {
    return record(envelope(await this.http.post('/reserve/index/detail', params), 0, 'reserve detail').data, 'detail.data');
  }
  async fetchSeatDate(params: { build_id: string }) { return atStage('seat-date', async () => parseSeatDates(await this.http.post('/api/Seat/date', params, { signal: this.signal }))); }
  async fetchSeatList(params: SeatListParams) { return atStage('seat-list', async () => parseSeats(await this.http.post('/api/Seat/seat', params, { signal: this.signal }))); }
  prepareConfirm({ seatId, segment }: { seatId: string; segment: string }) {
    const now = this.clock.now();
    const payload = { seat_id: id(seatId, 'seat_id'), segment: id(segment, 'segment') };
    return { aesjson: encryptBookingPayload(payload, now), encryptionDate: encryptionDate(now) };
  }
  async confirmSeat(params: { seatId: string; segment: string }) {
    this.assertConfirmAllowed();
    // Build at submission time, never reuse a dry-run ciphertext across midnight.
    const { aesjson } = this.prepareConfirm(params);
    return atStage('confirm', async () => parseBookingResult(await this.http.post('/api/Seat/confirm', { aesjson })));
  }
  async submitSeatConfirm(params: { seat_id: string; segment: string }) {
    return this.confirmSeat({ seatId: params.seat_id, segment: params.segment });
  }
}
