import type { BookingApi } from '../api/bookingApi.js';
import type { Area, BookingResult } from '../api/types.js';
import { atStage, BookingError } from '../errors.js';
import { AvailabilityService, checkStopped, type Period } from './AvailabilityService.js';
import { findTargetSeat, validateSeatAvailable } from './seatSelector.js';

export class ReservationService {
  private submitted = false;
  private pending = false;
  constructor(private readonly api: BookingApi, private readonly discovery: AvailabilityService) {}

  async reserve(area: Area, no: string, period: Period, signal?: AbortSignal): Promise<BookingResult> {
    if (this.pending) throw new BookingError('BUSY', '', 'seat-select');
    if (this.submitted) throw new BookingError('CONFIRM_ALREADY_SENT', '', 'confirm');
    this.pending = true;
    try { return await this.submit(area, no, period, signal); }
    finally { this.pending = false; }
  }
  private async submit(area: Area, no: string, period: Period, signal?: AbortSignal): Promise<BookingResult> {
    const latest = await this.discovery.seats(area, period);
    const seat = await atStage('seat-select', () => {
      const seat = findTargetSeat(latest.seats, no);
      validateSeatAvailable(seat);
      return seat;
    });
    checkStopped(signal);
    this.submitted = true;
    try {
      return await this.api.confirmSeat({ seatId: seat.id, segment: latest.segment.id });
    } catch (error) {
      // A malformed or missing receipt cannot prove that the server did not book.
      if (!(error instanceof BookingError) || ['RESPONSE_SCHEMA_CHANGED', 'UNEXPECTED_ERROR'].includes(error.code)) throw new BookingError('CONFIRM_OUTCOME_UNKNOWN', '', 'confirm');
      error.stage ??= 'confirm';
      throw error;
    }
  }
}
