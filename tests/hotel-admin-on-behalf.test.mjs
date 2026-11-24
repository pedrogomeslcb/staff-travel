import test from 'node:test';
import assert from 'node:assert/strict';
import {blank,prepareRequest,toDraft} from '../lib/planner.mjs';
import {KEYS,localRepository} from '../lib/repository.mjs';

const admin={id:'admin-1',name:'Admin User',role:'admin'};
const member={id:'member-1',name:'Registered Member',role:'user'};
const other={id:'member-2',name:'Other Member',role:'user'};
const validDraft={
  ...blank,project:'Unspecified',hotel:'Not specified',
  checkin:'03/12/2026',checkout:'05/12/2026',outFlight:'LH560',
  outOrigin:'FRA',outDestination:'NBJ',outDate:'03/12/2026',outTime:'10:00',
  returnFlight:'LH561',returnOrigin:'NBJ',returnDestination:'FRA',
  returnDate:'05/12/2026',returnTime:'20:00',pickupDate:'05/12/2026',pickupTime:'17:00',
};
const when='2026-11-24T12:00:00.000Z';

test('admin hotel request is owned by the selected registered team member',()=>{
  const {record}=prepareRequest(admin,validDraft,null,'trip-1',when,member);
  assert.equal(record.userId,member.id);
  assert.equal(record.person,member.name);
  assert.notEqual(record.userId,admin.id);
});

test('non-admin cannot create a hotel request for another user',()=>{
  assert.throws(()=>prepareRequest(member,validDraft,null,'trip-2',when,other),/Only an admin/);
});

test('editing a request never changes its owner',()=>{
  const {record}=prepareRequest(admin,validDraft,null,'trip-3',when,member);
  const changed=prepareRequest(admin,{...toDraft(record),notes:'Updated'},record,'ignored',when,other).record;
  assert.equal(changed.userId,member.id);
  assert.equal(changed.person,member.name);
});

test('local repository rejects unknown team members and preserves owner identity',()=>{
  const stored=new Map([[KEYS.people,JSON.stringify([admin,member])]]);
  const storage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)};
  const repo=localRepository(storage);
  assert.throws(()=>repo.save(admin,validDraft,null,'missing'),/registered team member/);
  const {record}=repo.save(admin,validDraft,null,member.id);
  assert.equal(record.userId,member.id);
  assert.equal(record.person,member.name);
  assert.equal(JSON.parse(stored.get(KEYS.trips))[0].userId,member.id);
});
