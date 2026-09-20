import { registerPlugin } from '@capacitor/core';
import { channels, type LibraryApp, type Reply } from '../../src/application/contracts.js';

const plugin = registerPlugin<{ invoke(input: { command: string; input?: unknown }): Promise<{ reply: Reply<unknown> }> }>('LibraryApplication');
const invoke = async <T>(command: string, input?: unknown): Promise<Reply<T>> =>
  (await plugin.invoke({ command, ...(input === undefined ? {} : { input }) })).reply as Reply<T>;
const api: LibraryApp = {
  getAuthStatus: () => invoke(channels.status), login: () => invoke(channels.login), logout: () => invoke(channels.logout),
  openBookingWebsite: () => invoke(channels.website), listAvailability: input => invoke(channels.availability, input),
  listSeats: input => invoke(channels.seats, input), reserveManual: input => invoke(channels.manual, input),
  startAutoSelect: input => invoke(channels.autoStart, input), stopAutoSelect: () => invoke(channels.autoStop),
  getAutoSelectStatus: () => invoke(channels.autoStatus),
};
Object.defineProperty(window, 'libraryApp', { value: Object.freeze(api), writable: false, configurable: false });
