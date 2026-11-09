'use client';

import {useEffect,useState} from 'react';
import {catalogReferences} from '../lib/database.mjs';
import Dialog from './Dialog';

const sections=[
  ['flights','Flights'],['memberships','IHG'],['drivers','Drivers'],['access','Users & access'],
];
const fields={
  flights:[
    ['flightNumber','Flight number'],['origin','Departure airport'],['departure','Departure time'],
    ['destination','Arrival airport'],['arrival','Arrival time'],
  ],
  memberships:[['name','Staff'],['membership','Membership number']],
  drivers:[['name','Driver'],['licensePlate','License plate'],['contact','Contact']],
};
const outline='rounded-lg border px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50';
const input='mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800';

export default function Database({database,shared,trips,onReferences,children}) {
  const [section,setSection]=useState('flights'),[catalog,setCatalog]=useState(null);
  const visibleSections=children?sections:sections.filter(([key])=>key!=='access');
  const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[reload,setReload]=useState(0);
  const [editor,setEditor]=useState(null),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');
  useEffect(()=>{
    let active=true;
    async function load() {
      setLoading(true);setLoadError('');
      try {
        if(!shared)await database.capture(trips);
        const data=await database.read();
        if(active){setCatalog(data);onReferences(await database.references());}
      }catch(error){if(active){setCatalog(null);setLoadError(error.message);}}
      finally {if(active)setLoading(false);}
    }
    load();
    return ()=>{active=false;};
  },[database,shared,trips,reload,onReferences]);
  function open(row=null) {
    const draft=Object.fromEntries(fields[section].map(([key])=>[key,row?.[key]??'']));
    setEditor({id:row?.id??null,draft,revision:catalog.revision});
    setSaveError('');
  }
  async function save(event) {
    event.preventDefault();
    if(saving)return;
    setSaving(true);setSaveError('');
    try {
      const next=await database.save(section,editor.id,editor.draft,editor.revision);
      setCatalog(next);onReferences(await database.references());setEditor(null);
    }catch(error){setSaveError(error.message);}
    finally {setSaving(false);}
  }
  const label=sections.find(([value])=>value===section)[1];
  const columns=fields[section]??[];
  const rows=[...(catalog?.[section]??[])].sort((a,b)=>String(a[columns[0]?.[0]]).localeCompare(String(b[columns[0]?.[0]]),'en-US',{numeric:true,sensitivity:'base'}));
  return <div className="space-y-4">
    <nav aria-label="Database sections" className="flex flex-wrap gap-2">
      {visibleSections.map(([value,text])=><button type="button" key={value} aria-current={section===value?'page':undefined}
        className={'rounded-lg px-3 py-2 text-sm '+(section===value?'bg-slate-200 font-medium text-slate-900':'text-slate-600 hover:bg-slate-100')}
        onClick={()=>setSection(value)}>{text}</button>)}
    </nav>
    {section==='access'?children:<section className="overflow-hidden rounded-xl border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div><h2 className="font-semibold text-slate-900">{label}</h2>
          {section==='memberships'&&<p className="mt-1 text-xs text-slate-600">New staff are added when they provide a membership number in a hotel request.</p>}
          {section==='flights'&&<p className="mt-1 text-xs text-slate-600">Flight references for hotel requests. Times use the airport’s local time.</p>}
        </div>
        <div className="flex gap-2">
          <button type="button" className={outline} disabled={loading} onClick={()=>setReload(value=>value+1)}>Refresh</button>
          {<button type="button" className={outline} disabled={!catalog||loading||!!loadError} onClick={()=>open()}>Add entry</button>}
        </div>
      </div>
      {loading&&<p role="status" className="px-4 pb-4 text-sm text-slate-600">Loading database…</p>}
      {loadError&&<p role="alert" className="px-4 pb-4 text-sm text-red-700">{loadError}</p>}
      {catalog&&<div className="overflow-x-auto"><table className="w-full text-left text-sm" aria-label={label}>
        <thead className="border-y bg-slate-50"><tr>
          {columns.map(([key,text])=><th scope="col" className="whitespace-nowrap px-4 py-2 text-xs text-slate-600" key={key}>{text}</th>)}
          {section==='drivers'&&<th scope="col" className="px-4 py-2 text-xs text-slate-600">Seats</th>}
          <th scope="col" className="px-4 py-2 text-xs text-slate-600">Actions</th>
        </tr></thead>
        <tbody className="divide-y">{rows.map(row=><tr key={row.id}>
          {columns.map(([key],index)=>index===0?<th scope="row" className="whitespace-nowrap px-4 py-2 font-medium" key={key}>{row[key]}</th>
            :<td className="whitespace-nowrap px-4 py-2 text-slate-700" key={key}>{row[key]}</td>)}
          {section==='drivers'&&<td className="px-4 py-2">{row.capacity}</td>}
          <td className="px-4 py-2"><button type="button" className="rounded px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
            aria-label={'Edit '+row[columns[0][0]]} disabled={loading||!!loadError} onClick={()=>open(row)}>Edit</button></td>
        </tr>)}</tbody>
      </table>{!rows.length&&!loading&&<p className="p-4 text-sm text-slate-600">No entries yet.</p>}</div>}
    </section>}
    {editor&&<Dialog title={editor.id?'Edit database entry':'Add database entry'} onClose={()=>{if(!saving)setEditor(null);}} wide>
      <form onSubmit={save} className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {columns.map(([key,text])=><label key={key} className="text-xs text-slate-600">{text}
            <input className={input} required maxLength={key==='membership'?64:120}
              placeholder={key==='departure'||key==='arrival'?'HH:MM':undefined}
              value={editor.draft[key]} onChange={event=>setEditor(previous=>({...previous,draft:{...previous.draft,[key]:event.target.value}}))}/>
          </label>)}
        </div>
        {saveError&&<p role="alert" className="text-sm text-red-700">{saveError}</p>}
        <div className="flex gap-3">
          <button disabled={saving} className="rounded-lg bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50">{saving?'Saving…':'Save changes'}</button>
          <button type="button" disabled={saving} className="px-3 py-2 text-sm" onClick={()=>setEditor(null)}>Cancel</button>
        </div>
      </form>
    </Dialog>}
  </div>;
}
