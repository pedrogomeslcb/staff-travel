import React from 'react';
import {Plane,BedDouble,Car,CalendarDays,UserRound,MessageSquare} from 'lucide-react';
import {parse,normalizeFlight} from '../lib/planner.mjs';
import {annualLimit} from '../lib/country-days.mjs';
import {tripReview} from '../lib/trip-review.mjs';

function formatDate(value){
  const day=parse(value);
  return day?new Date(day+'T12:00:00Z').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}):'Not provided';
}
const airport=value=>String(value||'').trim().toUpperCase();
const count=(n,unit)=>n+' '+unit+(n===1?'':'s');

function ReviewSection({icon:Icon,title,onEdit,busy,children}){
  return <section className="rounded-xl border bg-white p-4 space-y-3">
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 font-semibold text-slate-800"><Icon className="size-4 text-slate-500" aria-hidden="true"/>{title}</h3>
      {onEdit&&<button type="button" disabled={busy} onClick={onEdit} className="rounded-md border px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50" aria-label={'Edit '+title}>Edit</button>}
    </div>{children}
  </section>;
}
function Detail({label,value}){
  return <div className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium text-slate-800">{value||'Not provided'}</dd></div>;
}
function FlightCard({label,flight,origin,destination,date,time}){
  return <div className="rounded-lg bg-slate-50 p-3">
    <p className="text-xs font-medium text-slate-600">{label} · {normalizeFlight(flight)}</p>
    <p className="mt-1 text-lg font-semibold break-words text-slate-900">{airport(origin)} → {airport(destination)}</p>
    <p className="mt-1 text-sm text-slate-700">{formatDate(date)} · <strong className="tabular-nums">{time}</strong></p>
  </div>;
}
export default function TripReview({trip,trips,userId,personName,editing,busy,onEdit,joinedPickup}){
  const {days,nights,years}=tripReview(trip,trips,userId,editing);
  return <div className="space-y-4">
    <div><h3 id="trip-review-heading" tabIndex={-1} className="text-lg font-semibold outline-none">Review your trip</h3><p className="text-sm text-slate-600">Check the details below before submitting.</p></div>
    <section className="rounded-xl border border-blue-100 bg-blue-50 p-4">
      <p className="flex items-center gap-2 text-xs font-medium text-blue-800"><CalendarDays className="size-4" aria-hidden="true"/>Travel period</p>
      <p className="mt-2 text-lg font-semibold text-blue-950">{formatDate(trip.outDate)} – {formatDate(trip.returnDate)}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-blue-900"><span>{count(days,'day')} in country</span><span>{count(nights,'hotel night')}</span></div>
      <p className="mt-3 flex items-center gap-2 text-sm text-slate-700"><UserRound className="size-4" aria-hidden="true"/>{personName}</p>
    </section>
    <ReviewSection icon={Plane} title="Flights" onEdit={()=>onEdit('trip-flights-heading')} busy={busy}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FlightCard label="Arrival" flight={trip.outFlight} origin={trip.outOrigin} destination={trip.outDestination} date={trip.outDate} time={trip.outTime}/>
        <FlightCard label="Departure" flight={trip.returnFlight} origin={trip.returnOrigin} destination={trip.returnDestination} date={trip.returnDate} time={trip.returnTime}/>
      </div>
      <p className="text-xs text-slate-500">All times are local to the airport.</p>
    </ReviewSection>
    <ReviewSection icon={BedDouble} title="Hotel" onEdit={()=>onEdit('trip-hotel-heading')} busy={busy}>
      <dl className="grid grid-cols-2 gap-3 text-sm"><Detail label="Check-in" value={formatDate(trip.checkin)}/><Detail label="Check-out" value={formatDate(trip.checkout)}/><Detail label="IHG membership" value={trip.membership}/><Detail label="Traveler" value={personName}/></dl>
    </ReviewSection>
    <ReviewSection icon={Car} title="Transfers" onEdit={()=>onEdit('trip-transfers-heading')} busy={busy}>
      <div className="grid gap-2 divide-y">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">Airport Pick-Up</p><p className="text-xs text-slate-600">{formatDate(trip.outDate)} · {normalizeFlight(trip.outFlight)} · {airport(trip.outDestination)}</p></div><div className="text-right"><p className="text-xs text-slate-500">Flight arrival</p><p className="text-lg font-semibold tabular-nums">{trip.outTime}</p></div></div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3"><div><p className="text-sm font-medium">Hotel → Airport</p><p className="text-xs text-slate-600">{formatDate(trip.pickupDate)} · {airport(trip.returnOrigin)}</p>{joinedPickup&&<p className="mt-1 text-xs text-blue-700">Existing pickup selected · seat allocation pending</p>}</div><div className="text-right"><p className="text-xs text-slate-500">Hotel pickup</p><p className="text-lg font-semibold tabular-nums">{trip.pickupTime}</p></div></div>
      </div>
    </ReviewSection>
    <ReviewSection icon={MessageSquare} title="Comments" onEdit={()=>onEdit('trip-comments-heading')} busy={busy}><p className="whitespace-pre-wrap break-words text-sm text-slate-700">{trip.notes||'No comments'}</p></ReviewSection>
    {years.map(({year,otherDays,additionalDays,total,remaining})=><ReviewSection key={year} icon={CalendarDays} title={'Annual country allowance · '+year}>
      <dl className="grid grid-cols-3 gap-2"><div><dt className="text-xs text-slate-600">Other trips</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{otherDays}</dd></div><div><dt className="text-xs text-slate-600">This trip adds</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-blue-700">+{additionalDays}</dd></div><div><dt className="text-xs text-slate-600">{remaining<0?'Over limit':'Remaining'}</dt><dd className={'mt-1 text-xl font-semibold tabular-nums '+(remaining<0?'text-red-700':'')}>{Math.abs(remaining)}</dd></div></dl>
      <div role="img" aria-label={total+' of '+annualLimit+' days after this trip'} className="flex h-3 overflow-hidden rounded-full bg-slate-200"><div className="bg-emerald-700" style={{width:Math.min(100,otherDays/annualLimit*100)+'%'}}/><div className="bg-blue-600" style={{width:Math.max(0,Math.min(annualLimit-otherDays,additionalDays)/annualLimit*100)+'%'}}/></div>
      {total>=75&&<p role="status" className={'rounded-md p-2 text-sm '+(remaining<0?'bg-red-50 text-red-800':'bg-amber-50 text-amber-900')}>{remaining<0?'Annual allowance exceeded by '+Math.abs(remaining)+' days.':remaining===0?'Annual allowance reached.':total>=85?'Near the annual allowance.':'Monitor your remaining allowance.'}</p>}
    </ReviewSection>)}
    {editing!==null&&trip.confirmationNumber&&<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Changes to a confirmed request may require hotel reconfirmation. The confirmation number will be preserved.</p>}
    <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Submitting this trip saves your request. Hotel and transfer arrangements are not automatically confirmed.</p>
  </div>;
}
