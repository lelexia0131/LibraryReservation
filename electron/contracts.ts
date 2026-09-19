import type { AuthState } from '../src/auth/AuthManager.js';
import type { Location, LocationView, Period, Scope } from '../src/domain/AvailabilityService.js';
import type { AutoMode, AutoState } from '../src/domain/AutoSelectMonitor.js';
import type { OperationStage } from '../src/errors.js';
export type { Location, LocationView, Period, Scope, AutoMode };
export interface AvailabilityView { locations: LocationView[]; scopes: Location[] }
export interface SeatsView { location: Location; seats: string[]; day: string; startTime: string; endTime: string }
export interface ReservationView { success: boolean; seat: string; location: string; period: string; arrival: string }
export interface AutoView { state: AutoState; mode?: AutoMode; message: string; result?: ReservationView }

export interface BookingFormInput {
  targetDate: string; targetSeat: string; targetBuilding?: string; targetFloor?: string;
  targetArea?: string; startTime: string; endTime: string;
}
export interface PublicAuthStatus { state: AuthState }
export interface QueryResult {
  available: boolean; seat: string; area: string; day: string; startTime: string; endTime: string;
}
export type Reply<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; stage?: OperationStage } };
export interface LibraryApp {
  getAuthStatus(): Promise<Reply<PublicAuthStatus>>;
  login(): Promise<Reply<PublicAuthStatus>>;
  logout(): Promise<Reply<PublicAuthStatus>>;
  openBookingWebsite(): Promise<Reply<void>>;
  listAvailability(input: Period & { refresh?: boolean }): Promise<Reply<AvailabilityView>>;
  listSeats(input: Period & { location: Location }): Promise<Reply<SeatsView>>;
  reserveManual(input: Period & { location: Location; seat: string }): Promise<Reply<ReservationView>>;
  startAutoSelect(input: Period & { mode: AutoMode; scopes: Scope[] }): Promise<Reply<AutoView>>;
  stopAutoSelect(): Promise<Reply<AutoView>>;
  getAutoSelectStatus(): Promise<Reply<AutoView>>;
}
export const channels = {
  status: 'auth:get-status', login: 'auth:login', logout: 'auth:logout',
  website: 'booking:open-web', availability: 'availability:list', seats: 'availability:seats', manual: 'reservation:manual',
  autoStart: 'autoselect:start', autoStop: 'autoselect:stop', autoStatus: 'autoselect:status',
} as const;
