import { loadConfig } from '../config/config.js';
import { createTokenProvider } from '../auth/createAuth.js';
import { BookingService } from '../domain/BookingService.js';
import { BookingError } from '../errors.js';
import { BookingApi } from '../api/bookingApi.js';
import { HttpClient } from '../api/httpClient.js';
import { createAxiosTransport } from '../platform/node/AxiosTransport.js';

try {
  const config = loadConfig(process.env, process.argv.slice(2));
  const auth = createTokenProvider(process.env, undefined, 'env');
  const outcome = await new BookingService(auth, token => new BookingApi(new HttpClient(token, createAxiosTransport(), undefined,
    () => auth.invalidateToken?.(token) ?? Promise.resolve()))).runBooking(config);
  if (!outcome.dryRun && !outcome.result.success) process.exitCode = 1;
} catch (error) {
  if (error instanceof BookingError) console.error(`[Booking] ${error.code}: ${error.message}`);
  else console.error('[Booking] UNEXPECTED_ERROR: details withheld.');
  process.exitCode = 1;
}
