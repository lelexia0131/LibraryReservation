import { createPersistentAuth } from '../auth/createAuth.js';
import { runAuthCommand } from '../auth/authCommands.js';
import { BookingError } from '../errors.js';

try {
  // No pretend browser or plaintext fallback: a desktop host must supply the adapters.
  const auth = createPersistentAuth(undefined, console.log);
  await runAuthCommand(process.argv[2] ?? '', auth, console.log);
} catch (error) {
  if (error instanceof BookingError) console.error(`[Auth] ${error.code}: ${error.message}`);
  else console.error('[Auth] UNEXPECTED_ERROR: details withheld.');
  process.exitCode = 1;
}
