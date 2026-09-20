import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { BookingError } from '../src/errors.js';
import { channels, type Reply } from '../src/application/contracts.js';
import { LibraryController, safeError } from '../src/application/LibraryController.js';

export function trustedSender(event: IpcMainInvokeEvent, window: BrowserWindow, rendererUrl: string): boolean {
  return !window.isDestroyed() && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === rendererUrl;
}
export function registerIpc(ipc: Pick<IpcMain, 'handle'>, window: BrowserWindow, url: string, controller: LibraryController): void {
  const handlers: Record<string, (input?: unknown) => unknown> = {
    [channels.status]: () => controller.status(), [channels.login]: () => controller.login(),
    [channels.logout]: () => controller.logout(), [channels.website]: () => controller.openWebsite(),
    [channels.availability]: input => controller.listAvailability(input),
    [channels.seats]: input => controller.listSeats(input),
    [channels.manual]: input => controller.reserveManual(input),
    [channels.autoStart]: input => controller.startAutoSelect(input),
    [channels.autoStop]: () => controller.stopAutoSelect(),
    [channels.autoStatus]: () => controller.autoStatus(),
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipc.handle(channel, async (event, input): Promise<Reply<unknown>> => {
      try {
        if (!trustedSender(event, window, url)) throw new BookingError('FORBIDDEN', '');
        return { ok: true, value: await handler(input) };
      } catch (error) { return safeError(error, console.warn); }
    });
  }
}
