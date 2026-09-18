import type { SeatDate, Segment } from '../api/types.js';
import { BookingError } from '../errors.js';

export function resolveTargetDateAndSegment(dates: SeatDate[], day: string, start: string, end: string): Segment {
  const matchingDates = dates.filter(date => date.day === day);
  if (matchingDates.length !== 1) throw new BookingError('TARGET_DATE_NOT_UNIQUE', 'TARGET_DATE must match exactly one returned day.');
  const available = matchingDates[0]!.times.filter(time => time.status === '1' && time.start < time.end);
  const matches = available.filter(time => time.start <= start && time.end >= end);
  if (matches.length !== 1) throw new BookingError(matches.length ? 'SEGMENT_AMBIGUOUS' : 'SEGMENT_UNAVAILABLE',
    `Expected one available segment containing ${start}-${end}, found ${matches.length}. Configure TARGET_START_TIME/TARGET_END_TIME within one returned segment.`);
  return matches[0]!;
}
