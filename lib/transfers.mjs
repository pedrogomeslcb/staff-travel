import {PlannerError,assertRevision,requireActiveRequest} from './planner.mjs';

export const DRIVERS=Object.freeze([
  Object.freeze({id:'jos',name:'Jos',licensePlate:'LA123',contact:'+244 123',capacity:3}),
  Object.freeze({id:'vla',name:'Vla',licensePlate:'LA124',contact:'+244 124',capacity:3}),
  Object.freeze({id:'ota',name:'Ota',licensePlate:'LA125',contact:'+244 125',capacity:6}),
]);
export const TRANSFER_STATUSES=Object.freeze([
  ['to_arrange','To arrange','bg-amber-50 text-amber-800'],
  ['assigned','Assigned','bg-blue-50 text-blue-800'],
  ['confirmed','Confirmed','bg-teal-50 text-teal-800'],
  ['completed','Completed','bg-slate-100 text-slate-700'],
  ['canceled','Canceled','bg-red-50 text-red-700'],
]);
export function getTransfer(trip,leg,drivers=DRIVERS) {
  const saved=trip.transfers?.[leg],driver=drivers.find(d=>d.id===saved?.driverId);
  return {status:saved?.status??'to_arrange',driverId:driver?.id??'',driver:driver?.name??'',licensePlate:driver?.licensePlate??'',contact:driver?.contact??'',needsReview:!!saved?.needsReview};
}
export function prepareTransfer(user,old,leg,draft,expectedRevision,now=new Date().toISOString()) {
  if(!user?.id||user.role!=='admin') throw new PlannerError('Only an admin can update airport transfers.',403);
  if(!old) throw new PlannerError('Request not found.',404);
  assertRevision(old,expectedRevision);
  requireActiveRequest(old);
  if(!['arrival','return'].includes(leg)) throw new PlannerError('Choose a valid transfer.');
  if(!draft||typeof draft!=='object'||!TRANSFER_STATUSES.some(s=>s[0]===draft.status)) throw new PlannerError('Choose a valid transfer status.');
  const driverId=draft.driverId===undefined?getTransfer(old,leg).driverId:draft.driverId;
  if(driverId!==''&&!DRIVERS.some(d=>d.id===driverId)) throw new PlannerError('Choose a driver from the provided list.');
  const driver=DRIVERS.find(d=>d.id===driverId);
  const transfer={status:draft.status,driverId:driver?.id??'',driver:driver?.name??'',licensePlate:driver?.licensePlate??'',contact:driver?.contact??'',needsReview:false,updatedBy:user.name,updatedAt:now};
  return {...old,transfers:{...old.transfers,[leg]:transfer},updated:now,revision:(old.revision??0)+1};
}
