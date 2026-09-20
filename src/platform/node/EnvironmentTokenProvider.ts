import { ensureToken } from '../../config/config.js';
import type { TokenProvider } from '../../auth/TokenProvider.js';

export class EnvironmentTokenProvider implements TokenProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}
  async getToken(): Promise<string> { return ensureToken(this.env.BOOKING_TOKEN ?? ''); }
}
