import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarAnchor,tripCalendarReference} from '../lib/planner.mjs';

test('empty checkout calendar opens at check-in, including future years',()=>{
  assert.equal(calendarAnchor('','15/01/2027'),'2027-01-15');
});
test('valid existing checkout is preserved when opening the calendar',()=>{
  assert.equal(calendarAnchor('04/02/2027','15/01/2027'),'2027-02-04');
});
test('outdated or incomplete checkout opens at the current check-in date',()=>{
  assert.equal(calendarAnchor('20/12/2026','15/01/2027'),'2027-01-15');
  assert.equal(calendarAnchor('04/02','15/01/2027'),'2027-01-15');
});
test('other calendars retain their own selected date and empty fields retain the existing fallback',()=>{
  assert.equal(calendarAnchor('20/12/2026'),'2026-12-20');
  assert.equal(calendarAnchor('',''),null);
  assert.equal(calendarAnchor('','31/02/2027'),null);
});

test('departure calendar uses arrival month; hotel checkout uses check-in month',()=>{
  const draft={outDate:'28/01/2027',checkin:'01/02/2027',returnDate:'',checkout:''};
  assert.equal(calendarAnchor(draft.returnDate,tripCalendarReference(draft,'returnDate')),'2027-01-28');
  assert.equal(calendarAnchor(draft.checkout,tripCalendarReference(draft,'checkout')),'2027-02-01');
  assert.equal(calendarAnchor('05/02/2027',tripCalendarReference(draft,'returnDate')),'2027-02-05');
  assert.equal(calendarAnchor('05/12/2026',tripCalendarReference(draft,'returnDate')),'2027-01-28');
  assert.equal(tripCalendarReference(draft,'outDate'),'');
  assert.equal(tripCalendarReference(draft,'checkin'),'');
});
