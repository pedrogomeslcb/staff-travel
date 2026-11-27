'use client';
import {useEffect,useMemo,useState} from 'react';
import {CalendarDays,Plane,Hotel,Car,RefreshCw,ArrowRight,CheckCircle2,AlertCircle} from 'lucide-react';
import {iso,display} from '../lib/planner.mjs';
import {buildAdminDashboard} from '../lib/admin-dashboard.mjs';
import {activityLabels} from './TravelAudit';

const format=value=>value?display(value):'Date to confirm';
const link='rounded-md px-2 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-700';
const kinds=[['request','Request hotel','Send booking request to the hotel'],['confirmation','Awaiting confirmation','Obtain and record the confirmation number'],['reconfirm','Reconfirmation required','Contact the hotel about changed details'],['cancel','Notify hotel of cancellation','Record notification after contacting the hotel'],['transfer','Transfers need attention','Assign drivers or review changed transfers']];
function Stat({icon:Icon,label,value,children}){
  return <div className="rounded-xl border bg-white p-4"><p className="flex items-center gap-2 text-xs font-medium text-slate-600"><Icon size={16} aria-hidden="true"/>{label}</p><p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{value}</p>{children}</div>;
}
export default function AdminDashboard({user,repo,trips,people,schedule,presence,transferTrips,allocations,drivers,ready,busy,scheduleReady,onRefresh,onHotel,onTransfer,onLogs,onSchedule}){
  const [events,setEvents]=useState([]),[logError,setLogError]=useState(''),[loading,setLoading]=useState(true),[reloading,setReloading]=useState(false),[reload,setReload]=useState(0),[expanded,setExpanded]=useState({});
  const today=iso(new Date());
  const data=useMemo(()=>buildAdminDashboard({trips,transferTrips,allocations,drivers,people,schedule,presence,today}),[trips,transferTrips,allocations,drivers,people,schedule,presence,today]);
  useEffect(()=>{
    let active=true;setLoading(true);setLogError('');
    Promise.resolve().then(()=>repo.audit(user)).then(records=>{if(active)setEvents(records);},e=>{if(active){setEvents([]);setLogError(e.message);}}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[repo,user.id,reload,trips,schedule,allocations,drivers]);
  async function refresh(){setReloading(true);try{await onRefresh();}finally{setReload(v=>v+1);setReloading(false);}}
  if(user.role!=='admin')return null;
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Admin dashboard</h2><p className="text-sm text-slate-600">{new Date(today+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'})}</p></div><button type="button" disabled={busy||reloading||!ready} onClick={refresh} className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50"><RefreshCw size={15} aria-hidden="true"/>{reloading?'Refreshing…':'Refresh'}</button></header>
    {!ready?<p role="status" className="text-sm text-slate-600">Loading workspace…</p>:<>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat icon={AlertCircle} label="Pending actions" value={data.pending+(data.transferReady?'':'+')}><p className="mt-1 text-xs text-slate-500">Hotels and transfer groups</p></Stat>
      <Stat icon={CalendarDays} label="Onsite today" value={scheduleReady?data.onsite.length:'—'}><button type="button" className={link+' mt-1'} onClick={onSchedule}>Open schedule</button></Stat>
      <Stat icon={Plane} label="Flights today" value={data.movements.length}><p className="mt-1 text-xs text-slate-600">{data.movements.filter(m=>m.kind==='Arrival').length} arrivals · {data.movements.filter(m=>m.kind==='Departure').length} departures</p></Stat>
      <Stat icon={Hotel} label="Hotel movements" value={data.checkins.length+data.checkouts.length}><p className="mt-1 text-xs text-slate-600">{data.checkins.length} check-ins · {data.checkouts.length} check-outs</p></Stat>
    </div>
    {!data.transferReady&&<p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Driver references are not loaded. Transfer pending counts are unavailable; refresh to try again.</p>}
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <section className="min-w-0 rounded-xl border bg-white"><div className="border-b p-4"><h3 className="font-semibold">Action required</h3><p className="mt-1 text-xs text-slate-500">Open items by workflow, earliest dates first. Past unresolved items remain visible.</p></div>
        {kinds.map(([key,title,description])=>{const rows=data.tasks[key],open=expanded[key]??rows.length>0;return <div key={key} className="border-b last:border-b-0">
          <button type="button" aria-expanded={open} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50" onClick={()=>setExpanded(p=>({...p,[key]:!open}))}><div><p className="font-medium text-sm text-slate-900">{title}</p><p className="text-xs text-slate-500">{description}</p></div><span className={'shrink-0 rounded-md px-2 py-1 text-xs font-semibold '+(rows.length?'bg-amber-50 text-amber-900':'bg-slate-100 text-slate-500')}>{key==='transfer'&&!data.transferReady?'—':rows.length}</span></button>
          {open&&<div className="divide-y px-4 pb-2">{rows.slice(0,expanded[key+'-all']?rows.length:5).map(item=><div key={item.id} className="flex items-start justify-between gap-2 py-2.5"><div className="min-w-0"><p className="break-words text-sm font-medium">{item.name}</p><p className="text-xs text-slate-600">{format(item.date)}{item.time?' · '+item.time:''}{item.checkout?' – '+format(item.checkout):''}{item.leg?' · '+(item.leg==='arrival'?'Airport Pick-Up':'Hotel → airport'):''}</p>{item.overdue&&<p className="text-xs font-medium text-amber-800">Past date · unresolved</p>}{key==='transfer'&&<p className="text-xs text-slate-600">{item.people} passengers · {item.unseated?item.unseated+' seats needed':item.attention+' to review'}</p>}</div><button type="button" className={link+' shrink-0'} onClick={()=>key==='transfer'?onTransfer(item.id):onHotel(item.id)}>Open <ArrowRight className="inline" size={13} aria-hidden="true"/></button></div>)}
          {!rows.length&&<p className="py-2 text-xs text-slate-500">No open items.</p>}{rows.length>5&&<button type="button" className={link} onClick={()=>setExpanded(p=>({...p,[key+'-all']:!p[key+'-all']}))}>{expanded[key+'-all']?'Show fewer':'Show all '+rows.length}</button>}</div>}
        </div>;})}
        {!data.pending&&data.transferReady&&<p className="flex items-center gap-2 p-4 text-sm text-emerald-800"><CheckCircle2 size={17} aria-hidden="true"/>No pending actions in the current records.</p>}
      </section>
      <section className="min-w-0 space-y-4">
        <div className="rounded-xl border bg-white p-4"><h3 className="font-semibold">Today’s operations</h3>
          <div className="mt-3 space-y-2"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Flights</h4>{data.movements.length?data.movements.map(m=><div key={m.id} className="flex justify-between gap-2 border-t py-2 text-sm"><div><p className="font-medium">{m.name}</p><p className="text-xs text-slate-500">{m.kind} · {m.flight} · {m.airport}</p></div><span className="font-medium tabular-nums">{m.time||'—'}</span></div>):<p className="text-sm text-slate-500">No flights today.</p>}</div>
          <div className="mt-4 border-t pt-3"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hotel</h4>{[['Check-in',data.checkins],['Check-out',data.checkouts]].map(([label,rows])=><div key={label} className="mt-2 text-sm"><p className="font-medium">{label} · {rows.length}</p>{rows.map(t=><button key={t.id} type="button" className="block text-left text-xs text-blue-700 hover:underline mt-1" onClick={()=>onHotel(t.id)}>{t.person}</button>)}</div>)}</div>
          <div className="mt-4 border-t pt-3"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Transfers</h4>{data.todayTransfers.length?data.todayTransfers.map(g=><button key={g.key} type="button" className="mt-2 flex w-full justify-between gap-2 text-left text-sm hover:bg-slate-50" onClick={()=>onTransfer(g.key)}><span>{g.time} · {g.leg==='arrival'?'Airport Pick-Up':'Hotel → airport'}<span className="block text-xs text-slate-500">{g.totalPeople} passengers</span></span><span className={'text-xs '+(g.attention?'text-amber-800':'text-slate-600')}>{g.attention?'Needs attention':g.people?'Arranged':'Closed'}</span></button>):<p className="mt-2 text-sm text-slate-500">{data.transferReady?'No transfers today.':'Unavailable'}</p>}</div>
          {scheduleReady&&<details className="mt-4 border-t pt-3 text-sm"><summary className="cursor-pointer font-medium">Onsite team · {data.onsite.length}</summary><ul className="mt-2 space-y-1 text-xs text-slate-600">{data.onsite.map(p=><li key={p.id}>{p.name}</li>)}</ul></details>}
        </div>
        <div className="rounded-xl border bg-white p-4"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Recent activity</h3><button type="button" className={link} onClick={onLogs}>View logs</button></div>
          {loading&&<p className="mt-3 text-sm text-slate-500">Loading activity…</p>}{logError&&<p role="alert" className="mt-3 text-sm text-red-700">{logError}</p>}
          {!loading&&!logError&&(!events.length?<p className="mt-3 text-sm text-slate-500">No recorded activity.</p>:<ol className="mt-2 divide-y">{events.slice(0,8).map(e=><li key={e.id} className="py-2.5"><p className="text-sm font-medium">{activityLabels[e.kind]||e.kind}</p><p className="text-xs text-slate-600">{e.actorName}{e.personName&&e.personName!==e.actorName?' · '+e.personName:''}</p><p className="text-xs text-slate-500">{new Date(e.at).toLocaleString('en-GB',{dateStyle:'short',timeStyle:'short'})}</p></li>)}</ol>)}
        </div>
      </section>
    </div></>}
  </div>;
}
