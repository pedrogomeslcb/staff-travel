import {PlannerError,display,iso,normalizeFlight,parse} from './planner.mjs';
import {DRIVERS,getTransfer} from './transfers.mjs';

const collator=new Intl.Collator('en-US',{sensitivity:'base',numeric:true});
const text=value=>String(value??'').trim().replace(/\s+/g,' ');
const personId=entry=>entry.trip.userId??entry.trip.id;
const people=entries=>new Set(entries.map(personId)).size;
export const needsTransport=entry=>!['completed','canceled'].includes(entry.transfer.status);
export const needsAttention=entry=>entry.transfer.needsReview||(needsTransport(entry)&&(!entry.date||!entry.time||!entry.flight||!entry.airport||!entry.hotel||!entry.seated));

export function transferSlot(trip,leg) {
  const arrival=leg==='arrival';
  const rawDate=arrival?trip.outDate:trip.pickupDate;
  const date=rawDate&&parse(display(rawDate))===rawDate?rawDate:'';
  const rawTime=arrival?trip.outTime:trip.pickupTime;
  const time=/^([01]\d|2[0-3]):[0-5]\d$/.test(rawTime??'')?rawTime:'';
  const airport=text(arrival?trip.outDestination:trip.returnOrigin).toUpperCase();
  const hotel=text(trip.hotel);
  const assignable=Boolean(date&&time&&airport&&(arrival||hotel));
  const key=JSON.stringify([date,time,leg,airport,arrival?'':hotel.toLowerCase(),assignable?null:trip.id]);
  return {key,date,time,leg,airport,hotel,assignable};
}

function allocateSeats(group,allocation,catalogDrivers) {
  const active=group.entries.filter(needsTransport);
  const legacyEntries=(active.length?active:group.entries).filter(entry=>!entry.transfer.needsReview);
  const driverIds=allocation?.driverIds??[...new Set(legacyEntries.map(entry=>entry.transfer.driverId).filter(Boolean))];
  const available=driverIds.map(id=>catalogDrivers.find(driver=>driver.id===id)).filter(Boolean);
  const driverLimit=group.people>0&&group.people<=3?1:available.length;
  const drivers=available.slice(0,driverLimit).map(driver=>({...driver,passengers:[]}));
  const seated=new Set(),unassigned=new Map();
  for (const entry of active) {
    const id=personId(entry);
    if (seated.has(id)) continue;
    const preferred=!allocation&&!entry.transfer.needsReview&&drivers.find(driver=>driver.id===entry.transfer.driverId);
    if (preferred&&preferred.passengers.length<preferred.capacity) {
      preferred.passengers.push(entry.trip.person);
      seated.add(id);
      unassigned.delete(id);
    } else if (!unassigned.has(id)) unassigned.set(id,entry.trip.person);
  }
  // Share passengers between selected vehicles without exceeding any vehicle's seats.
  const remaining=[...unassigned.entries()];
  const largestVehicle=Math.max(0,...drivers.map(driver=>driver.capacity));
  let next=0;
  for (let seat=0;seat<largestVehicle&&next<remaining.length;seat++) {
    for (const driver of drivers) {
      if (driver.passengers.length>=driver.capacity||next===remaining.length) continue;
      const [id,name]=remaining[next++];
      driver.passengers.push(name);
      seated.add(id);
    }
  }
  for (const entry of active) entry.seated=seated.has(personId(entry));
  return {drivers,unseated:group.people-seated.size,allocationRevision:allocation?.revision??0};
}

export function buildTransferPlan(trips,{direction='all',period='upcoming',today=iso(new Date()),includeCanceled=false,allocations={},drivers=DRIVERS}={}) {
  const grouped=new Map();
  for(const trip of trips)for(const leg of ['arrival','return']) {
    if(trip.canceledAt)continue;
    if(direction!=='all'&&leg!==direction)continue;
    const transfer=getTransfer(trip,leg,drivers);
    if(!includeCanceled&&transfer.status==='canceled')continue;
    const slot=transferSlot(trip,leg),{date,time,airport,hotel,key}=slot;
    if(period==='upcoming'&&date&&date<today)continue;
    const flight=normalizeFlight(leg==='arrival'?trip.outFlight:trip.returnFlight);
    if(!grouped.has(key))grouped.set(key,{...slot,entries:[]});
    grouped.get(key).entries.push({key:trip.id+'-'+leg,trip,leg,date,time,flight,airport,hotel,transfer});
  }
  const groups=[...grouped.values()].sort((a,b)=>
    (a.date||'9999').localeCompare(b.date||'9999')||(a.time||'99:99').localeCompare(b.time||'99:99')||
    a.leg.localeCompare(b.leg)||collator.compare(a.airport,b.airport)||collator.compare(a.key,b.key));
  const days=[];
  for(const group of groups) {
    group.entries.sort((a,b)=>collator.compare(a.trip.person,b.trip.person)||String(a.trip.id).localeCompare(String(b.trip.id)));
    group.flights=[...new Set(group.entries.map(e=>e.flight).filter(Boolean))].sort(collator.compare);
    group.people=people(group.entries.filter(needsTransport));
    group.totalPeople=people(group.entries);
    Object.assign(group,allocateSeats(group,allocations[group.key],drivers));
    group.attention=group.entries.filter(needsAttention).length;
    let day=days.at(-1);
    if(!day||day.date!==group.date){day={date:group.date,groups:[]};days.push(day);}
    day.groups.push(group);
  }
  for(const day of days) {
    const entries=day.groups.flatMap(g=>g.entries),active=entries.filter(needsTransport);
    day.people=people(active);
    day.arrivals=people(active.filter(e=>e.leg==='arrival'));
    day.pickups=people(active.filter(e=>e.leg==='return'));
  }
  const entries=groups.flatMap(g=>g.entries);
  return {days,people:people(entries.filter(needsTransport)),attention:entries.filter(needsAttention).length};
}

export function prepareGroupAllocation(user,trips,key,driverIds,revision,previous) {
  if (!user?.id||user.role!=='admin') throw new PlannerError('Only an admin can allocate transfer drivers.',403);
  if (!Array.isArray(driverIds)||driverIds.length>DRIVERS.length||new Set(driverIds).size!==driverIds.length||
    driverIds.some(id=>!DRIVERS.some(driver=>driver.id===id))) {
    throw new PlannerError('Choose distinct drivers from the provided list.');
  }
  if ((previous?.revision??0)!==revision) throw new PlannerError('The driver allocation changed elsewhere. Reopen the latest version.',409);
  const {days}=buildTransferPlan(trips,{period:'all'});
  const group=days.flatMap(day=>day.groups).find(slot=>slot.key===key);
  if (!group?.assignable||!group.people) throw new PlannerError('This group no longer has passengers with a confirmed date, time, and location.',409);
  if (group.people<=3&&driverIds.length>1) throw new PlannerError('Select one driver for a group of up to three people.');
  return {key,driverIds:[...driverIds],revision:revision+1};
}
