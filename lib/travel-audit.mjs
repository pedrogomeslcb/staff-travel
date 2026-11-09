import {PlannerError,SCHEDULE_BLANK,assertRevision,authorizeDeletion,hotelCoversDate,hotelNeedsCancellation,newId,resolveScheduleDay} from './planner.mjs';

export class HotelReminderError extends PlannerError {
  constructor(hotels) {
    super('Review the hotel cancellation reminder before saving.',409);
    this.hotels=hotels;
  }
}

const onsite=status=>status==='onsite'||status==='onsite-half';
const stayDetails=trip=>({
  id:trip.id,hotel:trip.hotel,project:trip.project,checkin:trip.checkin,checkout:trip.checkout,
});
const eventBase=(kind,actor,person,at)=>({
  id:newId(),kind,at,actorId:actor.id,actorName:actor.name,personId:person.id,personName:person.name,
});

export function publicTrip({auditEvents,...trip}) {return trip;}

export function auditHotelChange(kind,actor,old,record) {
  const fields={
    project:'Project',hotel:'Hotel',checkin:'Check-in',checkout:'Check-out',
    outFlight:'Arrival flight',outOrigin:'Arrival origin',outDestination:'Arrival airport',
    outDate:'Arrival date',outTime:'Arrival time',returnFlight:'Return flight',
    returnOrigin:'Return origin',returnDestination:'Return destination',returnDate:'Departure date',
    returnTime:'Departure time',pickupDate:'Hotel pickup date',pickupTime:'Hotel pickup time',
  };
  const changes=kind==='hotel_edited'?Object.entries(fields).flatMap(([key,label])=>
    (old[key]??'')===(record[key]??'')?[]:[{label,before:old[key]??'',after:record[key]??''}]):[];
  if(kind==='hotel_edited'&&(old.notes??'')!==(record.notes??''))changes.push({label:'Comments'});
  if(kind==='hotel_edited'&&(old.membership??'')!==(record.membership??''))changes.push({label:'Hotel loyalty number'});
  const event={
    ...eventBase(kind,actor,{id:record.userId,name:record.person},record.updated),
    trip:stayDetails(record),changes,hotelNotificationRequired:record.hotelCancellationRequired===true,
  };
  return {...record,auditEvents:[...(old?.auditEvents??[]),event]};
}

export function cancelHotelRequest(user,old,revision,acknowledged,now=new Date().toISOString()) {
  authorizeDeletion(user,old,revision,acknowledged);
  const record={
    ...old,canceledAt:now,canceledBy:user.name,hotelCancellationRequired:hotelNeedsCancellation(old),
    updated:now,revision:(old.revision??0)+1,
  };
  return auditHotelChange('hotel_canceled',user,old,record);
}

export function markHotelCancellationNotified(user,old,revision,now=new Date().toISOString()) {
  if(!user?.id||user.role!=='admin')throw new PlannerError('Only an admin can record hotel notification.',403);
  if(!old)throw new PlannerError('Request not found.',404);
  assertRevision(old,revision);
  if(!old.canceledAt||!old.hotelCancellationRequired)throw new PlannerError('This request has no hotel notification to record.');
  if(old.hotelCancellationNotifiedAt)return old;
  return auditHotelChange('hotel_notified',user,old,{
    ...old,hotelCancellationNotifiedAt:now,hotelCancellationNotifiedBy:user.name,
    updated:now,revision:(old.revision??0)+1,
  });
}

export function restoreHotelScheduleDefaults(schedule,trips,scheduleEvents) {
  const blanks=new Map();
  for(const [key,entry] of Object.entries(schedule)) {
    if(entry.status===SCHEDULE_BLANK)blanks.set(key,'');
  }
  if(!blanks.size)return schedule;
  for(const event of scheduleEvents) {
    for(const day of event.days??[]) {
      const key=event.personId+'|'+day.date;
      const previous=blanks.get(key);
      if(day.manualAfter===SCHEDULE_BLANK&&previous!==undefined&&event.at>previous)blanks.set(key,event.at);
    }
  }
  let result=schedule;
  for(const [key,blankAt] of blanks) {
    const date=key.slice(-10),userId=key.slice(0,-11);
    const restored=trips.some(trip=>trip.userId===userId&&hotelCoversDate(trip,date)&&
      (trip.auditEvents??[]).some(event=>{
        if(event.at<=blankAt||!event.trip||!hotelCoversDate(event.trip,date))return false;
        if(event.kind==='hotel_created')return true;
        if(event.kind!=='hotel_edited')return false;
        const checkin=event.changes?.find(change=>change.label==='Check-in')?.before??event.trip.checkin;
        const checkout=event.changes?.find(change=>change.label==='Check-out')?.before??event.trip.checkout;
        return !hotelCoversDate({checkin,checkout},date);
      }));
    if(restored) {
      if(result===schedule)result={...schedule};
      delete result[key];
    }
  }
  return result;
}

export function auditScheduleChange(user,previous,next,trips,changes,acknowledgedHotels,now=new Date().toISOString()) {
  const days=[];
  for(const {date} of changes) {
    const key=user.id+'|'+date;
    const manualBefore=previous[key]?.status??null,manualAfter=next[key]?.status??null;
    if(manualBefore===manualAfter)continue;
    const before=resolveScheduleDay(previous,trips,user.id,date)?.status??null;
    const after=resolveScheduleDay(next,trips,user.id,date)?.status??null;
    days.push({date,before,after,manualBefore,manualAfter});
  }
  if(!days.length)return null;
  const removed=days.filter(day=>onsite(day.before)&&!onsite(day.after)).map(day=>day.date);
  const hotels=[],reminders=[];
  for(const trip of trips) {
    if(trip.userId!==user.id||!hotelNeedsCancellation(trip))continue;
    const dates=removed.filter(date=>hotelCoversDate(trip,date));
    if(!dates.length)continue;
    const hotel={...stayDetails(trip),dates,status:trip.confirmationNumber?'Confirmed':'Requested'};
    hotels.push(hotel);
    if(trip.hotelRequested===true)reminders.push(hotel);
  }
  if(reminders.some(hotel=>!acknowledgedHotels.includes(hotel.id)))throw new HotelReminderError(reminders);
  return {...eventBase(removed.length?'onsite_removed':'schedule_changed',user,user,now),days,hotels};
}

export function travelAudit(trips,scheduleEvents) {
  return [...scheduleEvents,...trips.flatMap(trip=>trip.auditEvents??[])].sort((a,b)=>b.at.localeCompare(a.at));
}
