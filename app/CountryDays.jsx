import {useMemo} from 'react';
import {ChevronDown,Globe} from 'lucide-react';
import {iso} from '../lib/planner.mjs';
import {reportScope,summaryRows} from '../lib/schedule-report-scope.mjs';
import {annualLimit,countryMonths,yearCounts,countryYearBreakdown} from '../lib/country-days.mjs';

function Allowance({total,completed,planned,remaining}){
  const percent=days=>Math.min(100,Math.max(0,days/annualLimit*100))+'%';
  const status=remaining<0?(-remaining)+' days over':remaining===0?'Limit reached':remaining+' days left';
  const tone=total>annualLimit?'text-red-700':total>=75?'text-amber-800':'text-slate-600';
  return <div className="min-w-32 space-y-1.5"><div className="flex items-baseline justify-between gap-2"><span className="font-semibold tabular-nums text-slate-900">{total} / {annualLimit}</span><span className={'text-[11px] font-medium whitespace-nowrap '+tone}>{status}</span></div><div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={completed+' completed, '+planned+' planned, '+status}><div className="h-full shrink-0 bg-slate-600" style={{width:percent(completed)}}/><div className={'h-full shrink-0 '+(total>=75?'bg-amber-400':'bg-blue-300')} style={{width:percent(Math.min(planned,Math.max(0,annualLimit-completed)))}}/></div></div>;
}
export default function CountryDays({people,team,user,scope,ownTrips,trips,period,limited}){
  const counts=useMemo(()=>countryMonths(trips),[trips]);
  const today=iso(new Date());
  const month=new Date(period.year,period.month-1,1).toLocaleDateString('en-US',{month:'short'});
  const allRows=useMemo(()=>team.map(person=>({person,month:yearCounts(counts.get(person.id),period.year)[period.month-1],...countryYearBreakdown(trips,person.id,period.year,today)})),[team,trips,counts,period.year,period.month,today]);
  const rows=useMemo(()=>{const ids=new Set(people.map(p=>p.id));return allRows.filter(row=>ids.has(row.person.id));},[allRows,people]);
  const ownRow=useMemo(()=>{
    const ownCounts=countryMonths(ownTrips);
    return {person:user,month:yearCounts(ownCounts.get(user.id),period.year)[period.month-1],...countryYearBreakdown(ownTrips,user.id,period.year,today)};
  },[ownTrips,user,period.year,period.month,today]);
  const teamView=reportScope(user,scope)==='team'&&!limited;
  const selected=summaryRows(user,teamView?'team':'my',allRows,ownRow);
  const monthlyTotal=selected.reduce((n,row)=>n+row.month,0);
  const annualTotal=selected.reduce((n,row)=>n+row.total,0);
  const reached=selected.filter(r=>r.total>=annualLimit).length;
  return <details className="group overflow-hidden rounded-xl border bg-white" aria-label="Days in country">
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-4 px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden">
      <div className="flex min-w-0 flex-1 items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600"><Globe size={18} aria-hidden="true"/></span><div><h2 className="text-sm font-semibold text-slate-900">{teamView?'Team days in country':'My days in country'}</h2><p className="mt-0.5 text-xs text-slate-500">{teamView?allRows.length+' '+(allRows.length===1?'team member':'team members')+' · Individual '+annualLimit+'-day allowance':annualLimit+'-day annual allowance'}{limited?' · Personal data only':''}</p></div></div>
      <div className="flex flex-wrap items-center gap-3 sm:gap-5"><div><p className="text-xs text-slate-500">{month} {period.year}</p><p className="text-lg font-semibold tabular-nums text-slate-900">{monthlyTotal}</p></div><div><p className="text-xs text-slate-500">{period.year} total</p><p className="text-lg font-semibold tabular-nums text-blue-900">{annualTotal}{!teamView&&<span className="text-xs font-normal text-slate-500"> / {annualLimit}</span>}</p></div>{teamView?<div><p className="text-xs text-slate-500">At / over limit</p><p className={'text-lg font-semibold tabular-nums '+(reached?'text-red-700':'text-slate-900')}>{reached}</p></div>:<div><p className="text-xs text-slate-500">{ownRow.remaining<0?'Days over':'Days left'}</p><p className={'text-lg font-semibold tabular-nums '+(ownRow.remaining<0?'text-red-700':ownRow.total>=75?'text-amber-800':'text-slate-900')}>{Math.abs(ownRow.remaining)}</p></div>}<ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true"/></div>
    </summary>
    <div className="border-t">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"><p className="max-w-xl text-xs leading-relaxed text-slate-600">Arrival to departure, including weekends. Overlaps count once; canceled trips are excluded. Totals ignore calendar filters.</p><div className="flex gap-3 text-xs text-slate-600"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-slate-600"/>Completed</span><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-blue-300"/>Planned</span></div></div>
      {limited&&<p role="status" className="mx-4 mb-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">Team flight data unavailable. Showing your trips only.</p>}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Annual country-day allowance by person">
        <table className="w-full text-xs text-left"><thead className="border-y bg-slate-50 text-slate-600"><tr>{['Team member',month+' '+period.year,'Completed','Planned','Annual allowance · '+period.year].map((label,i)=><th scope="col" className={'px-4 py-3 '+(i===0?'min-w-36':i===4?'min-w-52':'text-right whitespace-nowrap')} key={label}>{label}</th>)}</tr></thead>
          <tbody className="divide-y">{rows.map(row=><tr key={row.person.id}><th scope="row" className="px-4 py-3 font-medium text-slate-900">{row.person.name}</th><td className="px-4 py-3 text-right tabular-nums text-slate-700">{row.month}</td><td className="px-4 py-3 text-right tabular-nums text-slate-700">{row.completed}</td><td className="px-4 py-3 text-right tabular-nums text-slate-700">{row.planned}</td><td className="px-4 py-3"><Allowance {...row}/></td></tr>)}{!rows.length&&<tr><td colSpan={5} className="p-6 text-center text-slate-500">No team members match the filters.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  </details>;
}
