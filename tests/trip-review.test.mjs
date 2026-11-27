import test from 'node:test';
import assert from 'node:assert/strict';
import {tripReview} from '../lib/trip-review.mjs';
const draft={outDate:'07/12/2026',returnDate:'18/12/2026',checkin:'07/12/2026',checkout:'18/12/2026'};
test('review counts inclusive travel days and hotel nights separately',()=>{
  assert.deepEqual(tripReview(draft,[],'a'),{days:12,nights:11,years:[{year:2026,otherDays:0,additionalDays:12,total:12,remaining:78}]});
});
test('review uses selected traveler, excludes cancellations, deduplicates overlaps and retains archives',()=>{
  const trips=[
    {id:'1',userId:'a',outDate:'2026-12-01',returnDate:'2026-12-10',archivedAt:'2027-01-01'},
    {id:'2',userId:'a',outDate:'2026-12-19',returnDate:'2026-12-20',canceledAt:'2026-12-01'},
    {id:'3',userId:'b',outDate:'2026-11-01',returnDate:'2026-11-30'},
  ];
  assert.deepEqual(tripReview(draft,trips,'a').years,[{year:2026,otherDays:10,additionalDays:8,total:18,remaining:72}]);
  assert.equal(tripReview(draft,trips,'b').years[0].otherDays,30);
});
test('editing replaces old travel dates rather than double counting them',()=>{
  const trips=[{id:'edit',userId:'a',outDate:'2026-12-01',returnDate:'2026-12-31'}];
  assert.deepEqual(tripReview(draft,trips,'a','edit').years,[{year:2026,otherDays:0,additionalDays:12,total:12,remaining:78}]);
});
test('review splits travel spanning years and shows old year when moving a trip',()=>{
  const changed={...draft,outDate:'30/12/2026',returnDate:'03/01/2027'};
  const trips=[{id:'edit',userId:'a',outDate:'2025-12-28',returnDate:'2026-01-03'}];
  assert.deepEqual(tripReview(changed,trips,'a','edit').years,[
    {year:2025,otherDays:0,additionalDays:0,total:0,remaining:90},
    {year:2026,otherDays:0,additionalDays:2,total:2,remaining:88},
    {year:2027,otherDays:0,additionalDays:3,total:3,remaining:87},
  ]);
});
test('review handles invalid dates and over-limit projections',()=>{
  assert.deepEqual(tripReview({...draft,outDate:'invalid'},[],'a').years,[]);
  const trips=[{userId:'a',outDate:'2026-01-01',returnDate:'2026-03-31'}];
  assert.equal(tripReview(draft,trips,'a').years[0].remaining,-12);
});
