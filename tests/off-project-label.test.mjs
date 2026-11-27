import test from 'node:test';
import assert from 'node:assert/strict';
import {OFF_PROJECT_LABEL,SCHEDULE_STATUSES,SCHEDULE_BLANK,resolveScheduleDay} from '../lib/planner.mjs';
import {scheduleDayGroups} from '../lib/timeline.mjs';

test('Off project is a display label, not a new stored category',()=>{
  assert.equal(OFF_PROJECT_LABEL,'Off project');
  assert.equal(SCHEDULE_STATUSES.includes(OFF_PROJECT_LABEL),false);
  assert.equal(resolveScheduleDay({},[],'a','2027-01-18'),null);
  const people=[{id:'a',name:'A'},{id:'b',name:'B'}];
  const schedule={'b|2027-01-18':{status:'remote'}};
  const groups=scheduleDayGroups(people,schedule,[],'2027-01-18',{category:'unplanned'});
  assert.deepEqual(groups,[['unplanned',[people[0]]]]);
  assert.equal(resolveScheduleDay({'a|2027-01-18':{status:SCHEDULE_BLANK}},[],'a','2027-01-18'),null);
});
