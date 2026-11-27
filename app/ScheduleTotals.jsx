'use client';
import {useState} from 'react';
import {ChevronDown,BriefcaseBusiness} from 'lucide-react';
import {SCHEDULE_CATEGORIES} from '../lib/planner.mjs';
import {summaryRows,reportScope} from '../lib/schedule-report-scope.mjs';
const number=value=>value.toLocaleString('en-US',{maximumFractionDigits:1});
const grouped=[
  ['Onsite',['onsite','onsite-half']],
  ['Offsite',['remote','offsite-half']],
  ['F-Day',['off']],['Vacation',['vacation']],['Other',['other']],
];
const sum=(counts,keys)=>keys.reduce((n,key)=>n+(counts[key]||0),0);
export default function ScheduleTotals({rows,allRows,ownRow,user,scope,categories,year,month,tags}) {
  const [view,setView]=useState('monthly'),[expanded,setExpanded]=useState(false);
  const monthName=new Date(year,month-1,1).toLocaleDateString('en-US',{month:'long'});
  const monthShort=new Date(year,month-1,1).toLocaleDateString('en-US',{month:'short'});
  const teamView=reportScope(user,scope)==='team';
  const selected=summaryRows(user,scope,allRows,ownRow);
  const available=teamView||Boolean(ownRow);
  const monthlyTotal=selected.reduce((n,row)=>n+row.monthlyTotal,0),annualTotal=selected.reduce((n,row)=>n+row.annualTotal,0);
  const columns=(expanded?SCHEDULE_CATEGORIES.map(([key,label,color])=>({label,keys:[key],color})):grouped.map(([label,keys])=>({label,keys,color:SCHEDULE_CATEGORIES.find(c=>c[0]===keys[0])?.[2]}))).filter(c=>c.keys.some(k=>categories.includes(k)));
  return <details className="group rounded-xl border bg-white overflow-hidden" aria-label="Schedule man-days">
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-4 px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden">
      <div className="flex min-w-0 flex-1 items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600"><BriefcaseBusiness size={18} aria-hidden="true"/></span><div><h2 className="text-sm font-semibold text-slate-900">{teamView?'Team man-days':'My man-days'}</h2><p className="mt-0.5 text-xs text-slate-500">{teamView?'Working days · '+allRows.length+' '+(allRows.length===1?'team member':'team members'):available?'Your working days':'No personal Schedule row'}</p></div></div>
      <div className="flex items-center gap-4 sm:gap-6"><div><p className="text-xs text-slate-500">{monthShort} {year}</p><p className="text-lg font-semibold tabular-nums text-slate-900">{available?number(monthlyTotal):'—'}</p></div><div><p className="text-xs text-slate-500">{year} total</p><p className="text-lg font-semibold tabular-nums text-blue-900">{available?number(annualTotal):'—'}</p></div><ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true"/></div>
    </summary>
    <div className="border-t">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <p className="max-w-xl text-xs leading-relaxed text-slate-600">Man-days = Onsite + Offsite weekdays (half-days = 0.5). Filters apply to the breakdown only.</p>
        <div className="flex flex-wrap items-center gap-2"><div className="inline-flex rounded-lg bg-slate-100 p-1" aria-label="Breakdown period">{[['monthly',monthShort],['annual',String(year)]].map(([value,label])=><button type="button" key={value} aria-pressed={view===value} onClick={()=>setView(value)} className={'rounded-md px-3 py-1.5 text-xs font-medium '+(view===value?'bg-white shadow-sm text-blue-900':'text-slate-600')}>{label}</button>)}</div><button type="button" aria-pressed={expanded} onClick={()=>setExpanded(v=>!v)} className="rounded-lg border px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">{expanded?'Group categories':'Show half-day detail'}</button></div>
      </div>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Man-days and category breakdown">
        <table className="w-full text-left text-xs" aria-label="Monthly and annual man-days">
          <thead className="border-y bg-slate-50 text-slate-600"><tr><th rowSpan={2} scope="col" className="sticky left-0 z-10 min-w-[10rem] bg-slate-50 px-4 py-3">Team member</th><th colSpan={2} scope="colgroup" className="border-l border-r bg-blue-50 px-3 py-2 text-center text-blue-900">Man-days total</th>{columns.length>0&&<th colSpan={columns.length} scope="colgroup" className="px-3 py-2 text-center">Category breakdown · {view==='monthly'?monthName+' ':''}{year}</th>}</tr><tr><th scope="col" className="min-w-24 border-l bg-blue-50 px-3 py-2 text-right">{monthShort} {year}</th><th scope="col" className="min-w-24 border-r bg-blue-50 px-3 py-2 text-right">{year}</th>{columns.map(c=><th scope="col" key={c.label} className="min-w-20 px-3 py-2 text-right"><span className="inline-block size-2 rounded-sm mr-1.5" style={{backgroundColor:c.color}} aria-hidden="true"/>{c.label}</th>)}</tr></thead>
          <tbody className="divide-y">{rows.map(row=>{const tag=tags.find(t=>t.id===row.person.tagId);return <tr key={row.person.id}><th scope="row" className="sticky left-0 z-10 bg-white px-4 py-2.5 font-medium text-slate-900"><span className="block">{row.person.name}</span><span className="mt-0.5 block text-[11px] font-normal text-slate-500">{tag&&<span className="mr-1.5 inline-block size-2 rounded-full" style={{backgroundColor:tag.color}} aria-hidden="true"/>}{tag?.name||'Unassigned'}</span></th><td className="border-l bg-blue-50/40 px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-blue-900">{number(row.monthlyTotal)}</td><td className="border-r bg-blue-50/40 px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-blue-900">{number(row.annualTotal)}</td>{columns.map(c=>{const value=sum(row[view],c.keys.filter(k=>categories.includes(k)));return <td className="px-3 py-2.5 text-right tabular-nums text-slate-700" key={c.label}>{value?number(value):<span className="text-slate-400">—</span>}</td>})}</tr>;})}{!rows.length&&<tr><td colSpan={columns.length+3} className="p-6 text-center text-slate-500">No team members match the filters.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  </details>;
}
