import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCanceledDeletion} from '../lib/canceled-deletion.mjs';
const admin={id:'admin',role:'admin'}, canceled={id:'trip',revision:2,canceledAt:'2026-11-27'};
test('administrator may delete a canceled, non-archived trip',()=>assert.doesNotThrow(()=>assertCanceledDeletion(admin,canceled)));
test('ordinary users, active trips, archived trips and stale or invalid revisions cannot be deleted',()=>{
 assert.throws(()=>assertCanceledDeletion({id:'u',role:'user'},canceled),/Administrator/);
 assert.throws(()=>assertCanceledDeletion(admin,{...canceled,canceledAt:null}),/Only canceled/);
 assert.throws(()=>assertCanceledDeletion(admin,{...canceled,archivedAt:'2026-11-27'}),/Only canceled/);
 assert.throws(()=>assertCanceledDeletion(admin,{...canceled,revision:0}),/Refresh/);
});
test('outstanding cancellation reminders require explicit acknowledgement',()=>{
 const pending={...canceled,hotelCancellationRequired:true};
 assert.throws(()=>assertCanceledDeletion(admin,pending),/Confirm/);
 assert.doesNotThrow(()=>assertCanceledDeletion(admin,pending,true));
 assert.doesNotThrow(()=>assertCanceledDeletion(admin,{...pending,hotelCancellationNotifiedAt:'2026-11-27'}));
});
