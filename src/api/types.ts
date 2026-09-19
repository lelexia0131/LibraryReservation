export interface NamedItem { id: string; name: string }
export interface ReserveIndex { premises: NamedItem[]; category: NamedItem[]; storey: NamedItem[] }
export interface Area extends NamedItem { premisesName: string; storeyName: string; freeCount?: number; totalCount?: number }
export interface ReserveListParams {
  id: string; date: string; categoryIds: string[]; members: number; size: number; page: number;
  premisesIds?: string[];
  startTime?: string; endTime?: string;
}
export interface Segment { id: string; start: string; end: string; status: string; [key: string]: unknown }
export interface SeatDate { day: string; times: Segment[]; [key: string]: unknown }
export interface Seat {
  id: string; no: string; name?: string; area?: string; category?: string; status: string;
  status_name?: string; area_name?: string; labels?: unknown[]; point_x?: unknown; point_y?: unknown;
  [key: string]: unknown;
}
export interface SeatListParams { area: string; segment: string; day: string; startTime: string; endTime: string }
export interface BookingResult {
  success: boolean; code: number | string; message: string;
  seat?: string; no?: string; area?: string; time?: string; newTime?: string;
}
