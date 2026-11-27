import React,{useMemo,useState} from 'react';
import {display,iso,resolveScheduleDay,SCHEDULE_CATEGORIES} from '../lib/planner.mjs';
import {annualLimit,countryYearBreakdown} from '../lib/country-days.mjs';
import {buildTransferPlan} from '../lib/transfer-plan.mjs';

export function hotelStatus(t){
  if(t.canceledAt)return ['Canceled','bg-slate-100 text-slate-700'];
  if(t.archivedAt)return ['Archived','bg-slate-100 text-slate-700'];
  if(t.needsReview)return ['Reconfirmation required','bg-amber-50 text-amber-900'];
  if(t.confirmationNumber)return ['Confirmed','bg-emerald-50 text-emerald-800'];
  if(t.hotelRequested)return ['Requested from hotel','bg-blue-50 text-blue-800'];
  return ['Submitted · awaiting hotel request','bg-amber-50 text-amber-900'];
}
export function Status({value}){return <span className={'inline-block rounded-md px-2 py-1 text-xs font-medium '+value[1]}>{value[0]}</span>;}
const secondary='rounded-lg border px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50';
function legStatus(entry){
  if(!entry)return ['Details unavailable','bg-slate-100 text-slate-700'];
  if(entry.transfer.needsReview)return ['Review required','bg-amber-50 text-amber-900'];
  if(entry.transfer.status==='canceled')return ['Canceled','bg-slate-100 text-slate-700'];
  if(entry.transfer.status==='completed')return ['Completed','bg-slate-100 text-slate-700'];
  if(!entry.seated)return ['Awaiting driver','bg-amber-50 text-amber-900'];
  return [entry.transfer.status==='confirmed'?'Confirmed':'Driver assigned','bg-emerald-50 text-emerald-800'];
}
export default function Overview({user,people,trips,countryTrips,countryLimited,schedule,presence,transferTrips,allocations,drivers,passengersReady,ready,busy,onPlan,onEdit,onNavigate}){
  const today=iso(new Date()),year=Number(today.slice(0,4));
  const [history,setHistory]=useState(false);
  const [copied,setCopied]=useState('');
  const mine=trips.filter(t=>t.userId===user.id).sort((a,b)=>(a.outDate||a.checkin||'').localeCompare(b.outDate||b.checkin||''));
  const upcoming=mine.filter(t=>!t.canceledAt&&!t.archivedAt&&(t.returnDate||t.checkout||'')>=today);
  const past=mine.filter(t=>!upcoming.includes(t)).reverse();
  const total=countryYearBreakdown(countryTrips,user.id,year,today);
  const scheduleLabel=SCHEDULE_CATEGORIES.find(c=>c[0]===resolveScheduleDay(schedule,presence,user.id,today)?.status)?.[1]||'No entry';
  const onsite=people.filter(p=>!p.isPrimaryAdmin&&['onsite','onsite-half'].includes(resolveScheduleDay(schedule,presence,p.id,today)?.status));
  const groups=useMemo(()=>buildTransferPlan(transferTrips,{period:'all',allocations,drivers}).days.flatMap(d=>d.groups),[transferTrips,allocations,drivers]);
  const copy=async value=>{try{await navigator.clipboard.writeText(value);setCopied('Confirmation number copied.');}catch{setCopied('Could not copy. Select the confirmation number to copy manually.');}};
  const tripCard=t=><article key={t.id} className="rounded-xl border bg-white p-4 space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{t.outDestination||'Trip'} · {display(t.outDate||t.checkin)} – {display(t.returnDate||t.checkout)}</h3><p className="text-xs text-slate-600">Hotel: {display(t.checkin)} – {display(t.checkout)}</p></div><Status value={hotelStatus(t)}/></div>
    {!t.archivedAt&&!t.canceledAt&&<><p className="text-sm break-words">Flights: {t.outFlight} / {t.returnFlight}</p>
      {t.confirmationNumber&&<div className="flex flex-wrap items-center gap-2 text-sm"><span className="break-all">Confirmation: {t.confirmationNumber}</span><button type="button" className={secondary} onClick={()=>copy(t.confirmationNumber)}>Copy</button></div>}
      {['arrival','return'].map(leg=>{const group=groups.find(g=>g.entries.some(e=>e.trip.id===t.id&&e.leg===leg));const entry=group?.entries.find(e=>e.trip.id===t.id&&e.leg===leg);return <div key={leg} className="flex flex-wrap justify-between gap-2 border-t pt-2 text-sm"><div><p className="font-medium">{leg==='arrival'?'Airport to hotel':'Hotel to airport'}</p><p className="text-xs text-slate-600">{display(group?.date|| (leg==='arrival'?t.outDate:t.pickupDate))} · {group?.time||(leg==='arrival'?t.outTime:t.pickupTime)}</p></div><Status value={passengersReady?legStatus(entry):['Check Transfers','bg-slate-100 text-slate-700']}/></div>;})}
      <div className="flex flex-wrap gap-2"><button type="button" className={secondary} disabled={busy} onClick={()=>onEdit(t)}>Edit trip</button><button type="button" className={secondary} onClick={()=>onNavigate('transport')}>Transfer details</button><button type="button" className={secondary} onClick={()=>onNavigate('travel')}>Hotel details</button></div></>}
  </article>;
  return <div className="space-y-5">
    <section><h2 className="text-xl font-semibold">My overview</h2><p className="text-sm text-slate-600">Your schedule, trips and travel allowance in one place.</p></section>
    {ready&&<><div className="grid gap-3 md:grid-cols-3">
      <section className="rounded-xl border bg-white p-4 md:col-span-2"><h3 className="font-medium">Days in country · {year}</h3>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">{[['Completed',total.completed],['Planned',total.planned],['Remaining',Math.max(0,total.remaining)]].map(([name,value])=><div key={name}><p className="text-xs text-slate-600">{name}</p><p className="text-2xl font-semibold tabular-nums">{value}</p></div>)}</div>
        <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-200" role="img" aria-label={total.total+' of '+annualLimit+' days used or planned'}><div className="bg-emerald-700" style={{width:Math.min(100,total.completed/annualLimit*100)+'%'}}/><div className="bg-blue-600" style={{width:Math.max(0,Math.min(annualLimit-total.completed,total.planned)/annualLimit*100)+'%'}}/></div>
        <p className="mt-2 text-xs text-slate-600">{total.total} of {annualLimit} days used or planned. Includes arrival, departure and weekends; overlapping stays count once.</p>
        {total.total>=75&&<p role="status" className="mt-2 text-sm font-medium text-amber-900">{total.remaining<0?Math.abs(total.remaining)+' days over the allowance.':total.total>=90?'Annual allowance reached.':total.total>=85?'Near the annual allowance.':'Monitor your remaining allowance.'}</p>}
        {countryLimited&&<p className="mt-2 text-xs text-slate-600">Only your flight dates are available.</p>}
      </section>
      <section className="rounded-xl border bg-white p-4"><h3 className="font-medium">Today · {display(today)}</h3><p className="mt-2 text-lg font-semibold">{scheduleLabel}</p><p className="mt-2 text-sm text-slate-600">{onsite.length} team members onsite</p>{onsite.length>0&&<details className="mt-2 text-sm"><summary className="cursor-pointer text-blue-700">View names</summary><ul className="mt-2 space-y-1">{onsite.map(p=><li key={p.id}>{p.name}</li>)}</ul></details>}<button type="button" className={secondary+' mt-3'} onClick={()=>onNavigate('planner')}>Open schedule</button></section>
    </div><section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">My trips</h2><button type="button" disabled={busy} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm text-white disabled:opacity-50" onClick={onPlan}>Plan a trip</button></div>
      {upcoming.length?upcoming.map(tripCard):<div className="rounded-xl border bg-white p-6 text-center"><h3 className="font-medium">No upcoming trips</h3><p className="mt-1 text-sm text-slate-600">Add flights, hotel and airport transfers in one request.</p></div>}
      <button type="button" className={secondary} aria-expanded={history} onClick={()=>setHistory(v=>!v)}>{history?'Hide':'Show'} past and canceled trips ({past.length})</button>
      {history&&past.map(tripCard)}<p role="status" className="text-sm text-slate-600">{copied}</p>
    </section></>}
  </div>;
}
