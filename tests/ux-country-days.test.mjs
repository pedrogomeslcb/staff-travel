import test from 'node:test';
import assert from 'node:assert/strict';
import {countryYearBreakdown} from '../lib/country-days.mjs';
import {blank,changeTrip} from '../lib/planner.mjs';
test('country allowance deduplicates overlapping days and excludes cancellations',()=>{
  const trips=[{userId:'a',outDate:'2026-11-25',returnDate:'2026-12-02'},{userId:'a',outDate:'2026-11-27',returnDate:'2026-12-03'},{userId:'a',outDate:'2026-12-04',returnDate:'2026-12-10',canceledAt:'2026-11-27'},{userId:'b',outDate:'2026-11-25',returnDate:'2026-12-02'}];
  assert.deepEqual(countryYearBreakdown(trips,'a',2026,'2026-11-27'),{completed:3,planned:6,total:9,remaining:81});
});
test('year boundaries and archived records retain country allowance',()=>{
  const trips=[{userId:'a',outDate:'2026-12-30',returnDate:'2027-01-03',archivedAt:'2027-02-04'}];
  assert.deepEqual(countryYearBreakdown(trips,'a',2026,'2027-01-01'),{completed:2,planned:0,total:2,remaining:88});
  assert.deepEqual(countryYearBreakdown(trips,'a',2027,'2027-01-01'),{completed:1,planned:2,total:3,remaining:87});
});
test('flight first form prefills hotel dates without overwriting independent dates',()=>{
  let draft=changeTrip({...blank},'outDate','07/12/2026');
  draft=changeTrip(draft,'returnDate','18/12/2026');
  assert.equal(draft.checkin,'07/12/2026');assert.equal(draft.checkout,'18/12/2026');assert.equal(draft.pickupDate,'18/12/2026');
  draft=changeTrip(draft,'checkin','08/12/2026');
  draft=changeTrip(draft,'outDate','06/12/2026');
  assert.equal(draft.checkin,'08/12/2026');
});
