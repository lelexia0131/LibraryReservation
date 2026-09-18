import type { BookingWebBrowserAdapter, BookingWebWindow } from '../../src/auth/BookingWebSessionBootstrap.js';
import type { RemoteWindowHost, RemoteWindowOptions } from './ElectronCasBrowserAdapter.js';

export class ElectronBookingWebBrowserAdapter implements BookingWebBrowserAdapter {
  constructor(private readonly host: RemoteWindowHost) {}
  createWindow(options: RemoteWindowOptions): BookingWebWindow { return this.host.create(options, false); }
}
