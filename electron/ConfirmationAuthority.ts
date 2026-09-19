import { BookingError } from '../src/errors.js';

// Created only by the two explicit desktop actions. No permit crosses IPC.
export class ConfirmationAuthority {
  private used = false;
  constructor(private readonly signal: AbortSignal) {}
  readonly consume = (): void => {
    if (this.signal.aborted) throw new BookingError('STOPPED', '', 'confirm');
    if (this.used) throw new BookingError('CONFIRM_ALREADY_SENT', '', 'confirm');
    this.used = true;
  };
}
