import {resolveScheduleDay,hotelNeedsCancellation} from './planner.mjs';
import {buildTransferPlan} from './transfer-plan.mjs';

const byDate=(a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||String(a.time||'').localeCompare(String(b.time||''))||String(a.name||'').localeCompare(String(b.name||''));
export function buildAdminDashboard({trips,transferTrips,allocations,drivers,people,schedule,presence,today}){
  const active=trips.filter(t=>!t.canceledAt&&!t.archivedAt);
  const tasks={request:[],confirmation:[],reconfirm:[],cancel:[],transfer:[]};
  for(const t of trips){
    if(t.archivedAt)continue;
    let kind;
    if(t.canceledAt){if(t.hotelCancellationRequired&&!t.hotelCancellationNotifiedAt)kind='cancel';}
    else if(t.needsReview)kind='reconfirm';
    else if(!hotelNeedsCancellation(t))kind='request';
    else if(!t.confirmationNumber)kind='confirmation';
    if(!kind)continue;
    tasks[kind].push({id:t.id,name:t.person,date:t.checkin,checkout:t.checkout,overdue:t.checkin<today,trip:t});
  }
  const plan=drivers?buildTransferPlan(transferTrips.filter(t=>!t.archivedAt),{period:'all',today,allocations,drivers}):null;
  const groups=plan?.days.flatMap(d=>d.groups)||[];
  for(const g of groups){
    if(!g.people||!g.attention)continue;
    tasks.transfer.push({id:g.key,name:g.entries.map(e=>e.trip.person).filter((v,i,a)=>a.indexOf(v)===i).join(', '),date:g.date,time:g.time,leg:g.leg,overdue:Boolean(g.date&&g.date<today),unseated:g.unseated,attention:g.attention,people:g.people});
  }
  Object.values(tasks).forEach(items=>items.sort(byDate));
  const onsite=people.filter(p=>!p.deletedAt&&!p.isPrimaryAdmin&&['onsite','onsite-half'].includes(resolveScheduleDay(schedule,presence,p.id,today)?.status));
  const movements=active.flatMap(t=>[
    ...(t.outDate===today?[{id:t.id+':arrival',name:t.person,time:t.outTime,flight:t.outFlight,kind:'Arrival',airport:t.outDestination}]:[]),
    ...(t.returnDate===today?[{id:t.id+':departure',name:t.person,time:t.returnTime,flight:t.returnFlight,kind:'Departure',airport:t.returnOrigin}]:[]),
  ]).sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'));
  return {tasks,onsite,movements,checkins:active.filter(t=>t.checkin===today),checkouts:active.filter(t=>t.checkout===today),todayTransfers:groups.filter(g=>g.date===today),pending:Object.values(tasks).reduce((n,a)=>n+a.length,0),transferReady:Boolean(drivers)};
}
