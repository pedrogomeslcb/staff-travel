import {useRef,useState} from 'react';
import Dialog from './Dialog';
import {display} from '../lib/planner.mjs';
import {transferSlot} from '../lib/transfer-plan.mjs';

const button='rounded-lg border bg-white px-3 py-2 text-sm text-blue-800 disabled:opacity-50';
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=value=>typeof value==='string'?value:'';

function readArchive(source){
  const a=JSON.parse(source);
  if(a?.format!=='staff-planner-trips'||a.version!==1||
    !Array.isArray(a.trips)||!a.trips.every(t=>isObject(t)&&['person','id','userId','checkin','checkout'].every(k=>typeof t[k]==='string'))||
    !Array.isArray(a.assignments)||!a.assignments.every(isObject)||!Array.isArray(a.drivers)||!a.drivers.every(isObject)){
    throw Error('Choose a Staff Planner trip archive (.json).');
  }
  return a;
}
function ArchiveViewer({archive,onClose}){
  const [selected,setSelected]=useState(0);
  const t=archive.trips[selected];
  const slots=t?['arrival','return'].map(leg=>transferSlot(t,leg).key):[];
  const assignments=archive.assignments.filter(a=>slots.includes(a.slot_key));
  return <Dialog wide title="Imported archive · Read only" onClose={onClose}>
    <div className="space-y-4 p-5 text-sm">
      {t?<><label className="block">Trip<select className="mt-1 w-full rounded border p-2" value={selected} onChange={e=>setSelected(Number(e.target.value))}>
        {archive.trips.map((r,i)=><option key={i} value={i}>{r.person} · {display(r.checkin)} – {display(r.checkout)}</option>)}
      </select></label>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt>Hotel</dt><dd>{text(t.hotel)||'—'}</dd>
        <dt>Confirmation</dt><dd>{text(t.confirmationNumber)||'—'}</dd>
        <dt>Arrival</dt><dd>{[t.outFlight,t.outOrigin,t.outDestination,t.outDate,t.outTime].map(text).filter(Boolean).join(' · ')}</dd>
        <dt>Departure</dt><dd>{[t.returnFlight,t.returnOrigin,t.returnDestination,t.returnDate,t.returnTime].map(text).filter(Boolean).join(' · ')}</dd>
        <dt>Pickup</dt><dd>{[t.pickupDate,t.pickupTime].map(text).join(' ')}</dd>
        {['arrival','return'].map((leg,i)=>{
          const group=assignments.find(a=>a.slot_key===slots[i]);
          return <div className="contents" key={leg}><dt>{leg==='arrival'?'Arrival transfer':'Return transfer'}</dt>
            <dd>{[text(t.transfers?.[leg]?.status)||'to arrange',...(Array.isArray(group?.driver_ids)?group.driver_ids.map(text):[text(t.transfers?.[leg]?.driver)])].filter(Boolean).join(' · ')}</dd></div>;
        })}
      </dl>
      <details><summary className="cursor-pointer">Full booking, transfer and driver details</summary>
        <pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify({trip:t,assignments,drivers:archive.drivers},null,2)}</pre>
      </details></>:<p>This archive contains no trips.</p>}
    </div>
  </Dialog>;
}
export default function TripArchive({client,trips,refresh}){
  const [pending,setPending]=useState(null),[confirmed,setConfirmed]=useState(false);
  const [preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
  const fileInput=useRef(null);
  const cutoff=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  const count=trips.filter(t=>!t.archivedAt&&/^\d{4}-\d{2}-\d{2}$/.test(t.checkout)&&t.checkout<=cutoff).length;
  async function run(confirm){
    if(busy || (confirm&&(!confirmed||!pending)))return;
    setBusy(true);setStatus('');
    try{
      const {data,error}=await client.rpc('staff_trip_archive',{saved_version:confirm?pending.versionCode:null});
      if(error)throw Error(error.code==='PGRST202'?'Install supabase/trip-archive.sql in the Supabase SQL Editor first.':error.message);
      if(confirm){
        setPending(null);setConfirmed(false);
        setStatus(data.count+' trips archived.');
        await refresh();
      }else{
        if(!data.archive.trips.length){setStatus('No eligible trips.');await refresh();return;}
        const source=JSON.stringify(data.archive,null,2);
        readArchive(source);
        const url=URL.createObjectURL(new Blob([source],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;
        link.download='Staff-Planner-trips-'+new Date().toISOString().slice(0,10)+'-'+data.versionCode.slice(0,8)+'.json';
        link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
        setPending({versionCode:data.versionCode,count:data.archive.trips.length});setConfirmed(false);
      }
    }catch(e){setStatus(e.message);}
    finally{setBusy(false);}
  }
  async function importFile(e){
    const file=e.target.files?.[0];e.target.value='';
    if(!file)return;
    try{setPreview(readArchive(await file.text()));setStatus('');}
    catch{setStatus('Could not read this file. Choose a valid Staff Planner trip archive (.json).');}
  }
  return <details className="rounded-xl border bg-white p-4 text-sm">
    <summary className="cursor-pointer font-medium">Trip archive · {count} eligible</summary>
    <p className="my-3">Eligible 30 days after check-out.</p>
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={!count||busy} onClick={()=>run(false)}>Download archive</button>
      <button className={button} onClick={()=>fileInput.current?.click()}>Import archive</button>
      <input hidden ref={fileInput} type="file" accept=".json,application/json" onChange={importFile}/>
    </div>
    {pending&&<div className="mt-4 space-y-3 rounded-lg bg-amber-50 p-3">
      <label className="block"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/> I saved the file with all {pending.count} trips.</label>
      <p>The site keeps a summary. Import the saved file for full details.</p>
      <button className={button} disabled={!confirmed||busy} onClick={()=>run(true)}>Confirm and archive</button>
      <button className="ml-3" disabled={busy} onClick={()=>{setPending(null);setConfirmed(false);}}>Cancel</button>
    </div>}
    {status&&<p role="status" className="mt-2">{status}</p>}
    {preview&&<ArchiveViewer archive={preview} onClose={()=>setPreview(null)}/>}
  </details>;
}
