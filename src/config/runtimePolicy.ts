import { BookingError } from '../errors.js';

export const REAL_CONFIRM_ENABLED = false;
export function assertRealConfirmEnabled(): void {
  if (!REAL_CONFIRM_ENABLED) throw new BookingError('REAL_CONFIRM_DISABLED', 'Real booking confirmation is disabled in this build.');
}
