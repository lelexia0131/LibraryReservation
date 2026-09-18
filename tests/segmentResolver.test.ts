import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSeatDates } from '../src/api/parsers.js';
import { resolveTargetDateAndSegment as resolve } from '../src/domain/segmentResolver.js';
import { datesResponse, config } from './fixtures.js';

test('matches requested day and actual segment id', () => {
  assert.equal(resolve(parseSeatDates(datesResponse), config.targetDate, '08:00', '22:00').id, '411');
});
test('multiple segments are selected by containment, never by first array position', () => {
  const times = [
    { id: '21', start: '08:00', end: '12:00', status: '1' },
    { id: '22', start: '14:00', end: '22:00', status: '1' },
  ];
  const dates = [{ day: config.targetDate, times }];
  assert.equal(resolve(dates, config.targetDate, '15:00', '20:00').id, '22');
  assert.throws(() => resolve(dates, config.targetDate, '09:00', '20:00'), { code: 'SEGMENT_UNAVAILABLE' });
  assert.throws(() => resolve([{ ...dates[0]!, times: [times[0]!, times[0]!] }], config.targetDate, '09:00', '10:00'), { code: 'SEGMENT_AMBIGUOUS' });
});
test('unavailable, malformed and nonunique dates stop before seat query', () => {
  const dates = parseSeatDates(datesResponse);
  assert.throws(() => resolve(dates, '2027-01-01', '08:00', '22:00'), { code: 'TARGET_DATE_NOT_UNIQUE' });
  assert.throws(() => resolve([...dates, dates[1]!], config.targetDate, '08:00', '22:00'), { code: 'TARGET_DATE_NOT_UNIQUE' });
  const closed = parseSeatDates({ code: 1, data: [{ day: config.targetDate, times: [{ id: 1, status: -1, start: '', end: '' }] }] });
  assert.throws(() => resolve(closed, config.targetDate, '08:00', '22:00'), { code: 'SEGMENT_UNAVAILABLE' });
  assert.throws(() => parseSeatDates({ code: 1, data: [{ day: config.targetDate, times: [{ id: 1, status: 1, start: 'bad', end: '22:00' }] }] }), { code: 'RESPONSE_SCHEMA_CHANGED' });
});
