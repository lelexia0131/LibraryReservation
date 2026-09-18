import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTargetSeat, validateSeatAvailable } from '../src/domain/seatSelector.js';
import { parseSeats } from '../src/api/parsers.js';
import { seat } from './fixtures.js';

test('seat.no resolves live seat.id, not array index or name', () => {
  assert.equal(findTargetSeat([{ ...seat, id: '90', no: 'other' }, seat], seat.no).id, seat.id);
  assert.equal(parseSeats({ code: 1, data: [{ ...seat, id: 555, status: 1 }] })[0]!.id, '555');
  assert.doesNotThrow(() => validateSeatAvailable(seat));
});
for (const status of ['2', '6', '7', '99', '-1']) test(`status=${status} never books`, () => {
  assert.throws(() => validateSeatAvailable({ ...seat, status, status_name: '不可用' }), { code: 'TARGET_SEAT_UNAVAILABLE' });
});
test('missing target never falls back to another seat', () => {
  assert.throws(() => findTargetSeat([seat], 'OTHER'), { code: 'TARGET_SEAT_NOT_FOUND' });
});
test('duplicate numbers and contradictory availability are rejected', () => {
  assert.throws(() => findTargetSeat([seat, { ...seat, id: '2' }], seat.no), { code: 'TARGET_SEAT_AMBIGUOUS' });
  for (const changed of [{ ...seat, status_name: '已预约' }, { ...seat, status_name: undefined }, { ...seat, status: '2' }]) {
    assert.throws(() => validateSeatAvailable(changed), { code: 'SEAT_STATUS_CHANGED' });
  }
});
