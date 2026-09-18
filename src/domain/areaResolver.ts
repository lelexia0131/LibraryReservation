import type { BookingApi } from '../api/bookingApi.js';
import type { Area, ReserveIndex } from '../api/types.js';
import type { BookingConfig } from '../config/config.js';
import { BookingError } from '../errors.js';

export async function resolveTargetArea(api: BookingApi, index: ReserveIndex, config: BookingConfig): Promise<Area> {
  const buildings = config.targetBuilding ? index.premises.filter(x => x.name === config.targetBuilding) : [];
  if (config.targetBuilding && buildings.length !== 1) throw new BookingError('TARGET_BUILDING_NOT_UNIQUE', 'TARGET_BUILDING must exactly match one premises.name.');
  // 1 is the website's ordinary-seat product/category, not a captured area ID.
  const ordinarySeat = index.category.find(x => x.id === '1');
  if (!ordinarySeat) throw new BookingError('SEAT_CATEGORY_NOT_FOUND', 'Ordinary seat category (website category 1) is absent.');
  const areas: Area[] = [];
  const ids = new Set<string>();
  let expectedCount: number | undefined;
  for (let page = 1; ; page++) {
    if (page > 100) throw new BookingError('PAGINATION_LIMIT', 'More than 100 area pages; narrow TARGET_BUILDING before trying again.');
    const result = await api.fetchReserveList({ id: '1', date: config.targetDate, categoryIds: [ordinarySeat.id], members: 0, size: 10, page,
      ...(buildings.length ? { premisesIds: buildings.map(x => x.id) } : {}),
    });
    if (expectedCount !== undefined && result.count !== expectedCount) throw new BookingError('PAGINATION_CHANGED', 'Area count changed during pagination; run the query again.');
    expectedCount = result.count;
    for (const area of result.list) {
      if (ids.has(area.id)) throw new BookingError('PAGINATION_CHANGED', 'Area pages overlap or contain duplicates; refusing an ambiguous selection.');
      ids.add(area.id); areas.push(area);
    }
    if (areas.length > result.count || (!result.list.length && areas.length < result.count)) throw new BookingError('PAGINATION_CHANGED', 'Area count does not match pagination.');
    if (areas.length === result.count) break;
  }
  const matches = areas.filter(x => (!config.targetArea || x.name === config.targetArea)
    && (!config.targetBuilding || x.premisesName === config.targetBuilding)
    && (!config.targetFloor || x.storeyName === config.targetFloor));
  if (matches.length !== 1) throw new BookingError(matches.length ? 'TARGET_AREA_AMBIGUOUS' : 'TARGET_AREA_NOT_FOUND',
    `Matched ${matches.length} areas. Set TARGET_AREA and, if needed, TARGET_BUILDING/TARGET_FLOOR using exact website names. The area list does not map seat numbers to areas.`);
  return matches[0]!;
}
