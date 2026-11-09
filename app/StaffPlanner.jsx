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
import Dialog from './Dialog';
import Transfers from './Transfers';
import UsersAccess from './UsersAccess';
import TravelAudit from './TravelAudit';
import Database from './Database';

const input='w-full border border-slate-300 rounded-lg p-2.5 bg-white text-sm text-slate-800';
const button='bg-blue-700 text-white rounded-lg px-4 py-2.5 text-sm hover:bg-blue-800 disabled:opacity-50';
const categories=SCHEDULE_CATEGORIES;
const hotelFilters=[
  ['active','Active'],['requested','Requested'],['confirmed','Confirmed'],['unrequested','Awaiting request'],
  ['canceled','Canceled'],['notify','Hotel notification pending'],['all','All requests'],
];

function CanceledHotelCard({trip,busy,onNotify}) {
  const notified=trip.hotelCancellationNotifiedAt;
  return <article className="space-y-3 rounded-2xl border bg-slate-50 p-5 text-sm text-slate-600">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="line-through">
        <h2 className="text-base font-semibold">{trip.person}</h2>
        <p>{trip.hotel} · {trip.project} · {display(trip.checkin)}–{display(trip.checkout)}</p>
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
const LAMBANCA_HOTEL = 'InterContinental Luanda Miramar';

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
  const [tab,setTab]=useState('planner'),[modal,setModal]=useState(false),[editing,setEditing]=useState(null),[trip,setTrip]=useState({...blank});
  const [projectOther,setProjectOther]=useState(false);
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[drafts,setDrafts]=useState({}),[busy,setBusy]=useState(false),[ready,setReady]=useState(false);
  const [month,setMonth]=useState(()=>new Date()),[scheduleEdit,setScheduleEdit]=useState(null);
  const [scheduleWarning,setScheduleWarning]=useState(null),[hotelFilter,setHotelFilter]=useState('active');
  const [removing,setRemoving]=useState(null),[acknowledgeHotel,setAcknowledgeHotel]=useState(false);
  const saving=useRef(false),userRef=useRef(initialUser),scheduleHistory=useRef([]);
  userRef.current=user;
  const [tags,setTags]=useState([]),[users,setUsers]=useState([]),[presence,setPresence]=useState([]),[transferTrips,setTransferTrips]=useState([]);
  const [transferAllocations,setTransferAllocations]=useState({});
  const [references,setReferences]=useState(null);
  function applySnapshot(snapshot) {
    if(userRef.current?.id!==snapshot.currentUser?.id) scheduleHistory.current=[];
    setPeople(connected&&initialUser&&!snapshot.people.some(p=>p.id===initialUser.id)?[initialUser,...snapshot.people.filter(p=>p.name!=='admin')]:snapshot.people);setTrips(snapshot.trips);setSchedule(snapshot.schedule);setTags(snapshot.tags||[]);setUsers(snapshot.users||[]);setPresence(snapshot.presence||[]);setTransferTrips(snapshot.transferTrips||[]);
    setTransferAllocations(snapshot.transferAllocations||{});
    const verified=connected?initialUser:snapshot.currentUser;
    userRef.current=verified;setUser(verified);
    if(verified?.role!=='admin')setTab(previous=>['access','audit'].includes(previous)?'planner':previous);
  }
  function clearSession() {
    scheduleHistory.current=[];
    setTransferAllocations({});
    setScheduleWarning(null);setHotelFilter('active');
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
  function change(key,value) {
    setTrip(p=>{
      const next=changeTrip(p,key,value,references?.flights);
      if(key==='project'){
        if(value==='LAMBANCA')next.hotel=LAMBANCA_HOTEL;
        else if(p.project==='LAMBANCA'&&p.hotel===LAMBANCA_HOTEL)next.hotel='';
      }
      return next;
    });
  }
  function open(record) {setEditing(record?.id??null);setProjectOther(!!record?.project&&record.project!=='LAMBANCA');setTrip({...toDraft(record),...(!record&&connected?{membership:references?.membership||''}:{})});setError('');setModal(true);if(connected&&!record)database.references().then(data=>{setReferences(data);setTrip(old=>({...old,membership:data.membership||''}));}).catch(e=>setError('Could not load IHG membership: '+e.message));}
  async function mutate(action) {if (saving.current) return;saving.current=true;setBusy(true);setError('');try {await action();}catch(e){accessError(e);}finally {saving.current=false;setBusy(false);}}
  function acceptRecord(record) {setTrips(previous=>previous.some(t=>t.id===record.id)?previous.map(t=>t.id===record.id?record:t):[record,...previous]);}
  async function save(e) {
    e.preventDefault();await mutate(async()=>{
      const result=await repo.save(user,trip,editing);acceptRecord(result.record);setModal(false);
      if(!shared&&!connected&&result.record.membership)void database?.capture([result.record]).catch(()=>{});
      setMessage(!result.changed?'No changes to save.':editing!==null?(shared||connected?'Request updated for the team.':'Request updated locally. No email was sent.'):(shared||connected?'Request saved for the team. No email was sent.':'Request saved locally. No email was sent.'));await refreshSaved();
    });
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
  function editSchedule(start,end,status) {
    setScheduleEdit({start:display(start),end:display(end),status});
    setError('');
  }
  function closeScheduleEdit() {setScheduleEdit(null);setError('');}
  async function saveSchedule(getChanges,{undo=false,acknowledgedHotels=[]}={}) {
    let count=0;
    await mutate(async()=>{
      setMessage('');
      const changes=getChanges();
      let result;
      try {result=await repo.scheduleBatch(user,changes,acknowledgedHotels);}
      catch(error) {
        if(error instanceof HotelReminderError) {
          setScheduleWarning({changes,hotels:error.hotels,undo});
          return;
        }
        if(undo&&error.status===409)scheduleHistory.current.pop();
        throw error;
      }
      const inverse=result.previous.map((entry,index)=>({...entry,expected:changes[index].status}))
        .filter(entry=>entry.status!==entry.expected);
      if(undo)scheduleHistory.current.pop();
      else if(inverse.length) {
        scheduleHistory.current.push(inverse);
        if (scheduleHistory.current.length>50) scheduleHistory.current.shift();
      }
      setSchedule(previous=>updateScheduleEntries(user,previous,changes));
      setScheduleEdit(null);
      setScheduleWarning(null);
      count=changes.length;
      if(undo)setMessage('Schedule change undone.');
      else if(scheduleWarning)setMessage('Schedule updated.');
      else if(scheduleEdit)setMessage(`Schedule updated for ${count} ${count===1?'weekday':'weekdays'}.`);
      await refreshSaved();
    });
    return count;
  }
  function saveDateRange(event) {
    event.preventDefault();
    const {start,end,status}=scheduleEdit;
    return saveSchedule(()=>scheduleWeekdays(parse(start),parse(end)).map(date=>({date,status})));
  }
  function undoSchedule() {
    const changes=scheduleHistory.current.at(-1);
    if(changes)return saveSchedule(()=>changes,{undo:true});
  }
  const visibleTrips=trips.filter(t=>{
    if(user?.role!=='admin')return !t.canceledAt&&t.userId===user?.id;
    if(hotelFilter==='all')return true;
    if(hotelFilter==='canceled')return Boolean(t.canceledAt);
    if(hotelFilter==='notify')return t.canceledAt&&t.hotelCancellationRequired&&!t.hotelCancellationNotifiedAt;
    if(t.canceledAt)return false;
    if(hotelFilter==='requested')return t.hotelRequested===true;
    if(hotelFilter==='confirmed')return Boolean(t.confirmationNumber);
    if(hotelFilter==='unrequested')return !hotelNeedsCancellation(t);
    return true;
  });
  const field=(label,key,required=true)=><label className="block text-xs text-slate-600">{label}<input className={input+' mt-1'} required={required} maxLength={key==='membership'?64:80} value={trip[key]} onChange={e=>change(key,e.target.value)}/></label>;
  const fixed=(label,value)=><label className="block text-xs text-slate-600">{label}<input readOnly className={input+' mt-1 bg-slate-50'} value={value}/></label>;
  const date=(label,key)=><DateField label={label} value={trip[key]} onChange={v=>change(key,v)}/>;
  const time=(label,key)=><TimeField label={label} value={trip[key]} onChange={v=>change(key,v)}/>;
  const nights=nightsBetween(trip.checkin,trip.checkout);
  const usersAccess=user?.role==='admin'&&(connected
    ?<SupabaseUsersAccess client={supabaseClient} currentUser={user} onChange={()=>refresh()}/>
    :<UsersAccess users={users} tags={tags} currentUser={user} shared={shared} busy={busy} onAction={accessAction}/>);
  if(!user)return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><form onSubmit={login} className="bg-white border rounded-2xl p-8 w-full max-w-md space-y-5 shadow-sm"><h1 className="text-2xl font-bold text-blue-900">Staff & Travel</h1><p className="text-sm text-slate-500">Team planning and travel workspace</p><label className="block text-sm">Full name<input required readOnly={shared} autoComplete="username" maxLength={120} className={input+' mt-1'} value={name} onChange={e=>setName(e.target.value)}/></label><label className="block text-sm">Password<input required type="password" autoComplete="current-password" maxLength={128} className={input+' mt-1'} value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={!ready||busy} className={button+' w-full'}>{!ready?'Preparing accounts…':busy?'Signing in…':'Sign in'}</button>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<p className="text-xs text-slate-500">Accounts start with the temporary password <strong>test</strong>, unless an admin has changed it.</p>{!shared&&<p className="text-xs bg-amber-50 p-3 rounded text-amber-900">Local demo only. For initial admin access, use admin / test. Password and access controls are for testing; data stays in this browser. Use fictional data. No bookings or emails are sent.</p>}</form></div>;
  return <div className="min-h-screen bg-slate-50 text-slate-800"><header className="bg-white border-b p-5 flex flex-wrap gap-4 justify-between"><h1 className="text-xl font-bold text-blue-900">Staff & Travel</h1><div className="flex gap-4 items-center text-sm"><span>{user.name} · {user.role==='admin'?'Admin':'User'}</span><button disabled={busy} onClick={logout}>Sign out</button></div></header><p className="bg-amber-50 text-amber-900 text-xs px-6 py-2">{connected?'Supabase team workspace · Hotel requests are shared and visible to admins · Schedule edits remain local to this browser · No bookings or emails are sent':shared?'Team workspace · Use local times for each location · No bookings or emails are sent':'Local demo only · Data stays in this browser · Passwords and permissions are for testing'}</p><main className={'mx-auto p-4 sm:p-6 '+(tab==='planner'?'max-w-[112rem]':'max-w-6xl')}><div className="flex flex-wrap justify-between gap-4 mb-6"><nav className="flex flex-wrap gap-2" aria-label="Workspace sections">{[['planner','Schedule'],['travel','Hotel & flights'],['transport','Transfers'],...(user.role==='admin'?[['access',database?'Database':'Users & access'],...(connected?[]:[['audit','Audit log']])]:[])].map(([key,label])=><button key={key} onClick={()=>{setTab(key);setError('');}} aria-current={tab===key?'page':undefined} className={'rounded-xl px-4 py-3 text-sm '+(tab===key?'bg-white shadow text-blue-700':'text-slate-500')}>{label}</button>)}</nav>{!['planner','access','audit'].includes(tab)&&<button disabled={!ready} className={button} onClick={()=>open(null)}>Request hotel stay</button>}</div>{message&&<p role="status" className="bg-blue-50 p-3 rounded-lg text-sm mb-4">{message}</p>}{error&&!modal&&!scheduleEdit&&!scheduleWarning&&!removing&&<p role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg text-sm mb-4">{error}</p>}{!ready&&<p className="text-sm text-slate-500">Loading workspace…</p>}

    {tab==='travel'&&<div className="space-y-5">{user.role==='admin'&&<label className="block max-w-xs text-xs text-slate-600">Hotel request status<select className={input+' mt-1'} value={hotelFilter} onChange={e=>setHotelFilter(e.target.value)}>{hotelFilters.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}{!visibleTrips.length&&ready&&<p className="bg-white border rounded-xl p-10 text-center text-slate-500">No hotel requests match this view.</p>}{visibleTrips.map(t=>t.canceledAt?<CanceledHotelCard key={t.id} trip={t} busy={busy} onNotify={recordHotelNotification}/>:<article key={t.id} className="bg-white border rounded-2xl p-6"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold text-lg">{t.person}</h2><p className="text-xs text-slate-500">{t.project||'Project not specified'} · {t.hotel||'Hotel not specified'}</p></div><div className="flex flex-col items-end gap-2"><label className="inline-flex items-center gap-2 border rounded-lg px-3 py-2 text-sm text-slate-700 bg-slate-50"><input type="checkbox" checked={t.hotelRequested===true} disabled={busy||user.role!=='admin'} onChange={e=>markRequested(t,e.target.checked)} aria-label={'Requested: '+t.person}/>Requested</label>{(t.needsReview||t.confirmationNumber)&&<span className={'text-xs rounded-full px-3 py-2 '+(t.needsReview?'bg-amber-50 text-amber-800':'bg-teal-50 text-teal-800')}>{t.needsReview?'Review required':'Hotel confirmed'}</span>}</div></div><div className="grid md:grid-cols-3 gap-5 my-5 text-sm"><div><p className="text-xs text-slate-500 mb-1">Hotel stay</p><p>{display(t.checkin)} → {display(t.checkout)}</p><p className="text-xs mt-2">Hotel loyalty number: {t.membership||'Not provided'}</p></div><div><p className="text-xs text-slate-500 mb-1">Arrival flight · {t.outFlight}</p><p>{t.outOrigin} → {t.outDestination}</p><p>{display(t.outDate)} {t.outTime}</p></div><div><p className="text-xs text-slate-500 mb-1">Return flight · {t.returnFlight}</p><p>{t.returnOrigin} → {t.returnDestination}</p><p>{display(t.returnDate)} {t.returnTime}</p></div></div>{t.notes&&<p className="text-sm my-3 whitespace-pre-wrap break-words">Comments: {t.notes}</p>}<div className="border-t mt-4 pt-4"><label className="block text-xs text-slate-500">Confirmation Number<input className={input+' mt-1'} maxLength={100} readOnly={!canManageRequest(user,t)} placeholder="Pending hotel confirmation" value={canManageRequest(user,t)?(drafts[t.id]??t.confirmationNumber??''):(t.confirmationNumber||'')} onChange={e=>setDrafts(p=>({...p,[t.id]:e.target.value}))}/></label><div className="flex flex-wrap gap-3 mt-3">{canManageRequest(user,t)&&<button disabled={busy} className={button} onClick={()=>confirm(t)}>Save confirmation</button>}{(t.userId===user.id||user.role==='admin')&&<button disabled={busy} className="border rounded-lg px-4 py-2 text-blue-700 text-sm" onClick={()=>open(t)}>Edit request</button>}{canManageRequest(user,t)&&<button disabled={busy} className="border border-red-200 rounded-lg px-4 py-2 text-red-700 text-sm hover:bg-red-50" onClick={()=>{setRemoving(t);setAcknowledgeHotel(false);setError('');}}>Cancel request</button>}</div>{t.needsReview&&<p className="text-sm text-amber-800 mt-3">Changed after confirmation. Review and hotel reconfirmation required.</p>}<p className="text-xs text-slate-500 mt-3">Hotel confirmation is recorded manually by the reservation owner or an admin.</p></div></article>)}</div>}

    {tab==='transport'&&<Transfers trips={transferTrips} allocations={transferAllocations} drivers={references?.drivers} user={user} busy={busy} onSave={saveTransfer} onAllocate={saveDrivers}/>}

    {tab==='planner'&&<Schedule month={month} setMonth={setMonth} people={people} trips={trips} tags={tags} presence={presence} schedule={schedule} user={user} ready={ready} busy={busy} onEdit={editSchedule} onChange={changes=>saveSchedule(()=>changes)} onUndo={scheduleEdit||scheduleWarning?undefined:undoSchedule}/>}
    {tab==='access'&&user.role==='admin'&&(database?<Database database={database} shared={shared||connected} trips={trips} onReferences={setReferences}>{usersAccess}</Database>:usersAccess)}
    {tab==='audit'&&!connected&&user.role==='admin'&&<TravelAudit repo={repo} user={user} trips={trips} shared={shared}/>}
  </main>

  {removing&&<Dialog title="Cancel hotel request" onClose={()=>{if(!busy){setRemoving(null);setError('');}}}><div className="p-6 space-y-4">
    <p className="text-sm text-slate-600">Cancel the request for <strong>{removing.person}</strong>, {display(removing.checkin)}–{display(removing.checkout)}? This clears its transfers and automatic Onsite entries. Manual schedule entries stay on the calendar.</p>
    {hotelNeedsCancellation(removing)&&<>
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Contact {removing.hotel||'the hotel'} separately to cancel the booking{removing.confirmationNumber?' '+removing.confirmationNumber:''}. The app records the cancellation request for the admins.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={acknowledgeHotel} onChange={e=>setAcknowledgeHotel(e.target.checked)}/>I understand that the hotel needs a separate cancellation notice.</label>
    </>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex gap-3"><button disabled={busy||hotelNeedsCancellation(removing)&&!acknowledgeHotel} className="rounded-lg bg-red-700 px-4 py-2.5 text-sm text-white disabled:opacity-50" onClick={cancelRequest}>{busy?'Saving…':'Cancel request'}</button><button disabled={busy} className="px-3" onClick={()=>{setRemoving(null);setError('');}}>Keep request</button></div>
  </div></Dialog>}

  {scheduleWarning&&<Dialog wide title="Review your hotel request" onClose={()=>{if(!busy){setScheduleWarning(null);setError('');}}}>
    <div className="space-y-4 p-6">
      <p className="text-sm text-slate-700">You are removing Onsite days that overlap a hotel stay marked Requested. If your travel plans changed, make sure the hotel receives a cancellation notice. To record the cancellation here, open Hotel &amp; flights and choose <strong>Cancel request</strong>.</p>
      <ul className="space-y-2">{scheduleWarning.hotels.map(hotel=><li key={hotel.id} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <strong>{hotel.hotel}</strong> · {hotel.status} · {display(hotel.checkin)}–{display(hotel.checkout)}
        <span className="block text-xs">{hotel.dates.length} affected {hotel.dates.length===1?'weekday':'weekdays'}</span>
      </li>)}</ul>
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button disabled={busy} className={button} onClick={()=>saveSchedule(()=>scheduleWarning.changes,{undo:scheduleWarning.undo,acknowledgedHotels:scheduleWarning.hotels.map(hotel=>hotel.id)})}>{busy?'Saving…':'Save schedule only'}</button>
        <button disabled={busy} onClick={()=>{setScheduleWarning(null);setError('');}}>Keep current schedule</button>
      </div>
    </div>
  </Dialog>}

  {scheduleEdit&&!scheduleWarning&&<Dialog wide title="Set schedule category" onClose={()=>!busy&&closeScheduleEdit()}>
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

  {modal&&<Dialog wide title={editing!==null?'Edit hotel request':'Request hotel stay'} onClose={()=>!busy&&setModal(false)}><form onSubmit={save} className="p-6 space-y-6"><p className="bg-blue-50 rounded-xl p-3 text-xs text-blue-800">Dates: DD/MM/YYYY · Times: 00:00–23:59, local to the airport or pickup location. {shared||connected?'Requests are saved in the team workspace. Hotel bookings and emails are not sent automatically.':'No requests or emails are sent by this demo.'}</p><section className="space-y-4" aria-label="Hotel details"><h3 className="font-semibold">Hotel details</h3>{fixed('Full name',editing!==null?trip.person||user.name:user.name)}
      <label className="block text-xs text-slate-600">Project
        <select required className={input+' mt-1'} value={projectOther?'__other':(trip.project==='LAMBANCA'?'LAMBANCA':'')}
          onChange={e=>{
            const chosen=e.target.value;
            setProjectOther(chosen==='__other');
            change('project',chosen==='__other'?'':chosen);
          }}>
          <option value="" disabled>Select a project</option>
          <option value="LAMBANCA">LAMBANCA</option>
          <option value="__other">Other project</option>
        </select>
      </label>
      {projectOther&&<label className="block text-xs text-slate-600">Other project name
        <input required maxLength={80} className={input+' mt-1'} value={trip.project}
          onChange={e=>change('project',e.target.value)} placeholder="Enter project name"/>
      </label>}
      {field('Hotel','hotel')}
      {field('Hotel loyalty number (optional)','membership',false)}{connected&&<p className="text-xs text-slate-500">IHG membership is linked to your username and filled automatically. Ask an admin to update Database → IHG if it is missing.</p>}<div className="grid sm:grid-cols-2 gap-4">{date('Check-in date','checkin')}{date('Check-out date','checkout')}</div><p className="text-sm text-blue-700" aria-live="polite">{nights!==null&&nights>0?`${nights} ${nights===1?'night':'nights'}`:'Select valid check-in and check-out dates to calculate nights.'}</p></section><section aria-label="Arrival flight"><h3 className="font-semibold mb-3">Arrival flight</h3><p className="text-xs text-slate-500 mb-3">Enter the flight and airport details from your itinerary. All fields remain editable.</p><div className="grid sm:grid-cols-2 gap-4">{field('Flight number','outFlight')}{field('Origin airport','outOrigin')}{field('Arrival airport','outDestination')}{date('Arrival date','outDate')}{time('Arrival time','outTime')}</div></section><section aria-label="Return flight"><h3 className="font-semibold mb-3">Return flight</h3><div className="grid sm:grid-cols-2 gap-4">{field('Flight number','returnFlight')}{field('Origin airport','returnOrigin')}{field('Destination airport','returnDestination')}{date('Departure date','returnDate')}{time('Departure time','returnTime')}</div></section><section className="bg-slate-50 border rounded-xl p-4" aria-label="Hotel to airport pickup"><h3 className="font-semibold mb-2">Hotel → airport pickup</h3><p className="text-xs text-slate-500 mb-3">Both airport transfers are required. On arrival, the driver follows your flight. For your return, specify when the driver should pick you up at the hotel.</p><div className="grid sm:grid-cols-2 gap-4">{date('Hotel pickup date','pickupDate')}{time('Hotel pickup time','pickupTime')}</div></section><label className="block text-xs text-slate-600">Comments<textarea className={input+' mt-1'} maxLength={2000} rows={3} value={trip.notes} onChange={e=>change('notes',e.target.value)}/></label>{editing!==null&&trip.confirmationNumber&&<p className="text-sm text-amber-800">Changes to a confirmed request require hotel reconfirmation. The confirmation number will be preserved.</p>}{error&&<p role="alert" className="text-red-700 text-sm">{error}</p>}<button disabled={busy} className={button+' w-full'}>{busy?'Saving…':editing!==null?'Save changes':'Save request'}</button></form></Dialog>}
  </div>;
}
