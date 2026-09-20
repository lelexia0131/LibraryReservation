import { BookingError } from '../errors.js';

// Created only by the two explicit application actions. No permit crosses a bridge.
export class ConfirmationAuthority {
  private used = false;
  constructor(private readonly signal: AbortSignal) {}
  readonly consume = (): void => {
    if (this.signal.aborted) throw new BookingError('STOPPED', '', 'confirm');
    if (this.used) throw new BookingError('CONFIRM_ALREADY_SENT', '', 'confirm');
    this.used = true;
  };
}
