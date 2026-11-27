import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAdminDashboard} from '../lib/admin-dashboard.mjs';
import {driverIdentity} from '../lib/driver-catalog.mjs';
import {DRIVERS} from '../lib/transfers.mjs';
import {buildTransferPlan,transferSlot} from '../lib/transfer-plan.mjs';
const today='2027-01-18';
const makeTrip=(id,extra={})=>({id,userId:id,person:'Person '+id,hotel:'Not specified',checkin:today,checkout:'2027-01-20',outDate:today,outTime:'06:20',outFlight:'LH560',outDestination:'NBJ',returnDate:'2027-01-20',returnFlight:'LH561',returnOrigin:'NBJ',pickupDate:'2027-01-20',pickupTime:'19:00',...extra});
const base={today,people:[],schedule:{},presence:[],allocations:{},transferTrips:[],drivers:DRIVERS};
test('hotel dashboard queues are mutually exclusive and distinguish pending and completed work',()=>{
 const trips=[makeTrip('new'),makeTrip('requested',{hotelRequested:true}),makeTrip('confirmed',{confirmationNumber:'A'}),makeTrip('edited',{confirmationNumber:'B',needsReview:true}),makeTrip('cancel',{canceledAt:today,hotelCancellationRequired:true}),makeTrip('notified',{canceledAt:today,hotelCancellationRequired:true,hotelCancellationNotifiedAt:today}),makeTrip('archived',{archivedAt:today})];
 const data=buildAdminDashboard({...base,trips});
 assert.deepEqual(Object.fromEntries(Object.entries(data.tasks).map(([k,v])=>[k,v.map(r=>r.id)])),{request:['new'],confirmation:['requested'],reconfirm:['edited'],cancel:['cancel'],transfer:[]});
 assert.equal(data.pending,4);assert.equal(data.checkins.length,4);assert.equal(data.movements.length,4);
});
test('transfer queue counts groups, seats and excludes canceled/archived requests',()=>{
 const trips=[makeTrip('a'),makeTrip('b'),makeTrip('c',{canceledAt:today}),makeTrip('d',{archivedAt:today})];
 const key=transferSlot(trips[0],'arrival').key;
 const result=buildAdminDashboard({...base,trips,transferTrips:trips,allocations:{[key]:{driverIds:['jos'],revision:1}}});
 assert.equal(result.tasks.transfer.length,1);
 assert.equal(result.tasks.transfer[0].people,2);
 assert.equal(result.tasks.transfer[0].unseated,2);
 assert.equal(result.todayTransfers.length,1);
});
test('driver rename keeps ID, capacity, existing group allocation and uses new contact details',()=>{
 const driver=driverIdentity({driver_id:'ota',name:'New name',license_plate:'UPDATED',contact:'+244 555'});
 assert.deepEqual(driver,{id:'ota',name:'New name',licensePlate:'UPDATED',contact:'+244 555',capacity:6});
 const trip=makeTrip('a'),key=transferSlot(trip,'arrival').key;
 const plan=buildTransferPlan([trip],{period:'all',today,drivers:[driver],allocations:{[key]:{driverIds:['ota'],revision:1}}});
 const group=plan.days.flatMap(d=>d.groups).find(g=>g.key===key);
 assert.equal(group.unseated,0);assert.equal(group.drivers[0].name,'New name');
 assert.equal(driverIdentity({name:'Jos'}).id,'jos');
});
test('missing driver references are not presented as a valid empty transfer queue',()=>{
 const data=buildAdminDashboard({...base,trips:[makeTrip('a')],drivers:undefined,transferTrips:[makeTrip('a')]});
 assert.equal(data.transferReady,false);assert.equal(data.tasks.transfer.length,0);
});
