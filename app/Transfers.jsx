'use client';

import {useId,useState} from 'react';
import {ChevronRight,X} from 'lucide-react';
import {display,iso} from '../lib/planner.mjs';
import {DRIVERS,TRANSFER_STATUSES} from '../lib/transfers.mjs';
import {buildTransferPlan} from '../lib/transfer-plan.mjs';
import Dialog from './Dialog';

const input='w-full border border-slate-300 rounded-lg p-2.5 bg-white text-sm text-slate-800';
const routes={arrival:'Airport → hotel',return:'Hotel → airport'};
const personLabel=n=>`${n} ${n===1?'person':'people'}`;
const seatLabel=n=>`${n} ${n===1?'seat':'seats'}`;
const weekday=date=>new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'long',timeZone:'UTC'});

function TransferSlot({group,isAdmin,busy,onEdit,onAllocate,onRemove}) {
  const [expanded,setExpanded]=useState(false),passengersId=useId();
  const arrival=group.leg==='arrival',route=routes[group.leg];
  const flight=group.flights.length===1?`Flight ${group.flights[0]}`:group.flights.length>1?`${group.flights.length} flights`:'Flight to confirm';
  const canAssign=isAdmin&&group.people>0&&group.assignable;
  return <article aria-label={`${group.time||'Time to confirm'} · ${route}`}>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
      <h4 className="min-w-48 flex-1">
        <button type="button" aria-expanded={expanded} aria-controls={passengersId} onClick={()=>setExpanded(value=>!value)}
          className="flex w-full items-center gap-2 rounded-md py-1 text-left hover:bg-slate-50">
          <ChevronRight aria-hidden="true" className={'size-4 shrink-0 text-slate-500 '+(expanded?'rotate-90':'')}/>
          <span title={group.time?undefined:'Time to confirm'}
            className="min-w-12 text-base font-semibold tabular-nums text-slate-900">{group.time||'TBD'}</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-800">{route}</span>
            <span className="block text-xs text-slate-600">
              {flight}{group.airport&&' · '+group.airport}{!arrival&&group.hotel&&' · '+group.hotel}
            </span>
          </span>
        </button>
      </h4>
      <div className="text-xs">
        <p className="whitespace-nowrap font-medium text-slate-700">{personLabel(group.people||group.totalPeople)}</p>
        {group.unseated>0?<p className="text-amber-800">{seatLabel(group.unseated)} needed</p>
          :group.attention>0?<p className="text-amber-800">{group.attention} {group.attention===1?'needs':'need'} attention</p>
          :!group.people&&<p className="text-slate-500">Completed or canceled</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Drivers">
        {group.drivers.length>0?<ul aria-label="Allocated drivers" className="flex flex-wrap gap-2.5">
          {group.drivers.map(driver=><li key={driver.id} className="group relative rounded-lg border bg-stone-50 px-2.5 py-1.5 text-slate-600"
            title={`${driver.name} · ${driver.licensePlate} · ${driver.contact}`}>
            <p><strong className="text-slate-900">{driver.name}</strong> · {driver.licensePlate}</p>
            <p>{driver.contact} · {group.people?`${driver.passengers.length}/${driver.capacity} seats`:seatLabel(driver.capacity)}</p>
            {expanded&&group.drivers.length>1&&driver.passengers.length>0&&<p className="mt-1 max-w-48 break-words text-slate-700">{driver.passengers.join(', ')}</p>}
            {canAssign&&<button type="button" disabled={busy}
              aria-label={'Remove '+driver.name+' from this transfer'} title={'Remove '+driver.name}
              className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border bg-white text-slate-500 opacity-0 hover:text-red-700 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 disabled:opacity-40"
              onClick={()=>onRemove(group,driver.id)}><X aria-hidden="true" className="size-3"/></button>}
          </li>)}
        </ul>:group.people>0&&<span className="text-slate-500">Unassigned</span>}
      </div>
      {canAssign&&<button type="button" disabled={busy}
        className="shrink-0 rounded-md px-2 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
        onClick={()=>onAllocate(group)}>Assign drivers</button>}
      {isAdmin&&group.people>0&&!group.assignable&&<p className="text-xs text-slate-500">Confirm trip details to assign drivers.</p>}
    </div>
    <div id={passengersId} hidden={!expanded}>
      {expanded&&<>
        <ul aria-label="Passengers" className="divide-y border-t">
          {group.entries.map(entry=>{
            const {transfer}=entry;
            const statusKey=['to_arrange','assigned'].includes(transfer.status)?(entry.seated?'assigned':'to_arrange'):transfer.status;
            const status=TRANSFER_STATUSES.find(value=>value[0]===statusKey)||TRANSFER_STATUSES[0];
            return <li key={entry.key} className={'flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 '+(transfer.status==='canceled'?'opacity-60':'')}>
              <div className="min-w-28 flex-1">
                <p className="break-words text-sm font-semibold text-slate-800">{entry.trip.person}</p>
                <p className="text-xs text-slate-500"><span className="font-medium text-slate-700">{entry.flight||'Flight to confirm'}</span>{arrival&&entry.hotel&&' · '+entry.hotel}</p>
              </div>
              <div>
                <span className={'inline-block rounded-full px-2 py-1 text-xs '+(transfer.needsReview?'bg-amber-50 text-amber-800':status[2])}>{transfer.needsReview?'Review required':status[1]}</span>
                {transfer.needsReview&&<span className="block text-[11px] text-slate-500">Previously: {TRANSFER_STATUSES.find(value=>value[0]===transfer.status)?.[1]||status[1]}</span>}
              </div>
              {isAdmin&&<button type="button" disabled={busy} className="rounded-md px-2 py-1.5 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                aria-label={'Edit status: '+entry.trip.person+' · '+route} onClick={()=>onEdit(entry)}>Edit status</button>}
            </li>;
          })}
        </ul>
      </>}
    </div>
  </article>;
}

export default function Transfers({trips,allocations,drivers=DRIVERS,user,busy,onSave,onAllocate}) {
  const [editing,setEditing]=useState(null),[allocation,setAllocation]=useState(null),[error,setError]=useState('');
  const [direction,setDirection]=useState('all'),[period,setPeriod]=useState('upcoming'),[includeCanceled,setIncludeCanceled]=useState(false);
  const [expandedDays,setExpandedDays]=useState({}),dayIdPrefix=useId();
  const today=iso(new Date()),plan=buildTransferPlan(trips,{direction,period,today,includeCanceled,allocations,drivers});
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
    <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="Transfer plan overview">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-slate-900">Transfer plan</h2>
        <p className="text-xs text-slate-600">
          {plan.days.length} {plan.days.length===1?'day':'days'} · {personLabel(plan.people)} to transport
          {plan.attention>0&&<span className="text-amber-800"> · {plan.attention} {plan.attention===1?'transfer needs':'transfers need'} attention</span>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md bg-slate-100 p-0.5" aria-label="Date range">
          {[['upcoming','Upcoming'],['all','All dates']].map(([value,label])=><button key={value} aria-pressed={period===value} className={'rounded px-2.5 py-1.5 text-xs font-medium '+(period===value?'bg-white text-blue-800 shadow-sm':'text-slate-600')} onClick={()=>setPeriod(value)}>{label}</button>)}
        </div>
        <select aria-label="Transfer direction" className="rounded-md border bg-white px-2 py-1.5 text-xs text-slate-700" value={direction} onChange={event=>setDirection(event.target.value)}>
          <option value="all">All transfers</option><option value="arrival">Arrivals</option><option value="return">Hotel pickups</option>
        </select>
        <label className="flex items-center gap-1.5 px-1 text-xs text-slate-600"><input type="checkbox" checked={includeCanceled} onChange={e=>setIncludeCanceled(e.target.checked)}/>Include canceled</label>
      </div>
      <p className="text-xs text-slate-500">Local times. Arrivals follow the flight and returns use the scheduled hotel pickup time.</p>
    </section>
    {error&&!editing&&!allocation&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!plan.days.length&&<div className="bg-white border rounded-xl p-10 text-center"><p className="font-medium text-slate-700">{trips.length?'No transfers match these filters.':'No transfers yet.'}</p><p className="text-sm text-slate-500 mt-2">{trips.length?'Try All dates or another transfer direction.':'Create a hotel request to add arrival and return transfers.'}</p>{trips.length>0&&<button className="text-sm text-blue-700 mt-4" onClick={()=>{setPeriod('all');setDirection('all');setIncludeCanceled(true);}}>Show all transfers</button>}</div>}
    <div className="space-y-3" aria-label="Transfers by day">
      {plan.days.map((day,index)=>{
        const expanded=expandedDays[day.date]??(index===0),slotsId=dayIdPrefix+'-'+(day.date||'undated');
        const counts=[
          day.arrivals>0&&`${day.arrivals} arriving`,
          day.pickups>0&&`${day.pickups} returning`,
        ].filter(Boolean);
        return <section key={day.date||'undated'} className="rounded-lg border bg-white" aria-label={day.date?`Transfers on ${display(day.date)}`:'Transfers with date to confirm'}>
          <h3>
            <button type="button" aria-expanded={expanded} aria-controls={slotsId}
              className={'flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-slate-50 px-3 py-2.5 text-left hover:bg-slate-100 '+(expanded?'rounded-t-lg':'rounded-lg')}
              onClick={()=>setExpandedDays(previous=>({...previous,[day.date]:!expanded}))}>
              <span className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <ChevronRight aria-hidden="true" className={'size-4 shrink-0 '+(expanded?'rotate-90':'')}/>
                <span className="font-semibold text-slate-900">{day.date?<time dateTime={day.date}>{display(day.date)}</time>:'Date to confirm'}</span>
                {day.date&&<span>{weekday(day.date)}</span>}
                {day.date===today&&<span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">Today</span>}
              </span>
              <span className="text-xs font-medium text-slate-600">{counts.join(' · ')||'No pending transfers'}</span>
            </button>
          </h3>
          <div id={slotsId} hidden={!expanded} className="divide-y border-t">
            {day.groups.map(group=><TransferSlot key={group.key} group={group} isAdmin={isAdmin} busy={busy} onEdit={open} onAllocate={openAllocation} onRemove={removeDriver}/>)}
          </div>
        </section>;
      })}
    </div>
    {editing&&isAdmin&&<Dialog title="Edit transfer status" onClose={close} wide><form onSubmit={save} className="p-6 space-y-5">
      <div className="text-sm text-slate-600"><p><strong>{editing.trip.person}</strong> · {routes[editing.leg]}</p><p className="text-xs mt-2">{editing.date?display(editing.date):'Date to confirm'} · {editing.time||'Time to confirm'} · {editing.flight||'Flight to confirm'}</p></div>
      {editing.transfer.needsReview&&<p className="bg-amber-50 rounded-lg p-3 text-sm text-amber-900">Travel or pickup details changed. Review this passenger’s transfer before saving.</p>}
      <label className="block text-xs text-slate-600">Transfer status<select className={input+' mt-1'} value={editing.status} onChange={e=>setEditing(p=>({...p,status:e.target.value}))}>{TRANSFER_STATUSES.map(([value,label])=><option key={value} value={value}>{value==='to_arrange'?'Automatic (based on driver allocation)':label}</option>)}</select></label>
      {error&&<p role="alert" className="text-red-700 text-sm">{error}</p>}
      <div className="flex gap-3"><button disabled={busy} className="bg-blue-700 hover:bg-blue-800 text-white rounded-lg px-4 py-2.5 text-sm disabled:opacity-50">{busy?'Saving…':'Save status'}</button><button disabled={busy} type="button" className="px-3 text-sm" onClick={close}>Cancel</button></div>
    </form></Dialog>}
    {allocation&&isAdmin&&<Dialog title="Assign drivers" onClose={close} wide><form onSubmit={saveAllocation} className="p-6 space-y-4">
      <p className="text-sm text-slate-700">{display(allocation.group.date)} · {allocation.group.time} · {routes[allocation.group.leg]} · {allocation.group.airport}{allocation.group.leg==='return'&&' · '+allocation.group.hotel}</p>
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
