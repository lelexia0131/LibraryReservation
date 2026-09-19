import type { BookingApi } from '../api/bookingApi.js';
import type { Area } from '../api/types.js';
import { atStage, BookingError } from '../errors.js';
import { resolveTargetDateAndSegment } from './segmentResolver.js';

export interface Period { day: string; startTime: string; endTime: string }
export interface Location { premises: string; floor: string; area: string }
export interface LocationView extends Location { freeCount: number }
export interface Scope { premises: string; floor?: string; area?: string }
export const locationOf = (area: Area): Location => ({ premises: area.premisesName, floor: area.storeyName, area: area.name });
export const matchesScope = (area: Area, scope: Scope): boolean => area.premisesName === scope.premises
  && (scope.floor === undefined || area.storeyName === scope.floor) && (scope.area === undefined || area.name === scope.area);
export function checkStopped(signal?: AbortSignal): void { if (signal?.aborted) throw new BookingError('STOPPED', ''); }

export class AvailabilityService {
  constructor(private readonly api: BookingApi, private readonly signal?: AbortSignal) {}

  async areas(period: Period, premises?: string): Promise<Area[]> {
    checkStopped(this.signal);
    const index = await this.api.fetchReserveIndex();
    if (!index.category.some(item => item.id === '1')) throw new BookingError('SEAT_CATEGORY_NOT_FOUND', '', 'reserve-index');
    const buildings = premises === undefined ? [] : index.premises.filter(item => item.name === premises);
    if (premises !== undefined && buildings.length !== 1) throw new BookingError('TARGET_BUILDING_NOT_UNIQUE', '', 'reserve-index');
    const areas: Area[] = [];
    const ids = new Set<string>();
    let count: number | undefined;
    for (let page = 1; ; page++) {
      checkStopped(this.signal);
      if (page > 100) throw new BookingError('PAGINATION_LIMIT', '', 'reserve-list');
      const response = await this.api.fetchReserveList({ id: '1', date: period.day, categoryIds: ['1'], members: 0, size: 10, page,
        startTime: period.startTime, endTime: period.endTime, ...(buildings.length ? { premisesIds: buildings.map(item => item.id) } : {}) });
      if (count !== undefined && count !== response.count) throw new BookingError('PAGINATION_CHANGED', '', 'reserve-list');
      count = response.count;
      for (const area of response.list) {
        if (ids.has(area.id)) throw new BookingError('PAGINATION_CHANGED', '', 'reserve-list');
        ids.add(area.id); areas.push(area);
      }
      if (areas.length > count || (!response.list.length && areas.length < count)) throw new BookingError('PAGINATION_CHANGED', '', 'reserve-list');
      if (areas.length === count) break;
    }
    return areas.filter(area => premises === undefined || area.premisesName === premises);
  }

  async resolve(period: Period, location: Location): Promise<Area> {
    const matches = (await this.areas(period)).filter(area => matchesScope(area, location));
    if (matches.length !== 1) throw new BookingError(matches.length ? 'TARGET_AREA_AMBIGUOUS' : 'TARGET_AREA_NOT_FOUND', '', 'reserve-list');
    return matches[0]!;
  }

  async seats(area: Area, period: Period) {
    checkStopped(this.signal);
    const dates = await this.api.fetchSeatDate({ build_id: area.id });
    const segment = await atStage('seat-date', () => resolveTargetDateAndSegment(dates, period.day, period.startTime, period.endTime));
    checkStopped(this.signal);
    // The official selection component requests the complete selected segment.
    const seats = await this.api.fetchSeatList({ area: area.id, segment: segment.id, day: period.day, startTime: segment.start, endTime: segment.end });
    checkStopped(this.signal);
    if (seats.some(seat => seat.area !== undefined && seat.area !== area.id)) throw new BookingError('SEAT_AREA_MISMATCH', '', 'seat-list');
    return { segment, seats };
  }

  async freeSeats(area: Area, period: Period) {
    const result = await this.seats(area, period);
    return { ...result, seats: result.seats.filter(seat => seat.status === '1' && seat.status_name === '空闲') };
  }

  async list(period: Period): Promise<{ locations: LocationView[]; scopes: Location[] }> {
    const areas = await this.areas(period);
    const locations: LocationView[] = [];
    for (const area of areas) {
      checkStopped(this.signal);
      let freeCount = area.freeCount;
      if (freeCount === undefined) {
        try { freeCount = (await this.freeSeats(area, period)).seats.length; }
        catch (error) { if (isUnavailablePeriod(error)) freeCount = 0; else throw error; }
      }
      if (freeCount > 0) locations.push({ ...locationOf(area), freeCount });
    }
    return { locations, scopes: areas.map(locationOf) };
  }
}

export function isUnavailablePeriod(error: unknown): boolean {
  return error instanceof BookingError && ['SEGMENT_UNAVAILABLE', 'TARGET_DATE_NOT_UNIQUE'].includes(error.code);
}
