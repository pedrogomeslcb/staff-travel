'use client';
import {useEffect,useMemo,useState,useId} from 'react';
import {CalendarDays,Plane,Hotel,Car,RefreshCw,ArrowRight,CheckCircle2,ChevronDown,Clock} from 'lucide-react';
import {iso,display} from '../lib/planner.mjs';
import {buildAdminDashboard,dashboardActions} from '../lib/admin-dashboard.mjs';
import {activityLabels} from './TravelAudit';

const link='rounded-md px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-700';
const actionInfo={
  request:['Send hotel request','Send booking details'],
  confirmation:['Follow up on confirmation','Record confirmation number'],
  reconfirm:['Reconfirm changed booking','Contact the hotel'],
  cancel:['Notify hotel of cancellation','Record cancellation notice'],
  transfer:['Arrange or review transfer','Check drivers and seats'],
};
const timingLabel={past:'Past date',today:'Today',undated:'Date missing',upcoming:'Upcoming'};
const format=value=>value?display(value):'Date to confirm';
const route=leg=>leg==='arrival'?'Airport Pick-Up':'Hotel → airport';
const PAGE_SIZE=6;
const eventGroups=[
  ['Requests received','hotel_created'],
  ['Hotel requests marked sent','hotel_requested'],
  ['Confirmations recorded','hotel_confirmed'],
  ['Transfer updates','transfer_updated'],
  ['Cancellation notices recorded','hotel_notified'],
];
function SectionHeading({title,description,children}){
  return <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
    <div className="min-w-0"><h3 className="text-base font-semibold text-slate-900">{title}</h3>{description&&<p className="mt-1 text-xs text-slate-500">{description}</p>}</div>
    {children}
  </div>;
}
function SummaryCard({icon:Icon,label,value,detail,selected,onClick,controls}){
  return <button type="button" aria-expanded={selected} aria-controls={controls} onClick={onClick}
    className={'min-w-0 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-blue-700 sm:p-4 '+(selected?'border-blue-300 bg-blue-50':'border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50')}>
    <span className="flex items-start justify-between gap-2"><Icon size={18} className="shrink-0 text-slate-500" aria-hidden="true"/><ChevronDown size={16} aria-hidden="true" className={'shrink-0 text-slate-400 transition-transform '+(selected?'rotate-180':'')}/></span>
    <span className="mt-3 block text-2xl font-semibold tabular-nums text-slate-900">{value}</span>
    <span className="mt-1 block text-sm font-medium text-slate-800">{label}</span>
    <span className="mt-1 block text-xs text-slate-500">{detail}</span>
  </button>;
}
function ActionQueue({data,today,onHotel,onTransfer}){
  const [filter,setFilter]=useState('all'),[limit,setLimit]=useState(PAGE_SIZE);
  const all=dashboardActions(data.tasks,today),priority=dashboardActions(data.tasks,today,'priority');
  const counts={all:all.length,priority:priority.length,hotel:all.filter(r=>r.area==='hotel').length,transfer:all.filter(r=>r.area==='transfer').length};
  const rows=dashboardActions(data.tasks,today,filter);
  const past=all.filter(r=>r.timing==='past').length,dueToday=all.filter(r=>r.timing==='today').length,undated=all.filter(r=>r.timing==='undated').length;
  return <section aria-label="Action center" className="overflow-hidden rounded-xl border bg-white">
    <SectionHeading title="Action center">
      <div className="shrink-0 rounded-lg bg-slate-100 px-3 py-2 text-right">
        <p className="text-xl font-semibold tabular-nums text-slate-900">{all.length}{data.transferReady?'':'+'}</p><p className="text-xs text-slate-600">Open items</p>
      </div>
    </SectionHeading>
    <div className="border-y bg-slate-50 px-4 py-2.5 sm:px-5">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className={past?'font-semibold text-amber-800':''}>{past} past dates</span>
        <span className={dueToday?'font-semibold text-amber-800':''}>{dueToday} today</span>
        {undated>0&&<span className="font-semibold text-amber-800">{undated} missing dates</span>}
        <span>{all.length-priority.length} upcoming</span>
      </p>
    </div>
    {!data.transferReady&&<p role="status" className="mx-4 mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 sm:mx-5">Driver data unavailable. Refresh to retry.</p>}
    <div className="flex flex-wrap gap-1.5 px-4 py-3 sm:px-5" aria-label="Filter open actions">
      {[
        ['all','All'],
        ['priority','Needs attention first'],
        ['hotel','Hotel'],
        ['transfer','Transfers'],
      ].map(([key,label])=><button key={key} type="button" aria-pressed={filter===key} onClick={()=>{setFilter(key);setLimit(PAGE_SIZE);}}
        className={'rounded-lg px-3 py-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-blue-700 '+(filter===key?'bg-blue-50 text-blue-900 ring-1 ring-blue-200':'text-slate-600 hover:bg-slate-100')}>
        {label} <span className="ml-1 tabular-nums">{key==='transfer'&&!data.transferReady?'—':counts[key]}</span>
      </button>)}
    </div>
    {rows.length?<>
      <div className="hidden grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] gap-4 border-y bg-slate-50 px-5 py-2 text-xs font-medium text-slate-500 sm:grid" aria-hidden="true"><span>Action needed</span><span>Team member / group</span><span>Relevant date</span><span className="w-16 text-right">Action</span></div>
      <ol className="divide-y">
        {rows.slice(0,limit).map(row=><li key={row.kind+':'+row.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] sm:items-center sm:gap-4 sm:px-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900">{actionInfo[row.kind][0]}</p>
            <p className="mt-0.5 text-xs text-slate-500">{row.kind==='transfer'?(row.unseated?row.unseated+' seats needed':row.attention+' to review')+' · '+route(row.leg):actionInfo[row.kind][1]}</p>
          </div>
          <div className="min-w-0"><p className="break-words text-sm text-slate-800">{row.name}</p>{row.kind==='transfer'&&<p className="text-xs text-slate-500">{row.people} passengers</p>}</div>
          <div className="flex items-center justify-between gap-2 sm:block">
            <div><p className={'text-xs font-medium '+(row.timing==='upcoming'?'text-slate-500':'text-amber-800')}>{timingLabel[row.timing]}</p><p className="mt-0.5 text-xs tabular-nums text-slate-700">{format(row.date)}{row.time?' · '+row.time:''}{row.checkout?' – '+format(row.checkout):''}</p></div>
          </div>
          <button type="button" aria-label={'Open '+actionInfo[row.kind][0]+' for '+row.name} className={link+' inline-flex w-fit items-center gap-1 sm:justify-self-end'} onClick={()=>row.kind==='transfer'?onTransfer(row.id):onHotel(row.id)}>Open <ArrowRight size={14} aria-hidden="true"/></button>
        </li>)}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 sm:px-5"><p className="text-xs text-slate-500">Showing {Math.min(limit,rows.length)} of {rows.length} open items</p>{rows.length>PAGE_SIZE&&<button type="button" className={link} onClick={()=>setLimit(limit>=rows.length?PAGE_SIZE:limit+PAGE_SIZE)}>{limit>=rows.length?'Show fewer':'Show more'}</button>}</div>
    </>:<div className="border-t px-4 py-6 sm:px-5"><p className="flex items-center gap-2 text-sm text-slate-600">{data.transferReady||filter==='hotel'?<CheckCircle2 size={18} className="shrink-0 text-emerald-700" aria-hidden="true"/>:null}{!data.transferReady&&filter!=='hotel'?'No matching items in the available data.':filter==='all'?'No open actions.':'No open actions in this view.'}</p></div>}
  </section>;
}
function TodayOperations({data,scheduleReady,onHotel,onTransfer,onSchedule}){
  const [selection,setSelection]=useState(null),detailId=useId();
  const cards=[
    ['onsite',CalendarDays,'Onsite',scheduleReady?data.onsite.length:'—',scheduleReady?'Team members':'Schedule unavailable'],
    ['flights',Plane,'Flight movements',data.movements.length,data.movements.filter(m=>m.kind==='Arrival').length+' arrivals · '+data.movements.filter(m=>m.kind==='Departure').length+' departures'],
    ['hotel',Hotel,'Hotel movements',data.checkins.length+data.checkouts.length,data.checkins.length+' check-ins · '+data.checkouts.length+' check-outs'],
    ['transfers',Car,'Transfer groups',data.transferReady?data.todayTransfers.length:'—',data.transferReady?data.todayTransfers.filter(g=>g.people&&g.attention).length+' need attention':'Transfers unavailable'],
  ];
  const empty=message=><p className="py-2 text-sm text-slate-500">{message}</p>;
  return <section aria-label="Today's operations" className="rounded-xl border bg-white">
    <SectionHeading title="Today's operations" description="Select a card for details."/>
    <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:gap-3 sm:px-5 lg:grid-cols-4">
      {cards.map(([key,icon,label,value,detail])=><SummaryCard key={key} icon={icon} label={label} value={value} detail={detail} selected={selection===key} controls={detailId} onClick={()=>setSelection(selection===key?null:key)}/>)}
    </div>
    <div id={detailId} hidden={!selection} className="border-t px-4 py-4 sm:px-5">
      {selection==='onsite'&&<><div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">Onsite team</h4><button type="button" className={link} onClick={onSchedule}>Open Schedule <ArrowRight size={13} className="inline" aria-hidden="true"/></button></div>
        {scheduleReady?(data.onsite.length?<ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.onsite.map(p=><li key={p.id} className="rounded-lg border px-3 py-2 text-sm text-slate-700">{p.name}</li>)}</ul>:empty('No team members marked onsite today.')):empty('Team schedule is unavailable.')}</>}
      {selection==='flights'&&<><h4 className="mb-2 text-sm font-semibold">Arrivals & departures</h4>{data.movements.length?<ul className="divide-y">{data.movements.map(m=><li key={m.id} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 py-2.5 text-sm"><span className="font-medium tabular-nums text-slate-800">{m.time||'—'}</span><div className="min-w-0"><p className="break-words font-medium">{m.name}</p><p className="text-xs text-slate-500">{[m.flight,m.airport].filter(Boolean).join(' · ')}</p></div><span className="text-xs text-slate-600">{m.kind}</span></li>)}</ul>:empty('No flight movements today.')}</>}
      {selection==='hotel'&&<><h4 className="mb-3 text-sm font-semibold">Check-ins & check-outs</h4><div className="grid gap-4 sm:grid-cols-2">{[['Check-ins',data.checkins],['Check-outs',data.checkouts]].map(([label,rows])=><div key={label} className="rounded-lg border p-3"><p className="text-sm font-medium">{label} · {rows.length}</p>{rows.length?<ul className="mt-2 divide-y">{rows.map(t=><li key={t.id} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0 break-words text-sm">{t.person}</span><button type="button" className={link} onClick={()=>onHotel(t.id)} aria-label={'Open hotel request for '+t.person}>Open</button></li>)}</ul>:empty('None today.')}</div>)}</div></>}
      {selection==='transfers'&&<><h4 className="mb-2 text-sm font-semibold">Transfer groups</h4>{data.transferReady?(data.todayTransfers.length?<ul className="divide-y">{data.todayTransfers.map(g=><li key={g.key} className="flex flex-wrap items-center justify-between gap-2 py-2.5"><div className="min-w-0"><p className="text-sm font-medium">{g.time||'Time to confirm'} · {route(g.leg)}</p><p className="text-xs text-slate-500">{g.totalPeople} passengers{g.drivers.length?' · '+g.drivers.map(d=>d.name).join(', '):''}</p></div><div className="flex items-center gap-2"><span className={'text-xs '+(g.people&&g.attention?'font-medium text-amber-800':'text-slate-600')}>{!g.people?'Closed':g.attention?'Needs attention':'Driver allocated'}</span><button type="button" className={link} onClick={()=>onTransfer(g.key)} aria-label={'Open transfer '+g.time+' '+route(g.leg)}>Open</button></div></li>)}</ul>:empty('No transfers today.')):empty('Transfer details are unavailable.')}</>}
    </div>
  </section>;
}
function ActivitySummary({events,loading,error,today,onLogs}){
  const todaysEvents=events.filter(e=>e.at&&iso(new Date(e.at))===today);
  const sorted=[...events].sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  const counts=eventGroups.map(([label,kind])=>[label,todaysEvents.filter(e=>e.kind===kind).length]);
  const other=todaysEvents.length-counts.reduce((n,[,count])=>n+count,0);
  return <section aria-label="Recent activity" className="overflow-hidden rounded-xl border bg-white">
    <SectionHeading title="Recent activity"><button type="button" className={link+' shrink-0'} onClick={onLogs}>View all logs <ArrowRight className="inline" size={13} aria-hidden="true"/></button></SectionHeading>
    {loading?<p role="status" className="px-5 pb-4 text-sm text-slate-500">Loading activity…</p>:error?<p role="alert" className="px-5 pb-4 text-sm text-red-700">{error}</p>:<>
      <div className="border-y bg-slate-50 px-4 py-3 sm:px-5">
        <p className="text-sm font-medium text-slate-800">{todaysEvents.length} recorded {todaysEvents.length===1?'event':'events'} today</p>
        {todaysEvents.length>0&&<p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">{[...counts,['Other changes',other]].filter(([,n])=>n>0).map(([label,n])=><span key={label}>{n} {label.toLowerCase()}</span>)}</p>}
        {events.length>=1000&&<p className="mt-1 text-xs text-slate-500">Counts use the latest 1,000 log entries.</p>}
      </div>
      {sorted.length?<ol className="divide-y">{sorted.slice(0,5).map(e=><li key={e.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 sm:px-5">
        <div className="min-w-0"><p className="text-sm font-medium text-slate-900">{activityLabels[e.kind]||e.kind}</p><p className="mt-0.5 text-xs text-slate-600">By {e.actorName}{e.personName&&e.personName!==e.actorName?' · For '+e.personName:''}{e.trip?.checkin?' · '+format(e.trip.checkin)+' – '+format(e.trip.checkout):''}</p>{e.changes?.length>0&&<p className="mt-0.5 text-xs text-slate-500">Changed: {e.changes.slice(0,3).map(c=>c.label).join(', ')}{e.changes.length>3?'…':''}</p>}</div>
        <time dateTime={e.at} className="flex shrink-0 items-center gap-1 text-xs text-slate-500"><Clock size={12} aria-hidden="true"/>{new Date(e.at).toLocaleString('en-GB',{dateStyle:'short',timeStyle:'short'})}</time>
      </li>)}</ol>:<p className="px-5 py-4 text-sm text-slate-500">No recorded activity.</p>}
    </>}
  </section>;
}
export default function AdminDashboard({user,repo,trips,people,schedule,presence,transferTrips,allocations,drivers,ready,busy,scheduleReady,onRefresh,onHotel,onTransfer,onLogs,onSchedule}){
  const [events,setEvents]=useState([]),[logError,setLogError]=useState(''),[loading,setLoading]=useState(true),[reloading,setReloading]=useState(false),[reload,setReload]=useState(0);
  const today=iso(new Date());
  const data=useMemo(()=>buildAdminDashboard({trips,transferTrips,allocations,drivers,people,schedule,presence,today}),[trips,transferTrips,allocations,drivers,people,schedule,presence,today]);
  useEffect(()=>{
    if(user.role!=='admin')return;
    let active=true;setLoading(true);setLogError('');
    Promise.resolve().then(()=>repo.audit(user)).then(records=>{if(active)setEvents(records);},e=>{if(active){setEvents([]);setLogError(e.message);}}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[repo,user.id,user.role,reload,trips,schedule,allocations,drivers]);
  async function refresh(){setReloading(true);try{await onRefresh();}finally{setReload(v=>v+1);setReloading(false);}}
  if(user.role!=='admin')return null;
  return <div className="space-y-4 sm:space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold text-slate-900">Admin dashboard</h2><p className="mt-1 text-sm text-slate-600">{new Date(today+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'})}</p></div>
      <button type="button" disabled={busy||reloading||!ready} onClick={refresh} className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50"><RefreshCw size={15} aria-hidden="true"/>{reloading?'Refreshing…':'Refresh'}</button>
    </header>
    {!ready?<p role="status" className="text-sm text-slate-600">Loading workspace…</p>:<>
      <TodayOperations data={data} scheduleReady={scheduleReady} onHotel={onHotel} onTransfer={onTransfer} onSchedule={onSchedule}/>
      <ActionQueue data={data} today={today} onHotel={onHotel} onTransfer={onTransfer}/>
      <ActivitySummary events={events} loading={loading} error={logError} today={today} onLogs={onLogs}/>
    </>}
  </div>;
}
