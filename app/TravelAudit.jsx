'use client';

import {useEffect,useState} from 'react';
import {SCHEDULE_CATEGORIES,display} from '../lib/planner.mjs';

const labels={
  hotel_created:'Hotel request created',hotel_edited:'Hotel request edited',
  hotel_requested:'Marked requested from hotel',hotel_unrequested:'Requested flag cleared',
  hotel_confirmed:'Hotel confirmation saved',hotel_canceled:'Hotel cancellation requested',
  hotel_notified:'Hotel notification recorded',onsite_removed:'Onsite days removed',schedule_changed:'Schedule updated',
};
const statusLabels=new Map(SCHEDULE_CATEGORIES.map(([id,label])=>[id,label]));
const status=value=>statusLabels.get(value)||'No entry';
const dateTime=new Intl.DateTimeFormat('en-GB',{dateStyle:'short',timeStyle:'medium',hourCycle:'h23'});
const stamp=value=>dateTime.format(new Date(value));
const fieldValue=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)?display(value):value||'Empty';

export default function TravelAudit({repo,user,trips,shared}) {
  const [events,setEvents]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const [personId,setPersonId]=useState(''),[limit,setLimit]=useState(30),[reload,setReload]=useState(0);
  useEffect(()=>{
    let active=true;
    setLoading(true);setError('');
    Promise.resolve().then(()=>repo.audit(user)).then(
      records=>{if(active)setEvents(records);},
      failure=>{if(active)setError(failure.message);},
    ).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[repo,user.id,user.authVersion,reload]);
  const people=new Map(),bookings=new Map(trips.map(trip=>[trip.id,trip]));
  for(const event of events) {
    if(!people.has(event.personId))people.set(event.personId,event.personName);
    if(!people.has(event.actorId))people.set(event.actorId,event.actorName);
  }
  const filtered=events.filter(event=>!personId||event.personId===personId||event.actorId===personId);
  return <section className="space-y-4 rounded-xl border bg-white p-5">
    <div className="flex flex-wrap justify-between gap-3">
      <div><h2 className="font-semibold text-slate-900">Travel audit log</h2>
        <p className="mt-1 text-xs text-slate-600">Schedule and hotel activity · Times shown in your browser’s time zone{shared?'':' · This browser only'}</p>
      </div>
      <button type="button" disabled={loading} className="self-start rounded-lg border px-3 py-2 text-sm text-blue-700" onClick={()=>setReload(value=>value+1)}>Refresh</button>
    </div>
    <label className="block max-w-xs text-xs text-slate-600">Person involved
      <select className="mt-1 w-full rounded-lg border bg-white px-2.5 py-2 text-sm text-slate-800" value={personId}
        onChange={event=>{setPersonId(event.target.value);setLimit(30);}}>
        <option value="">Everyone</option>
        {[...people].sort((a,b)=>a[1].localeCompare(b[1])).map(([id,name])=><option key={id} value={id}>{name}</option>)}
      </select>
    </label>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {loading&&<p role="status" className="text-sm text-slate-600">Loading activity…</p>}
    {!loading&&!error&&!filtered.length&&<p className="text-sm text-slate-600">No activity matches this view.</p>}
    <ol className="divide-y border-y">
      {filtered.slice(0,limit).map(event=><li key={event.id} className="space-y-2 py-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="font-semibold text-slate-900">{labels[event.kind]}</h3>
          <time className="text-xs text-slate-600" dateTime={event.at}>{stamp(event.at)}</time>
        </div>
        <p className="text-xs text-slate-600">By <strong>{event.actorName}</strong> · Team member <strong>{event.personName}</strong></p>
        {event.trip&&<p className="text-slate-700">{event.trip.hotel} · {display(event.trip.checkin)}–{display(event.trip.checkout)} · {event.trip.project}</p>}
        {event.kind==='hotel_canceled'&&<p className="text-xs text-slate-600">{event.hotelNotificationRequired?'Hotel notification required at cancellation.':'Canceled before hotel arrangements.'}</p>}
        {event.hotels?.map(hotel=>{
          const booking=bookings.get(hotel.id);
          return <p key={hotel.id} className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            {hotel.hotel} · {hotel.status} at schedule change · {booking?.canceledAt?'Cancellation recorded '+stamp(booking.canceledAt):'Hotel request still active'}
            {booking?.hotelCancellationNotifiedAt&&' · Hotel notified '+stamp(booking.hotelCancellationNotifiedAt)}
          </p>;
        })}
        {(event.days?.length>0||event.changes?.length>0)&&<details>
          <summary className="cursor-pointer text-xs font-medium text-blue-700">Change details{event.days&&` · ${event.days.length} ${event.days.length===1?'day':'days'}`}</summary>
          <ul className="mt-1 space-y-1 pl-4 text-xs text-slate-700">
            {event.days?.map(day=><li key={day.date}>{display(day.date)} · {status(day.before)} → {status(day.after)}
              {day.before===day.after&&<span> · Manual entry {day.manualBefore||'default'} → {day.manualAfter||'default'}</span>}</li>)}
            {event.changes?.map(change=><li key={change.label}>{change.label}{change.before===undefined?' updated':' · '+fieldValue(change.before)+' → '+fieldValue(change.after)}</li>)}
          </ul>
        </details>}
      </li>)}
    </ol>
    {filtered.length>limit&&<button type="button" className="rounded-lg border px-3 py-2 text-sm text-blue-700" onClick={()=>setLimit(value=>value+30)}>Show more</button>}
  </section>;
}
