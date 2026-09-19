import { BookingError, invalidShape } from '../errors.js';
import { isDay, isTime } from '../config/config.js';
import type { Area, BookingResult, NamedItem, ReserveIndex, Seat, SeatDate, Segment } from './types.js';

export function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidShape(context, value);
  return value as Record<string, unknown>;
}
export function array(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) invalidShape(context, value);
  return value;
}
export function string(value: unknown, context: string): string {
  if (typeof value !== 'string' || !value.trim()) invalidShape(context, value);
  return value;
}
export function id(value: unknown, context: string): string {
  if ((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) || (typeof value === 'string' && /^\d+$/.test(value))) return String(value);
  return invalidShape(context, value);
}
function status(value: unknown, context: string): string {
  if ((typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && /^-?\d+$/.test(value))) return String(value);
  return invalidShape(context, value);
}
export function envelope(value: unknown, successCode: number, context: string): Record<string, unknown> {
  const obj = record(value, context);
  if (typeof obj.code !== 'number' && typeof obj.code !== 'string') invalidShape(context, value);
  // The public frontend uses coercive code checks for query endpoints.
  if (obj.code !== successCode && obj.code !== String(successCode)) {
    // Do not echo arbitrary server messages that can include account information.
    throw new BookingError('API_BUSINESS_ERROR', `${context}: business request rejected (code=${/^\d+$/.test(String(obj.code)) ? obj.code : 'unrecognized'}).`);
  }
  return obj;
}
function named(value: unknown, context: string): NamedItem {
  const obj = record(value, context);
  return { id: id(obj.id, context), name: string(obj.name, context) };
}
export function parseReserveIndex(value: unknown): ReserveIndex {
  const data = record(envelope(value, 0, 'reserve index').data, 'reserve index.data');
  if (!['premises', 'category', 'storey'].every(key => Array.isArray(data[key]))) invalidShape('reserve index.data', data);
  return {
    premises: array(data.premises, 'index.premises').map(x => named(x, 'premises')),
    category: array(data.category, 'index.category').map(x => named(x, 'category')),
    storey: array(data.storey, 'index.storey').map(x => named(x, 'storey')),
  };
}
export function parseReserveList(value: unknown): { list: Area[]; count: number } {
  const data = record(envelope(value, 0, 'reserve list').data, 'reserve list.data');
  const count = Number(id(data.count, 'list.count'));
  if (!Number.isSafeInteger(count)) invalidShape('list.count', data.count);
  return { count, list: array(data.list, 'list.data.list').map(item => {
    const obj = record(item, 'area');
    if (!['id', 'name', 'premisesName', 'storeyName'].every(key => key in obj)) invalidShape('area fields', obj);
    const area: Area = { ...named(obj, 'area'), premisesName: string(obj.premisesName, 'area.premisesName'), storeyName: string(obj.storeyName, 'area.storeyName') };
    // RoomItem on the official site renders these exact fields as 空闲 / 座位.
    if (obj.free_num !== undefined && obj.total_num !== undefined) {
      area.freeCount = Number(id(obj.free_num, 'area.free_num'));
      area.totalCount = Number(id(obj.total_num, 'area.total_num'));
      if (!Number.isSafeInteger(area.totalCount) || !Number.isSafeInteger(area.freeCount) || area.freeCount > area.totalCount) invalidShape('area counts', obj);
    }
    return area;
  }) };
}
export function parseSeatDates(value: unknown): SeatDate[] {
  return array(envelope(value, 1, 'Seat/date').data, 'Seat/date.data').map(item => {
    const obj = record(item, 'date');
    const day = string(obj.day, 'date.day');
    if (!isDay(day)) invalidShape('date.day', obj.day);
    const times: Segment[] = array(obj.times, 'date.times').map(item => {
      const time = record(item, 'segment');
      const state = status(time.status, 'segment.status');
      // Closed segments may legitimately omit times; they cannot be selected.
      const start = typeof time.start === 'string' ? time.start : '';
      const end = typeof time.end === 'string' ? time.end : '';
      if (state === '1' && (!isTime(start) || !isTime(end))) invalidShape('available segment.start/end', time);
      return { ...time, id: id(time.id, 'segment.id'), start, end, status: state };
    });
    return { ...obj, day, times };
  });
}
export function parseSeats(value: unknown): Seat[] {
  return array(envelope(value, 1, 'Seat/seat').data, 'Seat/seat.data').map(item => {
    const obj = record(item, 'seat');
    const seat: Seat = { ...obj, id: id(obj.id, 'seat.id'), no: string(obj.no, 'seat.no'), status: status(obj.status, 'seat.status') };
    for (const key of ['name', 'status_name', 'area_name'] as const) if (obj[key] !== undefined) seat[key] = string(obj[key], `seat.${key}`);
    for (const key of ['area', 'category'] as const) if (obj[key] !== undefined) seat[key] = id(obj[key], `seat.${key}`);
    if (obj.labels !== undefined) seat.labels = array(obj.labels, 'seat.labels');
    return seat;
  });
}
export function parseBookingResult(value: unknown): BookingResult {
  const obj = record(value, 'Seat/confirm');
  if (typeof obj.code !== 'number' && typeof obj.code !== 'string') invalidShape('confirm.code', value);
  const result: BookingResult = { success: obj.code === 1, code: obj.code, message: string(obj.msg, 'confirm.msg') };
  for (const key of ['seat', 'no', 'area', 'time'] as const) if (obj[key] !== undefined) result[key] = string(obj[key], `confirm.${key}`);
  if (obj.new_time !== undefined) result.newTime = string(obj.new_time, 'confirm.new_time');
  return result;
}
