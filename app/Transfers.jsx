'use client';

import {useId,useState} from 'react';
import {ChevronRight,X,Plane,Car,Users,CalendarDays,AlertCircle,CheckCircle2} from 'lucide-react';
import {display,iso} from '../lib/planner.mjs';
import {DRIVERS,TRANSFER_STATUSES} from '../lib/transfers.mjs';
import {buildTransferPlan,transferOverview,transferGroupState} from '../lib/transfer-plan.mjs';
import Dialog from './Dialog';

const input='w-full border border-slate-300 rounded-lg p-2.5 bg-white text-sm text-slate-800';
const routes={arrival:'Airport → hotel',return:'Hotel → airport'};
const visibleHotel=value=>value==='InterContinental '+'Luanda Miramar'||String(value??'').trim().toLowerCase()==='not specified'?'':value;
const personLabel=n=>`${n} ${n===1?'person':'people'}`;
const seatLabel=n=>`${n} ${n===1?'seat':'seats'}`;
const weekday=date=>new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'long',timeZone:'UTC'});

const control='rounded-lg border bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:opacity-50';
function StatusPill({state}){
  const tone=state==='attention'?'bg-amber-50 text-amber-900':state==='ready'?'bg-emerald-50 text-emerald-800':'bg-slate-100 text-slate-600';
  return <span className={'inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium '+tone}>
    {state==='attention'?<AlertCircle size={13} aria-hidden="true"/>:state==='ready'?<CheckCircle2 size={13} aria-hidden="true"/>:null}
    {state==='attention'?'Needs attention':state==='ready'?'Arranged':'Closed'}
  </span>;
}
function TransferSlot({group,expanded,onToggle,isAdmin,busy,onEdit,onAllocate,onRemove}) {
  const passengersId=useId();
  const arrival=group.leg==='arrival',route=routes[group.leg];
  const flight=group.flights.length===1?group.flights[0]:group.flights.length>1?group.flights.length+' flights':'Flight to confirm';
  const canAssign=isAdmin&&group.people>0&&group.assignable;
  const state=transferGroupState(group);
  return <article aria-label={(group.time||'Time to confirm')+' · '+route} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <h4><button type="button" aria-expanded={expanded} aria-controls={passengersId} onClick={onToggle} className="flex w-full items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-blue-700">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-800">{arrival?<Plane size={19} aria-hidden="true"/>:<Car size={19} aria-hidden="true"/>}</span>
          <span className="min-w-0 flex-1"><span className="block text-lg font-semibold tabular-nums leading-tight text-slate-900">{group.time||'TBD'} <span className="text-sm font-medium text-slate-700">{route}</span></span><span className="mt-1 block break-words text-xs text-slate-500">{[flight,group.airport,!arrival&&visibleHotel(group.hotel)].filter(Boolean).join(' · ')}</span></span>
          <ChevronRight size={17} aria-hidden="true" className={'shrink-0 text-slate-400 transition-transform '+(expanded?'rotate-90':'')}/>
        </button></h4>
        <div className="mt-3 flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700"><Users size={14} aria-hidden="true"/>{personLabel(group.people||group.totalPeople)}</span><StatusPill state={state}/>{group.unseated>0&&<span className="text-xs font-medium text-amber-800">{seatLabel(group.unseated)} needed</span>}{!group.unseated&&group.attention>0&&<span className="text-xs text-amber-800">{group.attention} to review</span>}</div>
      </div>
      <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600"><Car size={14} aria-hidden="true"/>Driver allocation</p>{canAssign&&<button type="button" disabled={busy} className={control+' text-blue-700'} onClick={()=>onAllocate(group)}>{group.drivers.length?'Edit drivers':'Assign drivers'}</button>}</div>
        {group.drivers.length>0?<ul aria-label="Allocated drivers" className="grid gap-2">
          {group.drivers.map(driver=><li key={driver.id} className="flex items-start justify-between gap-2 rounded-md border bg-white px-3 py-2">
            <div className="min-w-0"><p className="break-words text-sm font-semibold text-slate-900">{driver.name}{driver.licensePlate&&<span className="ml-2 text-xs font-normal text-slate-500">{driver.licensePlate}</span>}</p>
              {driver.contact&&<p className="mt-0.5 break-words text-xs text-slate-600">{/^[+\d\s().-]+$/.test(driver.contact)?<a className="text-blue-700 underline" href={'tel:'+driver.contact.replace(/[^+\d]/g,'')}>{driver.contact}</a>:driver.contact}</p>}
              {expanded&&group.drivers.length>1&&driver.passengers.length>0&&<p className="mt-1 break-words text-xs text-slate-600">{driver.passengers.join(', ')}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2"><div className="w-[4.5rem] text-right"><p className="text-xs font-medium tabular-nums text-slate-700">{group.people?driver.passengers.length+'/'+driver.capacity:driver.capacity} seats</p>{group.people>0&&<div role="img" aria-label={driver.passengers.length+' of '+driver.capacity+' seats allocated'} className="mt-1.5 h-1 rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{width:Math.min(100,driver.passengers.length/Math.max(1,driver.capacity)*100)+'%'}}/></div>}</div>
            {canAssign&&<button type="button" disabled={busy} aria-label={'Remove '+driver.name+' from this transfer'} title={'Remove '+driver.name} className="grid size-7 place-items-center rounded border text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-40" onClick={()=>onRemove(group,driver.id)}><X size={14} aria-hidden="true"/></button>}</div>
          </li>)}
        </ul>:<p className={'text-xs '+(group.people>0?'text-amber-800':'text-slate-500')}>{group.people>0?'Awaiting driver':'No driver allocated'}</p>}
        {isAdmin&&group.people>0&&!group.assignable&&<p className="mt-2 text-xs text-slate-500">Confirm trip details to assign drivers.</p>}
      </div>
    </div>
    <div className="border-t border-slate-100">
      <button type="button" aria-expanded={expanded} aria-controls={passengersId} onClick={onToggle} className="flex w-full items-center justify-between gap-2 bg-slate-50/60 px-4 py-2.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-700"><span>Passenger details</span><span className="inline-flex items-center gap-1 text-blue-700">{expanded?'Hide details':'Show details'}<ChevronRight size={14} aria-hidden="true" className={expanded?'rotate-90':''}/></span></button>
      <div id={passengersId} hidden={!expanded}>
        {expanded&&<ul aria-label="Passengers" className="divide-y border-t border-slate-100">
          {group.entries.map(entry=>{
            const {transfer}=entry;
            const statusKey=['to_arrange','assigned'].includes(transfer.status)?(entry.seated?'assigned':'to_arrange'):transfer.status;
            const status=TRANSFER_STATUSES.find(value=>value[0]===statusKey)||TRANSFER_STATUSES[0];
            return <li key={entry.key} className={'flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 '+(transfer.status==='canceled'?'opacity-60':'')}>
              <div className="flex min-w-32 flex-1 items-start gap-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600" aria-hidden="true">{String(entry.trip.person||'?').trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase()}</span><div className="min-w-0"><p className="break-words text-sm font-medium text-slate-900">{entry.trip.person}</p><p className="mt-0.5 break-words text-xs text-slate-500">{entry.flight||'Flight to confirm'}{arrival&&visibleHotel(entry.hotel)&&' · '+visibleHotel(entry.hotel)}</p></div></div>
              <div><span className={'inline-block rounded-md px-2 py-1 text-xs '+(transfer.needsReview?'bg-amber-50 text-amber-800':status[2])}>{transfer.needsReview?'Review required':statusKey==='to_arrange'?'Awaiting driver':statusKey==='assigned'?'Driver assigned':status[1]}</span>{transfer.needsReview&&<span className="mt-0.5 block text-[11px] text-slate-500">Previously: {TRANSFER_STATUSES.find(value=>value[0]===transfer.status)?.[1]||status[1]}</span>}</div>
              {isAdmin&&<button type="button" disabled={busy} className={control+' text-blue-700'} aria-label={'Edit status: '+entry.trip.person+' · '+route} onClick={()=>onEdit(entry)}>Edit status</button>}
            </li>;
          })}
        </ul>}
      </div>
    </div>
  </article>;
}
function Metric({icon:Icon,label,value,attention=false}){
  return <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="flex items-center gap-2 text-xs font-medium text-slate-600"><Icon size={16} aria-hidden="true"/>{label}</p><p className={'mt-2 text-2xl font-semibold tabular-nums '+(attention&&value>0?'text-amber-800':'text-slate-900')}>{value}</p></div>;
}

export default function Transfers({trips,allocations,drivers=DRIVERS,user,busy,onSave,onAllocate,passengersShared=true,focusKey=null,onClearFocus,onBackToAdmin}) {
  const [editing,setEditing]=useState(null),[allocation,setAllocation]=useState(null),[error,setError]=useState('');
  const [direction,setDirection]=useState('all'),[period,setPeriod]=useState(focusKey?'all':'upcoming'),[includeCanceled,setIncludeCanceled]=useState(false);
  const [expandedDays,setExpandedDays]=useState({}),[expandedSlots,setExpandedSlots]=useState({});
  const [expansionMode,setExpansionMode]=useState('auto'),dayIdPrefix=useId();
  const today=iso(new Date()),fullPlan=buildTransferPlan(trips,{direction,period,today,includeCanceled,allocations,drivers});
  const focusedGroup=focusKey?fullPlan.days.flatMap(day=>day.groups).find(group=>group.key===focusKey):null;
  const plan=focusKey?(focusedGroup?{days:[{date:focusedGroup.date,groups:[focusedGroup],people:focusedGroup.people,arrivals:focusedGroup.leg==='arrival'?focusedGroup.people:0,pickups:focusedGroup.leg==='return'?focusedGroup.people:0}],people:focusedGroup.people,attention:focusedGroup.attention}:{days:[],people:0,attention:0}):fullPlan;
  const overview=transferOverview(plan);
  const nearestDay=plan.days.reduce((best,day)=>{
    if(!day.date)return best;
    const distance=Math.abs(Date.parse(day.date+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'));
    const bestDistance=best?Math.abs(Date.parse(best.date+'T12:00:00Z')-Date.parse(today+'T12:00:00Z')):Infinity;
    return distance<bestDistance?day:best;
  },null);
  const nearestSlotKey=nearestDay?.groups.find(group=>group.entries.some(entry=>entry.trip.userId===user.id))?.key??nearestDay?.groups[0]?.key;
  const isExpandedDay=date=>expandedDays[date]??(expansionMode==='all'||(expansionMode==='auto'&&date===nearestDay?.date));
  const isExpandedSlot=key=>expandedSlots[key]??(expansionMode==='all'||(expansionMode==='auto'&&key===nearestSlotKey));
  function setAllExpanded(value){
    setExpansionMode(value?'all':'none');
    setExpandedDays({});
    setExpandedSlots({});
  }
  const isAdmin=user.role==='admin',multiple=allocation?.group.people>3;
  const selectedSeats=drivers.reduce((sum,driver)=>sum+(allocation?.driverIds.includes(driver.id)?driver.capacity:0),0);
  function open(entry) {setEditing({...entry,status:entry.transfer.status});setError('');}
  function openAllocation(group) {
    setAllocation({group,driverIds:group.drivers.map(driver=>driver.id)});
    setError('');
  }
  function close() {if(!busy){setEditing(null);setAllocation(null);setError('');}}
  async function save(event) {
    event.preventDefault();setError('');
    try {if(await onSave(editing.trip,editing.leg,{status:editing.status}))setEditing(null);}
    catch(e) {setError(e.message);}
  }
  async function saveAllocation(event) {
    event.preventDefault();setError('');
    try {
      const {group,driverIds}=allocation;
      if(await onAllocate(group.key,driverIds,group.allocationRevision))setAllocation(null);
    }
    catch(e) {setError(e.message);}
  }
  async function removeDriver(group,driverId) {
    setError('');
    const remaining=group.drivers.filter(driver=>driver.id!==driverId).map(driver=>driver.id);
    try {await onAllocate(group.key,remaining,group.allocationRevision);}
    catch(e) {setError(e.message);}
  }
  return <div className="space-y-4">
    {focusKey&&user.role==='admin'&&<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-4 py-3 text-sm"><span>Transfer selected from the Admin dashboard</span><div className="flex gap-3"><button type="button" className="text-blue-700" onClick={onBackToAdmin}>Back to dashboard</button><button type="button" className="text-blue-700" onClick={onClearFocus}>Show all transfers</button></div></div>}
    <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="Transfer plan overview">
      <div><h2 className="text-base font-semibold text-slate-900">Transfer plan</h2><p className="mt-1 text-xs text-slate-500">{focusKey?'Selected transfer':period==='upcoming'?'Upcoming':'All dates'}</p></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Metric icon={CalendarDays} label="Transfer days" value={overview.days}/>
        <Metric icon={Car} label="Active groups" value={overview.active}/>
        <Metric icon={Users} label="People to transport" value={plan.people}/>
        <Metric icon={AlertCircle} label="Groups needing attention" value={overview.attention} attention/>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md bg-slate-100 p-0.5" aria-label="Date range">
          {[['upcoming','Upcoming'],['all','All dates']].map(([value,label])=><button key={value} aria-pressed={period===value} className={'rounded px-2.5 py-1.5 text-xs font-medium '+(period===value?'bg-white text-blue-800 shadow-sm':'text-slate-600')} onClick={()=>{if(focusKey)onClearFocus();else setPeriod(value);}}>{label}</button>)}
        </div>
        <select aria-label="Transfer direction" className="rounded-md border bg-white px-2 py-1.5 text-xs text-slate-700" value={direction} onChange={event=>{if(focusKey)onClearFocus();else setDirection(event.target.value);}}>
          <option value="all">All transfers</option><option value="arrival">Arrivals</option><option value="return">Hotel pickups</option>
        </select>
        <label className="flex items-center gap-1.5 px-1 text-xs text-slate-600"><input type="checkbox" checked={includeCanceled} onChange={e=>setIncludeCanceled(e.target.checked)}/>Include canceled</label>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" disabled={!plan.days.length} onClick={()=>setAllExpanded(true)} className="rounded-md border px-2.5 py-1.5 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50">Expand all</button>
          <button type="button" disabled={!plan.days.length} onClick={()=>setAllExpanded(false)} className="rounded-md border px-2.5 py-1.5 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50">Collapse all</button>
        </div>
      </div>
      <p className="text-xs text-slate-500">Local times · Flight arrival / hotel pickup.</p>
    </section>
    {!passengersShared&&user.role!=='admin'&&<p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Shared passenger details are not enabled yet. An admin must run supabase/transfer-copassengers.sql in Supabase SQL Editor.</p>}
    {error&&!editing&&!allocation&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!plan.days.length&&<div className="bg-white border rounded-xl p-10 text-center"><p className="font-medium text-slate-700">{trips.length?'No transfers match these filters.':'No transfers yet.'}</p><p className="text-sm text-slate-500 mt-2">{trips.length?'Try All dates or another transfer direction.':'Create a hotel request to add arrival and return transfers.'}</p>{trips.length>0&&<button className="text-sm text-blue-700 mt-4" onClick={()=>{if(focusKey)onClearFocus();else{setPeriod('all');setDirection('all');setIncludeCanceled(true);}}}>Show all transfers</button>}</div>}
    <div className="space-y-3" aria-label="Transfers by day">
      {plan.days.map((day,index)=>{
        const expanded=isExpandedDay(day.date),slotsId=dayIdPrefix+'-'+(day.date||'undated');
        const pending=day.groups.filter(group=>transferGroupState(group)==='attention').length;
        const counts=[
          day.arrivals>0&&`${day.arrivals} arriving`,
          day.pickups>0&&`${day.pickups} returning`,
        ].filter(Boolean);
        return <section key={day.date||'undated'} className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label={day.date?`Transfers on ${display(day.date)}`:'Transfers with date to confirm'}>
          <h3>
            <button type="button" aria-expanded={expanded} aria-controls={slotsId}
              className={'flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-white px-4 py-3.5 text-left hover:bg-slate-50 '+(expanded?'rounded-t-lg':'rounded-lg')}
              onClick={()=>setExpandedDays(previous=>({...previous,[day.date]:!expanded}))}>
              <span className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <ChevronRight aria-hidden="true" className={'size-4 shrink-0 '+(expanded?'rotate-90':'')}/>
                <span className="font-semibold text-slate-900">{day.date?<time dateTime={day.date}>{display(day.date)}</time>:'Date to confirm'}</span>
                {day.date&&<span>{weekday(day.date)}</span>}
                {day.date===today&&<span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">Today</span>}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">{counts.length>0?<span>{counts.join(' · ')}</span>:<span>No passengers to transport</span>}{pending>0&&<span className="rounded-md bg-amber-50 px-2 py-1 text-amber-900">{pending} {pending===1?'group':'groups'} to review</span>}</span>
            </button>
          </h3>
          <div id={slotsId} hidden={!expanded} className="space-y-3 border-t bg-slate-50/60 p-3 sm:p-4">
            {day.groups.map(group=><TransferSlot key={group.key} group={group} expanded={isExpandedSlot(group.key)} onToggle={()=>setExpandedSlots(previous=>({...previous,[group.key]:!isExpandedSlot(group.key)}))} isAdmin={isAdmin} busy={busy} onEdit={open} onAllocate={openAllocation} onRemove={removeDriver}/>)}
          </div>
        </section>;
      })}
    </div>
    {editing&&isAdmin&&<Dialog title="Edit transfer status" onClose={close} wide><form onSubmit={save} className="p-6 space-y-5">
      <div className="text-sm text-slate-600"><p><strong>{editing.trip.person}</strong> · {routes[editing.leg]}</p><p className="text-xs mt-2">{editing.date?display(editing.date):'Date to confirm'} · {editing.time||'Time to confirm'} · {editing.flight||'Flight to confirm'}</p></div>
      {editing.transfer.needsReview&&<p className="bg-amber-50 rounded-lg p-3 text-sm text-amber-900">Trip details changed. Review before saving.</p>}
      <label className="block text-xs text-slate-600">Transfer status<select className={input+' mt-1'} value={editing.status} onChange={e=>setEditing(p=>({...p,status:e.target.value}))}>{TRANSFER_STATUSES.map(([value,label])=><option key={value} value={value}>{value==='to_arrange'?'Automatic (based on driver allocation)':label}</option>)}</select></label>
      {error&&<p role="alert" className="text-red-700 text-sm">{error}</p>}
      <div className="flex gap-3"><button disabled={busy} className="bg-blue-700 hover:bg-blue-800 text-white rounded-lg px-4 py-2.5 text-sm disabled:opacity-50">{busy?'Saving…':'Save status'}</button><button disabled={busy} type="button" className="px-3 text-sm" onClick={close}>Cancel</button></div>
    </form></Dialog>}
    {allocation&&isAdmin&&<Dialog title="Assign drivers" onClose={close} wide><form onSubmit={saveAllocation} className="p-6 space-y-4">
      <p className="text-sm text-slate-700">{display(allocation.group.date)} · {allocation.group.time} · {routes[allocation.group.leg]} · {allocation.group.airport}{allocation.group.leg==='return'&&visibleHotel(allocation.group.hotel)&&' · '+visibleHotel(allocation.group.hotel)}</p>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{multiple?'Select one or more drivers':'Select one driver'}</legend>
        {!multiple&&<label className="flex items-center gap-2 rounded-lg border p-3 text-sm"><input type="radio" name="drivers" checked={!allocation.driverIds.length} onChange={()=>setAllocation(previous=>({...previous,driverIds:[]}))}/>Unassigned</label>}
        {drivers.map(driver=><label key={driver.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
          <input type={multiple?'checkbox':'radio'} name="drivers" checked={allocation.driverIds.includes(driver.id)}
            onChange={event=>{
              const {checked}=event.target;
              setAllocation(previous=>({...previous,driverIds:multiple?(checked?[...previous.driverIds,driver.id]:previous.driverIds.filter(id=>id!==driver.id)):[driver.id]}));
            }}/>
          <span><strong>{driver.name}</strong><span className="ml-2 text-xs text-slate-500">{driver.licensePlate} · {driver.contact}</span></span>
          <span className="ml-auto whitespace-nowrap text-xs font-medium text-blue-800">{seatLabel(driver.capacity)}</span>
        </label>)}
      </fieldset>
      <p role="status" className="text-sm text-slate-600">{personLabel(allocation.group.people)} · {seatLabel(selectedSeats)} selected
        {selectedSeats<allocation.group.people&&<span className="font-medium text-amber-800"> · {seatLabel(allocation.group.people-selectedSeats)} still needed</span>}
      </p>
      {error&&<p role="alert" className="text-red-700 text-sm">{error}</p>}
      <div className="flex gap-3"><button disabled={busy} className="bg-blue-700 hover:bg-blue-800 text-white rounded-lg px-4 py-2.5 text-sm disabled:opacity-50">{busy?'Saving…':'Save allocation'}</button><button disabled={busy} type="button" className="px-3 text-sm" onClick={close}>Cancel</button></div>
    </form></Dialog>}
  </div>;
}
