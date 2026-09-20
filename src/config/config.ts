import { BookingError } from '../errors.js';
export type { TokenProvider } from '../auth/TokenProvider.js';

export interface BookingConfig {
  targetDate: string;
  targetSeat: string;
  targetArea?: string;
  targetBuilding?: string;
  targetFloor?: string;
  startTime: string;
  endTime: string;
  dryRun: boolean;
}

export const isTime = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateConfig(config: BookingConfig): void {
  if (!isDay(config.targetDate)) throw new BookingError('INVALID_CONFIG', 'TARGET_DATE must be a valid YYYY-MM-DD date.');
  if (!config.targetSeat?.trim()) throw new BookingError('INVALID_CONFIG', 'TARGET_SEAT is required.');
  if (!isTime(config.startTime) || !isTime(config.endTime) || config.startTime >= config.endTime) {
    throw new BookingError('INVALID_CONFIG', 'Expected HH:mm startTime < endTime on the same day.');
  }
  if (typeof config.dryRun !== 'boolean') throw new BookingError('INVALID_CONFIG', 'dryRun must be boolean.');
}

export function loadConfig(env: Record<string, string | undefined>, args: string[] = []): BookingConfig {
  if (args.some(arg => !['--execute', '--dry-run'].includes(arg))) throw new BookingError('INVALID_CONFIG', 'Supported arguments: --execute, --dry-run.');
  if (env.DRY_RUN && !['true', 'false'].includes(env.DRY_RUN)) throw new BookingError('INVALID_CONFIG', 'DRY_RUN must be true or false.');
  const config = {
    targetDate: env.TARGET_DATE?.trim() ?? '', targetSeat: env.TARGET_SEAT?.trim() ?? '',
    targetArea: env.TARGET_AREA?.trim() || undefined, targetBuilding: env.TARGET_BUILDING?.trim() || undefined,
    targetFloor: env.TARGET_FLOOR?.trim() || undefined,
    startTime: env.TARGET_START_TIME?.trim() || '00:01', endTime: env.TARGET_END_TIME?.trim() || '23:59',
    // The dedicated dry command wins even over --execute and DRY_RUN=false.
    dryRun: args.includes('--dry-run') || !(args.includes('--execute') || env.DRY_RUN === 'false'),
  };
  validateConfig(config);
  return config;
}

export function ensureToken(token: string): string {
  if (!token || token !== token.trim() || /\s/.test(token) || /^bearer/i.test(token) || /^<.*>$/.test(token)) {
    throw new BookingError('INVALID_TOKEN', 'BOOKING_TOKEN must contain the raw token, without bearer prefix or whitespace.');
  }
  return token;
}
