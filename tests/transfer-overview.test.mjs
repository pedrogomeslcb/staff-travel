import test from 'node:test';
import assert from 'node:assert/strict';
import {transferGroupState,transferOverview} from '../lib/transfer-plan.mjs';
test('overview counts groups, including undated attention, without counting passengers as groups',()=>{
 const missing={people:3,attention:3,unseated:3},ready={people:2,attention:0,unseated:0},closed={people:0,attention:0,unseated:0},undated={people:1,attention:1,unseated:0};
 assert.equal(transferGroupState(missing),'attention');assert.equal(transferGroupState(ready),'ready');assert.equal(transferGroupState(closed),'closed');
 assert.deepEqual(transferOverview({days:[{date:'2027-01-01',groups:[missing,ready,closed]},{date:'',groups:[undated]}]}),{days:1,active:3,attention:2});
 assert.deepEqual(transferOverview({days:[]}),{days:0,active:0,attention:0});
});
