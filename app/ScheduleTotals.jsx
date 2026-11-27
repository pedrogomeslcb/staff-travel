'use client';
import {useId,useState} from 'react';
import {BriefcaseBusiness,ChevronDown} from 'lucide-react';
import {SCHEDULE_CATEGORIES} from '../lib/planner.mjs';
import {summaryRows,reportScope} from '../lib/schedule-report-scope.mjs';
const number=value=>value.toLocaleString('en-US',{maximumFractionDigits:1});
const grouped=[
  ['Onsite',['onsite','onsite-half']],
  ['Offsite',['remote','offsite-half']],
  ['F-Day',['off']],['Vacation',['vacation']],['Other',['other']],
];
const sum=(counts,keys)=>keys.reduce((n,key)=>n+(counts[key]||0),0);
export default function ScheduleTotals({rows,allRows,ownRow,user,scope,categories,year,month,tags,open,onToggle}) {
  const [view,setView]=useState('monthly'),[expanded,setExpanded]=useState(false);
  const detailId=useId();
  const monthShort=new Date(year,month-1,1).toLocaleDateString('en-US',{month:'short'});
  const monthName=new Date(year,month-1,1).toLocaleDateString('en-US',{month:'long'});
  const teamView=reportScope(user,scope)==='team';
  const selected=summaryRows(user,scope,allRows,ownRow),available=teamView||Boolean(ownRow);
  const monthlyTotal=selected.reduce((n,row)=>n+row.monthlyTotal,0),annualTotal=selected.reduce((n,row)=>n+row.annualTotal,0);
  const columns=(expanded?SCHEDULE_CATEGORIES.map(([key,label,color])=>({label,keys:[key],color})):grouped.map(([label,keys])=>({label,keys,color:SCHEDULE_CATEGORIES.find(c=>c[0]===keys[0])?.[2]}))).filter(c=>c.keys.some(k=>categories.includes(k)));
  const filtered=rows.length!==allRows.length||categories.length!==SCHEDULE_CATEGORIES.length;
  const selectedPeriod=view==='monthly'?monthName+' '+year:String(year);
  return <>
    <article className={'order-1 min-w-0 flex flex-col rounded-xl border bg-white '+(open?'border-blue-300':'border-slate-200')}>
      <div className="flex items-center gap-2 px-4 pt-4"><BriefcaseBusiness size={18} className="text-slate-500" aria-hidden="true"/><h3 className="text-sm font-semibold text-slate-900">{teamView?'Team man-days':'My man-days'}</h3>{teamView&&<span className="ml-auto text-xs text-slate-500">{allRows.length} members</span>}</div>
      <div className="grid flex-1 grid-cols-2 gap-4 px-4 py-4">
        <div><p className="text-xs text-slate-500">{monthShort} {year}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{available?number(monthlyTotal):'—'}</p></div>
        <div className="border-l pl-4"><p className="text-xs text-slate-500">{year} total</p><p className="mt-1 text-2xl font-semibold tabular-nums text-blue-900">{available?number(annualTotal):'—'}</p></div>
      </div>
      <p className="px-4 pb-3 text-xs text-slate-500">{available?'Onsite + Offsite · Half-days count as 0.5':'No personal Schedule row'}</p>
      <button type="button" aria-expanded={open} aria-controls={detailId} onClick={onToggle} className="mt-auto flex w-full items-center justify-between rounded-b-xl border-t px-4 py-2.5 text-left text-xs font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-700">{open?'Hide man-day details':'View man-days by person'}<ChevronDown size={16} className={open?'rotate-180':''} aria-hidden="true"/></button>
    </article>
    <section id={detailId} hidden={!open} className="order-2 min-w-0 overflow-hidden rounded-xl border bg-white sm:col-span-2" aria-label="Man-days by person">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div><h3 className="text-sm font-semibold text-slate-900">Man-days by person</h3><p className="mt-0.5 text-xs text-slate-500">{selectedPeriod} · {rows.length} members{filtered?' · Schedule filters applied':''}</p></div>
        <div className="flex flex-wrap items-center gap-2"><div className="inline-flex rounded-lg bg-slate-100 p-1" aria-label="Man-day detail period">{[['monthly',monthShort],['annual',String(year)]].map(([value,label])=><button type="button" key={value} aria-pressed={view===value} onClick={()=>setView(value)} className={'rounded-md px-3 py-1.5 text-xs font-medium '+(view===value?'bg-white shadow-sm text-blue-900':'text-slate-600')}>{label}</button>)}</div><label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={expanded} onChange={e=>setExpanded(e.target.checked)}/>Full/half-day detail</label></div>
      </header>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={'Man-days by person · '+selectedPeriod}>
        <table className="w-full text-left text-xs">
          <thead className="border-y bg-slate-50 text-slate-600"><tr><th scope="col" className="sticky left-0 z-10 min-w-40 bg-slate-50 px-4 py-3">Team member</th><th scope="col" className="min-w-24 whitespace-nowrap bg-blue-50 px-3 py-3 text-right text-blue-900">Man-days</th>{columns.map(col=><th scope="col" key={col.label} className="min-w-20 whitespace-nowrap px-3 py-3 text-right"><span className="mr-1.5 inline-block size-2 rounded-sm" style={{backgroundColor:col.color}} aria-hidden="true"/>{col.label}</th>)}</tr></thead>
          <tbody className="divide-y">{rows.map(row=>{const tag=tags.find(t=>t.id===row.person.tagId);return <tr key={row.person.id}><th scope="row" className="sticky left-0 z-10 bg-white px-4 py-2.5 font-medium text-slate-900"><span className="block">{row.person.name}</span><span className="mt-0.5 block text-[11px] font-normal text-slate-500">{tag&&<span className="mr-1.5 inline-block size-2 rounded-full" style={{backgroundColor:tag.color}} aria-hidden="true"/>}{tag?.name||'Unassigned'}</span></th><td className="bg-blue-50/40 px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-blue-900">{number(view==='monthly'?row.monthlyTotal:row.annualTotal)}</td>{columns.map(col=>{const value=sum(row[view],col.keys.filter(k=>categories.includes(k)));return <td key={col.label} className="px-3 py-2.5 text-right tabular-nums text-slate-700">{value?number(value):<span className="text-slate-400">—</span>}</td>})}</tr>;})}{!rows.length&&<tr><td colSpan={columns.length+2} className="p-6 text-center text-slate-500">No matching team members.</td></tr>}</tbody>
        </table>
      </div>
    </section>
  </>;
}
