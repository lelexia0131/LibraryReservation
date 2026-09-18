import type { AuthState } from '../src/auth/AuthManager.js';

export interface BookingFormInput {
  targetDate: string; targetSeat: string; targetBuilding?: string; targetFloor?: string;
  targetArea?: string; startTime: string; endTime: string;
}
export interface PublicAuthStatus { state: AuthState }
export interface QueryResult {
  available: boolean; seat: string; area: string; day: string; startTime: string; endTime: string;
}
export type Reply<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
export interface LibraryApp {
  getAuthStatus(): Promise<Reply<PublicAuthStatus>>;
  login(): Promise<Reply<PublicAuthStatus>>;
  logout(): Promise<Reply<PublicAuthStatus>>;
  openBookingWebsite(): Promise<Reply<void>>;
  runDryBooking(input: BookingFormInput): Promise<Reply<QueryResult>>;
}
export const channels = {
  status: 'auth:get-status', login: 'auth:login', logout: 'auth:logout',
  website: 'booking:open-web', query: 'booking:dry-run',
} as const;
