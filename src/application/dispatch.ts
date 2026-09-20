import { channels, type Reply } from './contracts.js';
import { LibraryController, safeError } from './LibraryController.js';
import { BookingError } from '../errors.js';

// The only public application entry points; never dispatch arbitrary object properties.
export async function dispatch(controller: LibraryController, command: string, input?: unknown): Promise<Reply<unknown>> {
  try {
    let value: unknown;
    switch (command) {
      case channels.status: value = controller.status(); break;
      case channels.login: value = await controller.login(); break;
      case channels.logout: value = await controller.logout(); break;
      case channels.website: value = await controller.openWebsite(); break;
      case channels.availability: value = await controller.listAvailability(input); break;
      case channels.seats: value = await controller.listSeats(input); break;
      case channels.manual: value = await controller.reserveManual(input); break;
      case channels.autoStart: value = await controller.startAutoSelect(input); break;
      case channels.autoStop: value = await controller.stopAutoSelect(); break;
      case channels.autoStatus: value = controller.autoStatus(); break;
      default: throw new BookingError('FORBIDDEN', '');
    }
    return { ok: true, value };
  } catch (error) { return safeError(error); }
}
