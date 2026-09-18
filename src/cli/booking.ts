import { loadConfig, EnvironmentTokenProvider } from '../config/config.js';
import { BookingService } from '../domain/BookingService.js';
import { BookingError } from '../errors.js';

try {
  const config = loadConfig(process.env, process.argv.slice(2));
  const outcome = await new BookingService(new EnvironmentTokenProvider()).runBooking(config);
  if (!outcome.dryRun && !outcome.result.success) process.exitCode = 1;
} catch (error) {
  if (error instanceof BookingError) console.error(`[Booking] ${error.code}: ${error.message}`);
  else console.error('[Booking] UNEXPECTED_ERROR: details withheld.');
  process.exitCode = 1;
}
