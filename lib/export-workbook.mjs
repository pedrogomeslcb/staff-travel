import ExcelJS from 'exceljs';
import {resolveScheduleDay,SCHEDULE_CATEGORIES} from './planner.mjs';
import {annualLimit,countryMonths,validDay,yearCounts} from './country-days.mjs';
import {schedulePeople} from './timeline.mjs';
import {buildTransferPlan} from './transfer-plan.mjs';
import {DRIVERS,TRANSFER_STATUSES} from './transfers.mjs';

function addSheet(book,title,headers,rows){
  const sheet=book.addWorksheet(title,{views:[{state:'frozen',ySplit:1}]});
  sheet.addRow(headers);
  for(const row of rows)sheet.addRow(row.map(value=>value??''));
  const header=sheet.getRow(1);
  header.font={bold:true,color:{argb:'FFFFFFFF'}};
  header.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF163555'}};
  sheet.columns.forEach((column,i)=>{
    let width=headers[i].length;
    column.eachCell(cell=>{width=Math.max(width,String(cell.value??'').length);});
    column.width=Math.min(60,Math.max(13,width+2));
  });
  sheet.autoFilter={from:{row:1,column:1},to:{row:sheet.rowCount,column:headers.length}};
}
function scheduleRows(snapshot,team){
  const labels=new Map(SCHEDULE_CATEGORIES.map(([id,name])=>[id,name]));
  const result=[];
  for(const person of team){
    const dates=new Set();
    for(const key of Object.keys(snapshot.schedule)){
      if(key.startsWith(person.id+'|'))dates.add(key.slice(-10));
    }
    const stays=snapshot.presence.filter(stay=>stay.userId===person.id&&!stay.canceledAt);
    for(const stay of stays){
      if(!validDay(stay.checkin)||!validDay(stay.checkout))continue;
      for(let t=Date.parse(stay.checkin);t<=Date.parse(stay.checkout);t+=86400000)dates.add(new Date(t).toISOString().slice(0,10));
    }
    for(const day of [...dates].sort()){
      const entry=resolveScheduleDay(snapshot.schedule,stays,person.id,day);
      if(entry)result.push([person.name,day,labels.get(entry.status),entry.source]);
    }
  }
  return result;
}
export function plannerWorkbook(snapshot,{drivers=DRIVERS,database,events=[],year=new Date().getFullYear()}={}){
  if(snapshot.currentUser?.role!=='admin')throw new Error('Administrator access required.');
  const book=new ExcelJS.Workbook();
  const team=schedulePeople(snapshot.people,snapshot.tags);
  addSheet(book,'Schedule',['Team member','Date','Category','Source'],scheduleRows(snapshot,team));
  const counts=countryMonths(snapshot.countryTrips??snapshot.presence);
  const years=new Set([year]);
  for(const months of counts.values())for(const key of months.keys())years.add(Number(key.slice(0,4)));
  const country=[];
  for(const y of [...years].sort())for(const person of team){
    if(snapshot.countryLimited&&person.id!==snapshot.currentUser.id)continue;
    const months=yearCounts(counts.get(person.id),y);
    const total=months.reduce((a,b)=>a+b,0);
    country.push([person.name,y,...months,total,annualLimit,Math.max(0,annualLimit-total),Math.max(0,total-annualLimit)]);
  }
  addSheet(book,'Days in country',['Team member','Year','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Calendar days','Annual quota','Days left','Days over'],country);
  const fields={id:'Request ID',person:'Team member',project:'Project',hotel:'Hotel',checkin:'Check-in',checkout:'Check-out',membership:'IHG number',outFlight:'Inbound flight',outOrigin:'Inbound origin',outDestination:'Arrival airport',outDate:'Arrival date',outTime:'Arrival time',returnFlight:'Return flight',returnOrigin:'Return origin',returnDestination:'Return destination',returnDate:'Departure date',returnTime:'Departure time',pickupDate:'Pickup date',pickupTime:'Pickup time',notes:'Notes',hotelRequested:'Requested from hotel',hotelRequestedBy:'Requested by',hotelRequestedAt:'Requested at',confirmationNumber:'Confirmation number',confirmationUpdatedBy:'Confirmation updated by',confirmationUpdatedAt:'Confirmation updated at',needsReview:'Needs review',canceledAt:'Canceled at',canceledBy:'Canceled by',hotelCancellationRequired:'Cancellation notice required',hotelCancellationNotifiedAt:'Hotel notified at',hotelCancellationNotifiedBy:'Hotel notified by',created:'Created at',updated:'Updated at'};
  addSheet(book,'Hotel and flights',['Status',...Object.values(fields)],snapshot.trips.map(t=>[t.archivedAt?(t.canceledAt?'Archived (canceled)':'Archived'):t.canceledAt?'Canceled':t.confirmationNumber?'Confirmed':t.hotelRequested?'Requested':'Entered',...Object.keys(fields).map(k=>t[k])]));
  const transfers=[];
  const {days}=buildTransferPlan(snapshot.transferTrips,{period:'all',includeCanceled:true,allocations:snapshot.transferAllocations,drivers});
  for(const day of days)for(const group of day.groups)for(const entry of group.entries){
    const assigned=group.drivers.filter(d=>d.passengers.includes(entry.trip.person));
    transfers.push([entry.trip.person,entry.leg==='arrival'?'Airport to hotel':'Hotel to airport',entry.date,entry.time,entry.flight,entry.airport,entry.hotel,TRANSFER_STATUSES.find(s=>s[0]===entry.transfer.status)?.[1],assigned.map(d=>d.name).join(', '),assigned.map(d=>d.licensePlate).join(', '),assigned.map(d=>d.contact).join(', '),entry.transfer.needsReview]);
  }
  addSheet(book,'Transfers',['Passenger','Direction','Date','Time','Flight','Airport','Hotel','Status','Driver','License plate','Driver phone','Needs review'],transfers);
  if(snapshot.currentUser.role==='admin'){
    const tags=new Map(snapshot.tags.map(t=>[t.id,t.name]));
    addSheet(book,'Users and access',['Name','Username','Role','Department'],(database?.profiles??snapshot.users).map(p=>[p.display_name??p.name,p.username,p.role,p.department??tags.get(p.tagId)]));
    if(database){
      addSheet(book,'Flight directory',['Flight','Origin','Destination','Departure','Arrival'],database.flights.map(f=>[f.flightNumber,f.origin,f.destination,f.departure,f.arrival]));
      addSheet(book,'Driver directory',['Driver','License plate','Phone','Seats'],database.drivers.map(d=>[d.name,d.licensePlate,d.contact,d.capacity]));
      addSheet(book,'IHG memberships',['Name','Username','Legacy staff code','IHG number'],[...database.memberships.map(m=>[m.name,m.username,m.staffCode,m.membership]),...(database.legacyMemberships??[]).map(m=>['','',m.staff_code,m.membership])]);
    }
    addSheet(book,'Logs',['Time','Action','Changed by','Team member','Hotel','Check-in','Check-out','Details'],events.map(e=>[e.at,e.kind.replaceAll('_',' '),e.actorName,e.personName,e.trip?.hotel,e.trip?.checkin,e.trip?.checkout,[...(e.changes??[]).map(c=>[c.label,c.before,c.after].filter(v=>v!==undefined).join(' → ')),...(e.days??[]).map(d=>[d.date,d.before,d.after].join(' → ')),...(e.hotels??[]).map(h=>h.hotel+' '+h.status),e.trip?.project].filter(Boolean).join('\n')]));
  }
  return book;
}
export async function downloadWorkbook(snapshot,options){
  const bytes=await plannerWorkbook(snapshot,options).xlsx.writeBuffer();
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const link=document.createElement('a');
  link.href=url;
  link.download='Staff-Planner-'+new Date().toISOString().slice(0,10)+'.xlsx';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
