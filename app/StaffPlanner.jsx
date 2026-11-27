'use client';

import React, {useState, useEffect, useMemo, useRef, useId} from 'react';
import {blank, pad, iso, parse, display, maskDate, nightsBetween, toDraft, changeTrip, updateScheduleEntries, SCHEDULE_CATEGORIES, canManageRequest, hotelNeedsCancellation} from '../lib/planner.mjs';
import {HotelReminderError} from '../lib/travel-audit.mjs';
import {scheduleWeekdays} from '../lib/schedule-edit.mjs';
import {localRepository, remoteRepository, KEYS} from '../lib/repository.mjs';
import {databaseClient} from '../lib/database-client.mjs';
import {supabaseDatabaseClient} from '../lib/supabase-database.mjs';
import {supabaseWorkspace} from '../lib/supabase-workspace.mjs';
import SupabaseUsersAccess from './SupabaseUsersAccess';
import Schedule from './Schedule';
import Overview,{hotelStatus,Status} from './Overview';
import {countryYearBreakdown,annualLimit} from '../lib/country-days.mjs';
import Dialog from './Dialog';
import TripArchive from './TripArchive';
import Transfers from './Transfers';
import {DRIVERS} from '../lib/transfers.mjs';
import UsersAccess from './UsersAccess';
import TravelAudit from './TravelAudit';
import Database from './Database';

const input='w-full border border-slate-300 rounded-lg p-2.5 bg-white text-sm text-slate-800';
const button='bg-blue-700 text-white rounded-lg px-4 py-2.5 text-sm hover:bg-blue-800 disabled:opacity-50';
const categories=SCHEDULE_CATEGORIES;
const hotelFilters=[
  ['active','Active'],['archived','Archived'],['requested','Requested'],['confirmed','Confirmed'],['unrequested','Awaiting request'],
  ['canceled','Canceled'],['notify','Hotel notification pending'],['all','All requests'],
];

function CanceledHotelCard({trip,busy,onNotify}) {
  const notified=trip.hotelCancellationNotifiedAt;
  return <article className="space-y-3 rounded-2xl border bg-slate-50 p-5 text-sm text-slate-600">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="line-through">
        <h2 className="text-base font-semibold">{trip.person}</h2>
        <p>{[visibleHotel(trip.hotel),visibleProject(trip.project),display(trip.checkin)+'–'+display(trip.checkout)].filter(Boolean).join(' · ')}</p>
        {trip.confirmationNumber&&<p>Confirmation number {trip.confirmationNumber}</p>}
      </div>
      <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700">Canceled</span>
    </div>
    <p className="text-xs">Canceled by {trip.canceledBy} on {display(trip.canceledAt)}</p>
    <details>
      <summary className="cursor-pointer text-xs font-medium text-slate-700">Trip details</summary>
      <div className="mt-2 space-y-1 text-xs line-through">
        <p>Arrival · {trip.outFlight} · {trip.outOrigin} → {trip.outDestination} · {display(trip.outDate)} {trip.outTime}</p>
        <p>Return · {trip.returnFlight} · {trip.returnOrigin} → {trip.returnDestination} · {display(trip.returnDate)} {trip.returnTime}</p>
        {trip.membership&&<p>Hotel loyalty number {trip.membership}</p>}
        {trip.notes&&<p className="whitespace-pre-wrap break-words">{trip.notes}</p>}
      </div>
    </details>
    {notified?<p className="text-xs">Hotel notified by {trip.hotelCancellationNotifiedBy} on {display(notified)}</p>
      :trip.hotelCancellationRequired&&<div className="flex flex-wrap items-center gap-3">
        <p className="font-medium text-amber-800">Hotel notification pending</p>
        <button type="button" disabled={busy} onClick={()=>onNotify(trip)} className="rounded-lg border bg-white px-3 py-2 text-blue-700">Mark hotel notified</button>
      </div>}
  </article>;
}

function DateField({label,value,onChange}) {
  const [open,setOpen]=useState(false),[month,setMonth]=useState(new Date()),id=useId(),ref=useRef(null);
  const count=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  useEffect(()=>{
    if (!open) return;
    const close=e=>{if (!ref.current?.contains(e.target)) setOpen(false);};
    const escape=e=>{if (e.key==='Escape') {e.preventDefault();e.stopPropagation();setOpen(false);}};
    document.addEventListener('pointerdown',close);ref.current?.addEventListener('keydown',escape);
    const element=ref.current;
    return ()=>{document.removeEventListener('pointerdown',close);element?.removeEventListener('keydown',escape);};
  },[open]);
  return <div ref={ref} className="relative min-w-0"><label htmlFor={id} className="block text-xs text-slate-600 mb-1">{label}</label><div className="flex gap-1"><input id={id} required className={input+' min-w-0'} placeholder="DD/MM/YYYY" inputMode="numeric" maxLength={10} value={value} onChange={e=>onChange(maskDate(e.target.value))}/><button type="button" aria-label={'Calendar: '+label} aria-expanded={open} className="border rounded-lg px-3" onClick={()=>{const p=parse(value);if(p)setMonth(new Date(p+'T12:00:00'));setOpen(!open);}}>▦</button></div>{open&&<div className="absolute top-full mt-1 bg-white border rounded-xl p-3 shadow-xl w-64 max-w-[80vw] z-50"><div className="flex justify-between mb-3 items-center"><button type="button" aria-label={'Previous month: '+label} onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}>‹</button><span className="text-sm">{month.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</span><button type="button" aria-label={'Next month: '+label} onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}>›</button></div><div className="grid grid-cols-7 gap-1 text-center text-xs">{['Su','Mo','Tu','We','Th','Fr','Sa'].map(x=><span key={x}>{x}</span>)}{Array.from({length:new Date(month.getFullYear(),month.getMonth(),1).getDay()},(_,i)=><span key={'b'+i}/>)}{Array.from({length:count},(_,i)=>{const d=iso(new Date(month.getFullYear(),month.getMonth(),i+1));return <button type="button" aria-label={label+': '+display(d)} aria-pressed={parse(value)===d} key={d} className={'p-2 rounded hover:bg-blue-100 '+(parse(value)===d?'bg-blue-700 text-white':'')} onClick={()=>{onChange(display(d));setOpen(false);}}>{i+1}</button>;})}</div><button type="button" className="text-xs mt-3" onClick={()=>setOpen(false)}>Close calendar</button></div>}</div>;
}
function TimeField({label,value,onChange}) {
  const [h='',m='']=(value||'').split(':');
  return <fieldset className="min-w-0"><legend className="text-xs text-slate-600 mb-1">{label}</legend><div className="flex items-center gap-2"><select required aria-label={label+' hours'} className={input} value={h} onChange={e=>onChange(e.target.value+':'+m)}><option value="">HH</option>{Array.from({length:24},(_,i)=><option key={i}>{pad(i)}</option>)}</select>:<select required aria-label={label+' minutes'} className={input} value={m} onChange={e=>onChange(h+':'+e.target.value)}><option value="">MM</option>{Array.from({length:60},(_,i)=><option key={i}>{pad(i)}</option>)}</select></div></fieldset>;
}

/** @param {{mode?: string, initialUser?: {id: string, name: string, role: string, authVersion?: number, tagId?: string|null}|null, loginName?: string, staticDemo?: boolean}} props */
const hiddenLegacyProject='LAM'+'BANCA';
const hiddenLegacyHotel='InterContinental '+'Luanda Miramar';
const visibleProject=value=>value===hiddenLegacyProject||value==='Unspecified'?'':value;
const visibleHotel=value=>value===hiddenLegacyHotel||value==='Not specified'?'':value;

export default function StaffPlanner({mode='demo',initialUser=null,loginName='',staticDemo=false,supabaseClient=null,onSupabaseSignOut=null}) {
  const shared=mode==='shared';
  const connected=mode==='supabase'&&!!supabaseClient;
  const repo=useMemo(()=>{
    if(shared)return remoteRepository();
    const storage={getItem:k=>window.localStorage.getItem(connected?('staff_travel_user_'+initialUser.id+'_'+k):k),setItem:(k,v)=>window.localStorage.setItem(connected?('staff_travel_user_'+initialUser.id+'_'+k):k,v)};
    return connected?supabaseWorkspace(supabaseClient,initialUser,storage):localRepository(storage);
  },[shared,connected,supabaseClient,initialUser?.id,initialUser?.role,initialUser?.name]);
  const database=useMemo(()=>connected?supabaseDatabaseClient(supabaseClient):(staticDemo?null:databaseClient()),[connected,supabaseClient,staticDemo]);
  const [name,setName]=useState(loginName),[password,setPassword]=useState(''),[user,setUser]=useState(initialUser);
  const [people,setPeople]=useState([]),[trips,setTrips]=useState([]),[schedule,setSchedule]=useState({});
  const [sharedScheduleReady,setSharedScheduleReady]=useState(!connected);
  const [tab,setTab]=useState('overview'),[modal,setModal]=useState(false),[editing,setEditing]=useState(null),[trip,setTrip]=useState({...blank});
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[drafts,setDrafts]=useState({}),[busy,setBusy]=useState(false),[ready,setReady]=useState(false);
  const [month,setMonth]=useState(()=>new Date()),[scheduleEdit,setScheduleEdit]=useState(null);
  const [hotelName,setHotelName]=useState('');
  const [tripStep,setTripStep]=useState(0);
  const [showHelp,setShowHelp]=useState(()=>{try{return !localStorage.getItem('staff-help-seen-'+initialUser?.id);}catch{return true;}});
  const [profileMembership,setProfileMembership]=useState(null);
  const [userTravelFilter,setUserTravelFilter]=useState('upcoming');
  const [requestUserId,setRequestUserId]=useState(initialUser?.id||'');
  const [scheduleWarning,setScheduleWarning]=useState(null),[hotelFilter,setHotelFilter]=useState('active');
  const [removing,setRemoving]=useState(null),[acknowledgeHotel,setAcknowledgeHotel]=useState(false);
  const saving=useRef(false),userRef=useRef(initialUser),scheduleHistory=useRef([]),requestUserIdRef=useRef(initialUser?.id||'');
  userRef.current=user;
  const [tags,setTags]=useState([]),[users,setUsers]=useState([]),[presence,setPresence]=useState([]),[transferTrips,setTransferTrips]=useState([]);
  const [transferAllocations,setTransferAllocations]=useState({});
  const [transferPassengersReady,setTransferPassengersReady]=useState(!connected);
  const [countryTrips,setCountryTrips]=useState([]),[countryLimited,setCountryLimited]=useState(false);
  const [references,setReferences]=useState(null);
  const [pickupOptions,setPickupOptions]=useState([]),[pickupOptionsError,setPickupOptionsError]=useState('');
  const [pickupOptionsLoading,setPickupOptionsLoading]=useState(false),[pickupLookupDone,setPickupLookupDone]=useState(false),[joinedPickupTime,setJoinedPickupTime]=useState('');
  function applySnapshot(snapshot) {
    if(userRef.current?.id!==snapshot.currentUser?.id) scheduleHistory.current=[];
    setCountryTrips(snapshot.countryTrips??snapshot.presence??snapshot.trips);setCountryLimited(!!snapshot.countryLimited);
    setPeople(snapshot.people);setTrips(snapshot.trips);setSchedule(snapshot.schedule);setTags(snapshot.tags||[]);setUsers(snapshot.users||[]);setPresence(snapshot.presence||[]);setTransferTrips(snapshot.transferTrips||[]);
    if(connected)setSharedScheduleReady(snapshot.sharedScheduleReady===true);
    setTransferAllocations(snapshot.transferAllocations||{});
    setTransferPassengersReady(!connected||snapshot.transferPassengersReady===true);
    const verified=connected?initialUser:snapshot.currentUser;
    userRef.current=verified;setUser(verified);
    if(verified?.role!=='admin')setTab(previous=>['access','audit'].includes(previous)?'planner':previous);
  }
  function clearSession() {
    scheduleHistory.current=[];
    setTransferAllocations({});setTransferPassengersReady(!connected);
    setScheduleWarning(null);setHotelFilter('active');setHotelName('');setRequestUserId('');requestUserIdRef.current='';setSharedScheduleReady(!connected);
    userRef.current=null;setUser(null);setTrips([]);setPeople([]);setSchedule({});setTags([]);setUsers([]);setPresence([]);setTransferTrips([]);setDrafts({});setModal(false);setScheduleEdit(null);setRemoving(null);setTab('planner');
  }
  async function refresh(actor=userRef.current) {const snapshot=await repo.snapshot(actor);applySnapshot(snapshot);}
  function accessError(e) {if(e.status===401||e.status===403)clearSession();setError(e.message);}
  async function refreshSaved() {try{await refresh();}catch(e){if(e.status===401||e.status===403)accessError(e);else setError('Your changes were saved, but the workspace could not refresh. Reload to see the latest data.');}}
  useEffect(()=>{
    let active=true;
    async function load() {try{await repo.initialize();if(!active)return;if(userRef.current)await refresh();if(active)setReady(true);}catch(e){if(active){accessError(e);setReady(e.status===401||e.status===403);}}}
    load();
    const sync=e=>{if(!e.key||Object.values(KEYS).includes(e.key))load();};
    const focus=()=>{if(userRef.current)load();};
    window.addEventListener('storage',sync);window.addEventListener('focus',focus);
    return ()=>{active=false;window.removeEventListener('storage',sync);window.removeEventListener('focus',focus);};
  },[repo,shared]);
  useEffect(()=>{
    if(!user?.id||!database)return;
    let active=true;
    database.references().then(data=>{if(active)setReferences(data);}).catch(()=>{});
    return ()=>{active=false;};
  },[database,user?.id]);
  useEffect(()=>{
    if(!connected||!modal)return;
    const date=parse(trip.pickupDate),airport=trip.returnOrigin.trim().toUpperCase();
    setJoinedPickupTime('');
    if(!date||!airport){
      setPickupOptions([]);setPickupOptionsError('');setPickupOptionsLoading(false);setPickupLookupDone(false);return;
    }
    let active=true;
    setPickupOptions([]);setPickupOptionsLoading(true);setPickupOptionsError('');setPickupLookupDone(false);
    repo.pickupOptions({date,airport}).then(options=>{
      if(active){setPickupOptions(options);setPickupLookupDone(true);}
    }).catch(error=>{
      if(active){setPickupOptions([]);setPickupOptionsError(error.message||'Unable to check existing pickups.');}
    }).finally(()=>{if(active)setPickupOptionsLoading(false);});
    return ()=>{active=false;};
  },[connected,modal,trip.pickupDate,trip.returnOrigin,repo]);

  async function login(e) {
    e.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setError('');
    try {const person=await repo.login(name,password);userRef.current=person;await refresh(person);setMonth(new Date());setTab('planner');setMessage('');}
    catch(e){clearSession();setError(e.message);}
    finally{setPassword('');saving.current=false;setBusy(false);}
  }
  async function logout() {if(connected&&onSupabaseSignOut){await onSupabaseSignOut();return;}try{await repo.logout();const nextName=shared?userRef.current?.name||loginName:'';clearSession();setName(nextName);setPassword('');setError('');setMessage('');}catch(e){setError('Could not sign out. Please try again.');}}
  async function accessAction(action,payload) {
    if(saving.current)throw new Error('Another change is being saved. Please try again.');saving.current=true;setBusy(true);setError('');
    try {
      if(action==='createUser')await repo.createUser(userRef.current,payload.draft);
      if(action==='updateUser')await repo.updateUser(userRef.current,payload.id,payload.draft);
      if(action==='resetPassword')await repo.resetPassword(userRef.current,payload.id,payload.password,payload.revision);
      if(action==='deleteUser')await repo.deleteUser(userRef.current,payload.id,payload.revision);
      if(action==='saveTag')await repo.saveTag(userRef.current,payload.draft);
      await refreshSaved();setMessage('Access settings saved.');
    }finally{saving.current=false;setBusy(false);}
  }
  async function exportExcel(){
    if(user?.role!=='admin')return;
    await mutate(async()=>{
      const snapshot=await repo.snapshot(user);
      if(snapshot.currentUser?.role!=='admin')throw new Error('Administrator access required.');
      const [db,events,module]=await Promise.all([
        database?database.read():null,
        repo.audit(user,{all:true}),
        import('../lib/export-workbook.mjs'),
      ]);
      await module.downloadWorkbook(snapshot,{database:db,events,year:month.getFullYear(),drivers:references?.drivers});
    });
  }
  function change(key,value) {setTrip(p=>changeTrip(p,key,value,references?.flights));}
  function selectRequestUser(nextId) {
    requestUserIdRef.current=nextId;
    setRequestUserId(nextId);
    setError('');
    setTrip(previous=>({...previous,membership:nextId===user.id?(references?.membership||''):''}));
    if(connected&&nextId!==user.id) {
      supabaseClient.from('staff_ihg_memberships').select('membership').eq('user_id',nextId).maybeSingle()
        .then(({data,error})=>{
          if(error)throw error;
          if(requestUserIdRef.current===nextId)
            setTrip(previous=>previous.membership?previous:{...previous,membership:data?.membership||''});
        })
        .catch(()=>{if(requestUserIdRef.current===nextId)setError('Could not retrieve the selected team member’s loyalty number. You can enter it manually.');});
    }
  }
  function open(record) {
    const ownerId=record?.userId??user.id;
    requestUserIdRef.current=ownerId;setRequestUserId(ownerId);
    setEditing(record?.id??null);setTripStep(0);setJoinedPickupTime('');setPickupOptions([]);setPickupOptionsError('');setPickupLookupDone(false);
    setTrip({...toDraft(record),...(!record?{project:'Unspecified',hotel:'Not specified'}:{}),...(!record&&connected?{membership:references?.membership||''}:{})});
    setError('');setModal(true);
    if(connected&&!record)database.references().then(data=>{
      setReferences(data);
      if(requestUserIdRef.current===user.id)setTrip(previous=>({...previous,membership:previous.membership||data.membership||''}));
    }).catch(error=>setError('Could not load IHG membership: '+error.message));
  }
  async function mutate(action) {if (saving.current) return;saving.current=true;setBusy(true);setError('');try {await action();}catch(e){accessError(e);}finally {saving.current=false;setBusy(false);}}
  function acceptRecord(record) {setTrips(previous=>previous.some(t=>t.id===record.id)?previous.map(t=>t.id===record.id?record:t):[record,...previous]);}
  async function save(e) {
    e.preventDefault();await mutate(async()=>{
      const result=await repo.save(user,trip,editing,requestUserId);acceptRecord(result.record);setModal(false);
      if(connected&&result.record.membership) {
        try {setReferences(await database.references());} catch { /* The request was already saved. */ }
      }
      if(!shared&&!connected&&result.record.membership)void database?.capture([result.record]).catch(()=>{});
      setMessage(!result.changed?'No changes to save.':editing!==null?'Trip updated.':'Trip submitted. Hotel and transfer arrangements are not yet confirmed.');await refreshSaved();
    });
  }
  function nextTripStep(form){
    const fields=[...form.querySelectorAll('[data-trip-step="'+tripStep+'"] input,[data-trip-step="'+tripStep+'"] select')];
    const invalid=fields.find(field=>!field.checkValidity());
    if(invalid){invalid.reportValidity();return;}
    setError('');setTripStep(step=>Math.min(2,step+1));
  }
  async function submitTrip(event){
    event.preventDefault();const form=event.currentTarget;
    if(tripStep<2){nextTripStep(form);return;}
    const invalid=[...form.querySelectorAll('input,select')].find(field=>!field.checkValidity());
    if(invalid){const step=Number(invalid.closest('[data-trip-step]')?.dataset.tripStep??2);setTripStep(step);setError('Complete all required fields before submitting.');return;}
    await save(event);
  }
  async function confirm(t) {await mutate(async()=>{const record=await repo.confirm(user,t,drafts[t.id]??t.confirmationNumber??'');acceptRecord(record);setDrafts(p=>{const n={...p};delete n[t.id];return n;});setMessage(shared?'Hotel confirmation saved.':'Hotel confirmation saved locally.');await refreshSaved();});}
  async function markRequested(t,value) {await mutate(async()=>{const record=await repo.requested(user,t,value);acceptRecord(record);setMessage(value?'Marked as requested from the hotel.':'');await refreshSaved();});}
  async function cancelRequest() {await mutate(async()=>{
    const record=removing;
    const result=await repo.remove(user,record,acknowledgeHotel);
    if(user.role==='admin')acceptRecord(result.record);
    else setTrips(previous=>previous.filter(t=>t.id!==result.id));
    setDrafts(previous=>{const next={...previous};delete next[result.id];return next;});
    setRemoving(null);setAcknowledgeHotel(false);
    setMessage(hotelNeedsCancellation(record)?`Cancellation recorded. Contact ${record.hotel||'the hotel'} separately about the booking.`:'Hotel request canceled.');await refreshSaved();
  });}
  async function recordHotelNotification(trip) {
    await mutate(async()=>{
      acceptRecord(await repo.hotelNotified(user,trip));
      setMessage('Hotel notification recorded.');
      await refreshSaved();
    });
  }
  async function saveTransport(action,message) {
    if(saving.current) return false;
    saving.current=true;setBusy(true);setError('');
    try {await action();setMessage(message);await refreshSaved();return true;}
    finally {saving.current=false;setBusy(false);}
  }
  function saveTransfer(record,leg,draft) {
    return saveTransport(async()=>acceptRecord(await repo.transfer(user,record,leg,draft)),'Transfer status updated.');
  }
  function saveDrivers(key,driverIds,revision) {
    return saveTransport(async()=>{
      const allocation=await repo.allocateDrivers(user,key,driverIds,revision);
      setTransferAllocations(previous=>({...previous,[key]:allocation}));
    },'Driver allocation updated.');
  }
  function editSchedule(start,end,status,targetUserId=user.id) {
    setScheduleEdit({start:display(start),end:display(end),status,targetUserId});
    setError('');
  }
  function closeScheduleEdit() {setScheduleEdit(null);setError('');}
  async function saveSchedule(getChanges,{undo=false,acknowledgedHotels=[],targetUserId=user.id}={}) {
    let count=0;
    await mutate(async()=>{
      setMessage('');
      const changes=getChanges().map(change=>({...change,...(targetUserId!==user.id?{targetUserId}:{})}));
      const targetUser=targetUserId===user.id?user:{...user,id:targetUserId};
      let result;
      try {result=await repo.scheduleBatch(user,changes,acknowledgedHotels);}
      catch(error) {
        if(error instanceof HotelReminderError) {
          setScheduleWarning({changes,hotels:error.hotels,undo,targetUserId});
          return;
        }
        if(undo&&error.status===409)scheduleHistory.current.pop();
        throw error;
      }
      const inverse=result.previous.map((entry,index)=>({...entry,expected:changes[index].status}))
        .filter(entry=>entry.status!==entry.expected);
      if(undo)scheduleHistory.current.pop();
      else if(inverse.length) {
        scheduleHistory.current.push({changes:inverse,targetUserId});
        if (scheduleHistory.current.length>50) scheduleHistory.current.shift();
      }
      setSchedule(previous=>updateScheduleEntries(targetUser,previous,changes));
      setScheduleEdit(null);
      setScheduleWarning(null);
      count=changes.length;
      if(undo)setMessage('Schedule change undone.');
      else if(scheduleWarning)setMessage('Schedule updated.');
      else setMessage(`Schedule updated for ${count} ${count===1?'weekday':'weekdays'}.`);
      await refreshSaved();
    });
    return count;
  }
  function saveDateRange(event) {
    event.preventDefault();
    const {start,end,status,targetUserId}=scheduleEdit;
    return saveSchedule(()=>scheduleWeekdays(parse(start),parse(end)).map(date=>({date,status})),{targetUserId});
  }
  function undoSchedule() {
    const entry=scheduleHistory.current.at(-1);
    if(entry)return saveSchedule(()=>entry.changes,{undo:true,targetUserId:entry.targetUserId});
  }
  const hotelNames=user?.role==='admin'?[...new Set(trips.map(t=>t.person).filter(Boolean))].sort((a,b)=>a.localeCompare(b)):[];
  const requestUsers=user?.role==='admin'
    ?[...new Map([user,...users].filter(Boolean).map(person=>[person.id,{id:person.id,name:person.name||person.username||'Staff'}])).values()]
      .sort((a,b)=>a.name.localeCompare(b.name))
    :[];
  const visibleTrips=trips.filter(t=>{
    if(user?.role!=='admin')return t.userId===user?.id&&(userTravelFilter==='all'||(userTravelFilter==='past'?Boolean(t.canceledAt||t.archivedAt||(t.returnDate||t.checkout)<iso(new Date())):!t.canceledAt&&!t.archivedAt&&(t.returnDate||t.checkout)>=iso(new Date())));
    if(hotelName && t.person!==hotelName)return false;
    if(hotelFilter==='all')return true;
    if(hotelFilter==='archived'||t.archivedAt)return hotelFilter==='archived'&&Boolean(t.archivedAt);
    if(hotelFilter==='canceled')return Boolean(t.canceledAt);
    if(hotelFilter==='notify')return t.canceledAt&&t.hotelCancellationRequired&&!t.hotelCancellationNotifiedAt;
    if(t.canceledAt)return false;
    if(hotelFilter==='requested')return t.hotelRequested===true;
    if(hotelFilter==='confirmed')return Boolean(t.confirmationNumber);
    if(hotelFilter==='unrequested')return !hotelNeedsCancellation(t);
    return true;
  });
  const field=(label,key,required=true)=><label className="block text-xs text-slate-600">{label}<input className={input+' mt-1'} required={required} maxLength={key==='membership'?64:80} value={trip[key]} onChange={e=>change(key,e.target.value)}/></label>;
  const arrivalOptions=Object.entries(references?.flights||{})
    .filter(([,flight])=>String(flight.destination||'').trim().toUpperCase()==='NBJ')
    .sort(([a],[b])=>a.localeCompare(b));
  const departureOptions=Object.entries(references?.flights||{})
    .filter(([,flight])=>String(flight.origin||'').trim().toUpperCase()==='NBJ')
    .sort(([a],[b])=>a.localeCompare(b));
  const flightInput=(label,key,options)=><label className="block text-xs text-slate-600">{label}
    <input className={input+' mt-1'} required list={key+'-flight-options'} maxLength={80}
      autoComplete="off" value={trip[key]} onChange={e=>change(key,e.target.value)}
      placeholder="Type a flight or select from the list"/>
    <datalist id={key+'-flight-options'}>{options.map(([number,flight])=>
      <option value={number} key={number} label={number+' · '+flight.origin+' → '+flight.destination}/>)}</datalist>
  </label>;
  const fixed=(label,value)=><label className="block text-xs text-slate-600">{label}<input readOnly className={input+' mt-1 bg-slate-50'} value={value}/></label>;
  const date=(label,key)=><DateField label={label} value={trip[key]} onChange={v=>change(key,v)}/>;
  const time=(label,key)=><TimeField label={label} value={trip[key]} onChange={v=>change(key,v)}/>;
  const nights=nightsBetween(trip.checkin,trip.checkout);
  const eligiblePickupOptions=pickupOptions.filter(option=>{
    const pickupDate=parse(trip.pickupDate),departure=parse(trip.returnDate),arrival=parse(trip.outDate);
    return pickupDate&&(!departure||!trip.returnTime||(pickupDate+'T'+option.time<departure+'T'+trip.returnTime))&&
      (!arrival||!trip.outTime||(pickupDate+'T'+option.time>arrival+'T'+trip.outTime));
  });
  const usersAccess=user?.role==='admin'&&(connected
    ?<SupabaseUsersAccess client={supabaseClient} currentUser={user} onChange={()=>refresh()}/>
    :<UsersAccess users={users} tags={tags} currentUser={user} shared={shared} busy={busy} onAction={accessAction}/>);
  if(!user)return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><form onSubmit={login} className="bg-white border rounded-2xl p-8 w-full max-w-md space-y-5 shadow-sm"><h1 className="text-2xl font-bold text-blue-900">Staff & Travel</h1><p className="text-sm text-slate-500">Team planning and travel workspace</p><label className="block text-sm">Full name<input required readOnly={shared} autoComplete="username" maxLength={120} className={input+' mt-1'} value={name} onChange={e=>setName(e.target.value)}/></label><label className="block text-sm">Password<input required type="password" autoComplete="current-password" maxLength={128} className={input+' mt-1'} value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={!ready||busy} className={button+' w-full'}>{!ready?'Preparing accounts…':busy?'Signing in…':'Sign in'}</button>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<p className="text-xs text-slate-500">Accounts start with the temporary password <strong>test</strong>, unless an admin has changed it.</p>{!shared&&<p className="text-xs bg-amber-50 p-3 rounded text-amber-900">Local demo only. For initial admin access, use admin / test. Password and access controls are for testing; data stays in this browser. Use fictional data. No bookings or emails are sent.</p>}</form></div>;
  return <div className="min-h-screen bg-slate-50 text-slate-800"><header className="bg-white border-b p-5 flex flex-wrap gap-4 justify-between"><h1 className="text-xl font-bold text-blue-900">Staff Planner</h1><div className="flex gap-4 items-center text-sm">{user.role==='admin'&&<button disabled={!ready||busy} onClick={exportExcel} className="text-blue-700">Export to Excel</button>}<span>{user.name} · {user.role==='admin'?'Admin':'User'}</span><button disabled={busy} onClick={logout}>Sign out</button></div></header>{!connected&&<p className="bg-amber-50 text-amber-900 text-xs px-6 py-2">{shared?'Team workspace · Use local times for each location · No bookings or emails are sent':'Local demo only · Data stays in this browser · Passwords and permissions are for testing'}</p>}<main className={'mx-auto p-4 sm:p-6 '+(tab==='planner'?'max-w-[112rem]':'max-w-6xl')}><div className="flex flex-wrap justify-between gap-4 mb-6"><nav className="flex flex-wrap gap-2" aria-label="Workspace sections">{[['overview','Overview'],['planner','Schedule'],['travel','Hotel & flights'],['transport','Transfers'],...(connected?[['profile','My profile']]:[]),...(user.role==='admin'?[['access',database?'Database':'Users & access'],['audit','Logs']]:[])].map(([key,label])=><button key={key} onClick={()=>{setTab(key);setError('');}} aria-current={tab===key?'page':undefined} className={'rounded-xl px-4 py-3 text-sm '+(tab===key?'bg-white shadow text-blue-700':'text-slate-500')}>{label}</button>)}</nav>{['travel','transport'].includes(tab)&&<button disabled={!ready||busy} className={button} onClick={()=>open(null)}>Plan a trip</button>}</div>{connected&&ready&&tab==='planner'&&!sharedScheduleReady&&<p role="alert" className="border border-amber-200 bg-amber-50 text-amber-900 rounded-lg p-3 text-sm mb-4">
        Team Schedule is not synchronized. The dates currently visible may be saved only in this browser and cannot be seen by teammates. An administrator must run <a className="underline font-medium" target="_blank" rel="noopener noreferrer" href="https://github.com/pedrogomeslcb/staff-travel/blob/main/supabase/shared-schedule.sql">shared-schedule.sql</a> in the Supabase SQL Editor, then reload. Existing local dates in this browser will be imported without overwriting shared entries.
      </p>}{message&&<p role="status" className="bg-blue-50 p-3 rounded-lg text-sm mb-4">{message}</p>}{error&&!modal&&!scheduleEdit&&!scheduleWarning&&!removing&&<p role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg text-sm mb-4">{error}</p>}{!ready&&<p className="text-sm text-slate-500">Loading workspace…</p>}

    {tab==='overview'&&<><Overview user={user} people={people} trips={trips} countryTrips={countryTrips} countryLimited={countryLimited} schedule={schedule} presence={presence} transferTrips={transferTrips} allocations={transferAllocations} drivers={references?.drivers} passengersReady={transferPassengersReady} ready={ready} busy={busy} onPlan={()=>open(null)} onEdit={open} onNavigate={setTab}/>{ready&&showHelp&&<section className="mt-5 rounded-xl border bg-white p-4 text-sm"><h2 className="font-semibold">Getting started</h2><p className="mt-2">Use Plan a trip to add flights, hotel and transfers. In Schedule, select weekdays in your own row or use Set date range. Open Transfers to check pickup times and your driver.</p><button type="button" className="mt-3 text-blue-700 underline" onClick={()=>{setShowHelp(false);try{localStorage.setItem('staff-help-seen-'+user.id,'1');}catch{}}}>Dismiss guide</button></section>}</>}
    {tab==='profile'&&connected&&<section className="max-w-xl space-y-4 rounded-xl border bg-white p-5"><h2 className="font-semibold">My profile</h2><p className="text-sm">{user.name} · {user.username||'Username not available'}</p><form className="space-y-3" onSubmit={e=>{e.preventDefault();void mutate(async()=>{const data=await database.saveOwnMembership(profileMembership??references?.membership??'');setReferences(data);setProfileMembership(null);setMessage('IHG membership saved.');});}}><label className="block text-sm">IHG membership (optional)<input className={input+' mt-1'} maxLength={64} disabled={!references||busy} value={profileMembership??references?.membership??''} onChange={e=>setProfileMembership(e.target.value)}/></label><p className="text-xs text-slate-600">Used to prefill future hotel requests. Leave blank to remove it.</p><button className={button} disabled={!references||busy||profileMembership===null}>Save membership</button></form><button type="button" className="text-sm text-blue-700 underline" onClick={()=>{setShowHelp(true);setTab('overview');}}>Show getting started guide</button></section>}
    {tab==='travel'&&<div className="space-y-5">{user.role!=='admin'&&<div className="flex flex-wrap gap-2" aria-label="Trip history">{[['upcoming','Upcoming'],['past','Past & canceled'],['all','All trips']].map(([key,label])=><button type="button" key={key} aria-pressed={userTravelFilter===key} className="rounded-lg border bg-white px-3 py-2 text-sm aria-pressed:bg-blue-50" onClick={()=>setUserTravelFilter(key)}>{label}</button>)}</div>}{connected&&user.role==='admin'&&ready&&<TripArchive client={supabaseClient} trips={trips} refresh={refreshSaved}/>}{user.role==='admin'&&<div className="grid gap-3 sm:grid-cols-2 max-w-2xl"><label className="block text-xs text-slate-600">Hotel request status<select className={input+' mt-1'} value={hotelFilter} onChange={e=>setHotelFilter(e.target.value)}>{hotelFilters.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="block text-xs text-slate-600">Team member<select className={input+' mt-1'} value={hotelName} onChange={e=>setHotelName(e.target.value)}>
        <option value="">All team members</option>
        {hotelNames.map(name=><option key={name} value={name}>{name}</option>)}
      </select></label></div>}{!visibleTrips.length&&ready&&<div className="bg-white border rounded-xl p-8 text-center text-slate-600"><p>No hotel requests match this view.</p><button type="button" disabled={busy} className="mt-3 text-blue-700 underline" onClick={()=>open(null)}>Plan a trip</button></div>}{visibleTrips.map(t=>t.archivedAt?<article key={t.id} className="rounded-xl border bg-white p-5"><h2 className="font-semibold">{t.person}</h2><p className="mt-1 text-sm">Check-in {display(t.checkin)} · Check-out {display(t.checkout)}</p></article>:t.canceledAt?<CanceledHotelCard key={t.id} trip={t} busy={busy||user.role!=='admin'} onNotify={recordHotelNotification}/>:<article key={t.id} className="bg-white border rounded-2xl p-6"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold text-lg">{t.person}</h2>{(visibleProject(t.project)||visibleHotel(t.hotel))&&<p className="text-xs text-slate-500">{[visibleProject(t.project),visibleHotel(t.hotel)].filter(Boolean).join(' · ')}</p>}</div><div className="flex flex-col items-end gap-2"><Status value={hotelStatus(t)}/>{user.role==='admin'&&<label className="inline-flex items-center gap-2 border rounded-lg px-3 py-2 text-sm text-slate-700 bg-slate-50"><input type="checkbox" checked={t.hotelRequested===true} disabled={busy||user.role!=='admin'} onChange={e=>markRequested(t,e.target.checked)} aria-label={'Requested: '+t.person}/>Requested</label>}</div></div><div className="grid md:grid-cols-3 gap-5 my-5 text-sm"><div><p className="text-xs text-slate-500 mb-1">Hotel stay</p><p>{display(t.checkin)} → {display(t.checkout)}</p><p className="text-xs mt-2">Hotel loyalty number: {t.membership||'Not provided'}</p></div><div><p className="text-xs text-slate-500 mb-1">Arrival flight · {t.outFlight}</p><p>{t.outOrigin} → {t.outDestination}</p><p>{display(t.outDate)} {t.outTime}</p></div><div><p className="text-xs text-slate-500 mb-1">Return flight · {t.returnFlight}</p><p>{t.returnOrigin} → {t.returnDestination}</p><p>{display(t.returnDate)} {t.returnTime}</p></div></div>{t.notes&&<p className="text-sm my-3 whitespace-pre-wrap break-words">Comments: {t.notes}</p>}<div className="border-t mt-4 pt-4"><label className="block text-xs text-slate-500">Confirmation Number<input className={input+' mt-1'} maxLength={100} readOnly={!canManageRequest(user,t)} placeholder="Pending hotel confirmation" value={canManageRequest(user,t)?(drafts[t.id]??t.confirmationNumber??''):(t.confirmationNumber||'')} onChange={e=>setDrafts(p=>({...p,[t.id]:e.target.value}))}/></label><div className="flex flex-wrap gap-3 mt-3">{canManageRequest(user,t)&&<button disabled={busy} className={button} onClick={()=>confirm(t)}>Save confirmation</button>}{(t.userId===user.id||user.role==='admin')&&<button disabled={busy} className="border rounded-lg px-4 py-2 text-blue-700 text-sm" onClick={()=>open(t)}>Edit request</button>}{canManageRequest(user,t)&&<button disabled={busy} className="border border-red-200 rounded-lg px-4 py-2 text-red-700 text-sm hover:bg-red-50" onClick={()=>{setRemoving(t);setAcknowledgeHotel(false);setError('');}}>Cancel request</button>}</div>{t.needsReview&&<p className="text-sm text-amber-800 mt-3">Changed after confirmation. Review and hotel reconfirmation required.</p>}<p className="text-xs text-slate-500 mt-3">Hotel confirmation is recorded manually by the reservation owner or an admin.</p></div></article>)}</div>}

    {tab==='transport'&&<Transfers trips={transferTrips} allocations={transferAllocations} drivers={references?.drivers} user={user} busy={busy} onSave={saveTransfer} onAllocate={saveDrivers} passengersShared={transferPassengersReady}/>}

    {tab==='planner'&&<Schedule countryTrips={countryTrips} countryLimited={countryLimited} month={month} setMonth={setMonth} people={people} trips={trips} tags={tags} sectorLabel={connected?'Department':'Sector'} allowTeamEdit={connected} presence={presence} schedule={schedule} user={user} ready={ready} busy={busy} onEdit={editSchedule} onChange={(changes,targetUserId)=>saveSchedule(()=>changes,{targetUserId})} onUndo={scheduleEdit||scheduleWarning?undefined:undoSchedule}/>}
    {tab==='access'&&user.role==='admin'&&(database?<Database database={database} shared={shared||connected} trips={trips} onReferences={setReferences}>{usersAccess}</Database>:usersAccess)}
    {tab==='audit'&&user.role==='admin'&&<TravelAudit repo={repo} user={user} trips={trips} shared={shared||connected} connected={connected}/>}
  </main>

  {removing&&<Dialog title="Cancel hotel request" onClose={()=>{if(!busy){setRemoving(null);setError('');}}}><div className="p-6 space-y-4">
    <p className="text-sm text-slate-600">Cancel the request for <strong>{removing.person}</strong>, {display(removing.checkin)}–{display(removing.checkout)}? This clears its transfers and automatic Onsite entries. Manual schedule entries stay on the calendar.</p>
    {hotelNeedsCancellation(removing)&&<>
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Contact {visibleHotel(removing.hotel)||'the hotel'} separately to cancel the booking{removing.confirmationNumber?' '+removing.confirmationNumber:''}. The app records the cancellation request for the admins.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={acknowledgeHotel} onChange={e=>setAcknowledgeHotel(e.target.checked)}/>I understand that the hotel needs a separate cancellation notice.</label>
    </>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex gap-3"><button disabled={busy||hotelNeedsCancellation(removing)&&!acknowledgeHotel} className="rounded-lg bg-red-700 px-4 py-2.5 text-sm text-white disabled:opacity-50" onClick={cancelRequest}>{busy?'Saving…':'Cancel request'}</button><button disabled={busy} className="px-3" onClick={()=>{setRemoving(null);setError('');}}>Keep request</button></div>
  </div></Dialog>}

  {scheduleWarning&&<Dialog wide title="Review your hotel request" onClose={()=>{if(!busy){setScheduleWarning(null);setError('');}}}>
    <div className="space-y-4 p-6">
      <p className="text-sm text-slate-700">You are removing Onsite days that overlap a hotel stay marked Requested. If your travel plans changed, make sure the hotel receives a cancellation notice. To record the cancellation here, open Hotel &amp; flights and choose <strong>Cancel request</strong>.</p>
      <ul className="space-y-2">{scheduleWarning.hotels.map(hotel=><li key={hotel.id} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <strong>{visibleHotel(hotel.hotel)||'Hotel request'}</strong> · {hotel.status} · {display(hotel.checkin)}–{display(hotel.checkout)}
        <span className="block text-xs">{hotel.dates.length} affected {hotel.dates.length===1?'weekday':'weekdays'}</span>
      </li>)}</ul>
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button disabled={busy} className={button} onClick={()=>saveSchedule(()=>scheduleWarning.changes,{undo:scheduleWarning.undo,acknowledgedHotels:scheduleWarning.hotels.map(hotel=>hotel.id),targetUserId:scheduleWarning.targetUserId})}>{busy?'Saving…':'Save schedule only'}</button>
        <button disabled={busy} onClick={()=>{setScheduleWarning(null);setError('');}}>Keep current schedule</button>
      </div>
    </div>
  </Dialog>}

  {scheduleEdit&&!scheduleWarning&&<Dialog wide title={'Set schedule category'+(scheduleEdit.targetUserId!==user.id?' · '+(people.find(person=>person.id===scheduleEdit.targetUserId)?.name||'Team member'):'')} onClose={()=>!busy&&closeScheduleEdit()}>
    <form className="p-6 space-y-4" onSubmit={saveDateRange}>
      <div className="grid sm:grid-cols-2 gap-4">
        <DateField label="Start date" value={scheduleEdit.start} onChange={start=>setScheduleEdit(previous=>({...previous,start,end:previous.start===previous.end?start:previous.end}))}/>
        <DateField label="End date" value={scheduleEdit.end} onChange={end=>setScheduleEdit(previous=>({...previous,end}))}/>
      </div>
      <label className="block text-sm">Category
        <select required className={input+' mt-1'} value={scheduleEdit.status} onChange={e=>setScheduleEdit(previous=>({...previous,status:e.target.value}))}>
          <option value="" disabled>Choose a category</option>
          {[...categories,['clear','Use hotel default / clear entry']].map(([value,label])=><option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      <p className="text-sm text-slate-600">Applies to weekdays in your schedule, including both dates.</p>
      {error&&<p role="alert" className="text-red-700 text-sm">{error}</p>}
      <div className="flex gap-3"><button disabled={busy} className={button}>{busy?'Saving…':'Apply category'}</button><button type="button" disabled={busy} onClick={closeScheduleEdit}>Cancel</button></div>
    </form>
  </Dialog>}

  {modal&&<Dialog wide title={editing!==null?'Edit trip':'Plan a trip'} onClose={()=>!busy&&setModal(false)}><form noValidate onSubmit={submitTrip} className="p-4 sm:p-6 space-y-5"><nav aria-label="Trip steps" className="grid grid-cols-3 gap-2">{['Flights','Hotel','Transfers'].map((label,i)=><button type="button" key={label} aria-current={tripStep===i?'step':undefined} disabled={busy||i>tripStep} onClick={()=>setTripStep(i)} className={'rounded-lg border px-2 py-2 text-sm '+(i===tripStep?'bg-blue-700 text-white':'bg-slate-50 text-slate-700')}>{i+1}. {label}</button>)}</nav><p className="bg-blue-50 rounded-xl p-3 text-xs text-blue-800">Dates: DD/MM/YYYY · Times: 00:00–23:59, local to the airport or pickup location.</p><div data-trip-step="0" hidden={tripStep!==0} className="space-y-5"><section aria-label="Arrival flight"><h3 className="font-semibold mb-3">Arrival flight</h3><div className="grid sm:grid-cols-2 gap-4">{flightInput('Flight number','outFlight',arrivalOptions)}{field('Origin airport','outOrigin')}{field('Arrival airport','outDestination')}{date('Arrival date','outDate')}{time('Arrival time','outTime')}</div></section><section aria-label="Return flight"><h3 className="font-semibold mb-3">Return flight</h3><div className="grid sm:grid-cols-2 gap-4">{flightInput('Flight number','returnFlight',departureOptions)}{field('Origin airport','returnOrigin')}{field('Destination airport','returnDestination')}{date('Departure date','returnDate')}{time('Departure time','returnTime')}</div></section></div><div data-trip-step="1" hidden={tripStep!==1}><section className="space-y-4" aria-label="Hotel details"><h3 className="font-semibold">Hotel details</h3>{user.role==='admin'&&editing===null
        ?<label className="block text-xs text-slate-600">Full name<select required className={input+' mt-1'} value={requestUserId} onChange={e=>selectRequestUser(e.target.value)}>
          {requestUsers.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}
        </select></label>
        :fixed('Full name',editing!==null?trip.person||user.name:user.name)}
      {field('Hotel loyalty number (optional)','membership',false)}<div className="grid sm:grid-cols-2 gap-4">{date('Check-in date','checkin')}{date('Check-out date','checkout')}</div><p className="text-sm text-blue-700" aria-live="polite">{nights!==null&&nights>0?`${nights} ${nights===1?'night':'nights'}`:'Select valid check-in and check-out dates to calculate nights.'}</p></section></div><div data-trip-step="2" hidden={tripStep!==2} className="space-y-4"><section className="bg-slate-50 border rounded-xl p-4" aria-label="Hotel to airport pickup"><h3 className="font-semibold mb-2">Hotel → airport pickup</h3><p className="text-xs text-slate-500 mb-3">Both airport transfers are required. On arrival, the driver follows your flight. For your return, specify when the driver should pick you up at the hotel.</p><div className="grid sm:grid-cols-2 gap-4">{date('Hotel pickup date','pickupDate')}{time('Hotel pickup time','pickupTime')}</div>
      {connected&&parse(trip.pickupDate)&&!trip.returnOrigin.trim()&&<p className="mt-3 text-xs text-slate-600">Enter the return-flight departure airport above to find existing transfers for this date.</p>}
      {connected&&pickupOptionsLoading&&<p role="status" className="mt-3 text-xs text-slate-600">Checking existing transfers for this pickup date…</p>}
      {connected&&pickupLookupDone&&!pickupOptionsLoading&&!pickupOptionsError&&!eligiblePickupOptions.length&&<p className="mt-3 text-xs text-slate-600">No compatible transfers found for this date and departure airport. You can enter a new pickup time.</p>}
      {connected&&pickupOptionsError&&<p className="mt-3 text-xs text-amber-800">{pickupOptionsError} You may still enter your pickup time manually.</p>}
      {connected&&eligiblePickupOptions.length>0&&<div className="mt-4 space-y-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3" role="group" aria-label="Existing hotel pickups">
        <p className="text-sm font-semibold text-blue-900">Join an existing hotel → airport transfer?</p>
        <p className="text-xs text-slate-600">Other team members have a pickup on this date for the same departure airport. Choose one only if you can depart from the same pickup location and the time suits your flight.</p>
        {eligiblePickupOptions.map(option=>{
          const assigned=(option.driverIds||[]).map(id=>(references?.drivers?.length?references.drivers:DRIVERS).find(driver=>driver.id===id)).filter(Boolean);
          const driversText=assigned.length
            ?assigned.map(driver=>driver.name+(driver.licensePlate?' · '+driver.licensePlate:'')).join(' / ')
            :option.assignedDriver||'Driver not assigned yet';
          return <div key={option.time+'|'+option.pickupLocation} className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white p-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">{display(parse(trip.pickupDate))} · {option.time}</p>
              <p className="text-xs text-slate-700">Requested by <strong>{option.requestedBy}</strong></p>
              <p className="text-xs text-slate-600">{driversText}</p>
            </div>
            <button type="button" disabled={busy} className="rounded-md border border-blue-200 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
              onClick={()=>{setTrip(previous=>({...previous,pickupTime:option.time,hotel:option.pickupLocation}));setJoinedPickupTime(option.time);}}> 
              {joinedPickupTime===option.time&&trip.pickupTime===option.time&&trip.hotel===option.pickupLocation?'Selected':'Use this transfer'}
            </button>
          </div>;
        })}
        <p className="text-xs text-slate-600">Selecting also adopts the existing pickup location internally so your request joins the same transfer group. Vehicle seats and driver allocation remain subject to administrator confirmation.</p>
      </div>}</section><label className="block text-xs text-slate-600">Comments<textarea className={input+' mt-1'} maxLength={2000} rows={3} value={trip.notes} onChange={e=>change('notes',e.target.value)}/></label>{editing!==null&&trip.confirmationNumber&&<p className="text-sm text-amber-800">Changes to a confirmed request require hotel reconfirmation. The confirmation number will be preserved.</p>}<p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Review: {trip.outFlight} · {trip.outDate} → {trip.returnFlight} · {trip.returnDate}. Hotel: {trip.checkin} – {trip.checkout}. Both airport transfers are included.</p>{(()=>{const arrival=parse(trip.outDate),departure=parse(trip.returnDate);if(!arrival||!departure||departure<arrival)return null;const current=countryTrips.filter(t=>t.id!==editing);const target=requestUserId||user.id;if(countryLimited&&target!==user.id)return null;const withTrip=[...current,{userId:target,outDate:arrival,returnDate:departure}];const years=[...new Set([Number(arrival.slice(0,4)),Number(departure.slice(0,4))])];return years.map(year=>{const quota=countryYearBreakdown(withTrip,target,year,iso(new Date()));return <p key={year} className={'rounded-lg p-3 text-sm '+(quota.total>=75?'bg-amber-50 text-amber-900':'bg-slate-50 text-slate-700')}>{year}: {quota.total} / {annualLimit} days used or planned.{quota.total>annualLimit?' This trip exceeds the annual allowance by '+(quota.total-annualLimit)+' days.':quota.total>=85?' Near the annual allowance.':''}</p>;});})()}</div>{error&&<p role="alert" className="text-red-700 text-sm">{error}</p>}<div className="flex flex-wrap justify-between gap-2">{tripStep>0&&<button type="button" disabled={busy} className="rounded-lg border px-4 py-2 text-sm" onClick={()=>{setError('');setTripStep(i=>i-1);}}>Back</button>}<button disabled={busy} className={button+' ml-auto'}>{busy?'Saving…':tripStep===0?'Continue to hotel':tripStep===1?'Continue to transfers':editing!==null?'Save changes':'Submit trip'}</button></div></form></Dialog>}
  </div>;
}
