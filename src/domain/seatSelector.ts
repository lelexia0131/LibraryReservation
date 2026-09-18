import type { Seat } from '../api/types.js';
import { BookingError, redact } from '../errors.js';

export function findTargetSeat(seats: Seat[], target: string): Seat {
  const matches = seats.filter(seat => seat.no === target);
  if (!matches.length) throw new BookingError('TARGET_SEAT_NOT_FOUND', 'The target seat number is not in the selected area.');
  if (matches.length !== 1) throw new BookingError('TARGET_SEAT_AMBIGUOUS', 'Multiple seats have the target seat number.');
  return matches[0]!;
}
export function validateSeatAvailable(seat: Seat): void {
  const description = redact(`Seat ${seat.no}: status=${seat.status}, status_name=${seat.status_name ?? '(missing)'}`);
  if (seat.status === '1' && seat.status_name === '空闲') return;
  if (seat.status === '1' || seat.status_name === '空闲') throw new BookingError('SEAT_STATUS_CHANGED', description);
  throw new BookingError('TARGET_SEAT_UNAVAILABLE', description);
}
