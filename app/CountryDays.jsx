import {useId,useMemo} from 'react';
import {ChevronDown,Globe} from 'lucide-react';
import {iso} from '../lib/planner.mjs';
import {reportScope,summaryRows} from '../lib/schedule-report-scope.mjs';
import {annualLimit,countryMonths,yearCounts,countryYearBreakdown} from '../lib/country-days.mjs';
const statusText=remaining=>remaining<0?(-remaining)+' days over':remaining===0?'Limit reached':remaining+' days left';
function AllowanceBar({completed,planned,total}){
  const percent=days=>Math.min(100,Math.max(0,days/annualLimit*100))+'%';
  return <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={completed+' completed, '+planned+' planned, '+statusText(annualLimit-total)}><div className="h-full shrink-0 bg-slate-600" style={{width:percent(completed)}}/><div className={'h-full shrink-0 '+(total>=75?'bg-amber-400':'bg-blue-300')} style={{width:percent(Math.min(planned,Math.max(0,annualLimit-completed)))}}/></div>;
}
function Allowance(row){
  const {total,remaining}=row;
  return <div className="min-w-32 space-y-1.5"><div className="flex items-baseline justify-between gap-2"><span className="font-semibold tabular-nums text-slate-900">{total} / {annualLimit}</span><span className={'whitespace-nowrap text-[11px] font-medium '+(total>annualLimit?'text-red-700':total>=75?'text-amber-800':'text-slate-600')}>{statusText(remaining)}</span></div><AllowanceBar {...row}/></div>;
}
export default function CountryDays({people,team,user,scope,ownTrips,trips,period,limited,open,onToggle}){
  const detailId=useId();
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
  const monthlyTotal=selected.reduce((n,row)=>n+row.month,0),annualTotal=selected.reduce((n,row)=>n+row.total,0);
  const reached=selected.filter(row=>row.total>=annualLimit).length;
  return <>
    <article className={'order-1 min-w-0 flex flex-col rounded-xl border bg-white '+(open?'border-blue-300':'border-slate-200')}>
      <div className="flex items-center gap-2 px-4 pt-4"><Globe size={18} className="text-slate-500" aria-hidden="true"/><h3 className="text-sm font-semibold text-slate-900">{teamView?'Team days in country':'My days in country'}</h3>{teamView&&<span className="ml-auto text-xs text-slate-500">{allRows.length} members</span>}</div>
      <div className="grid grid-cols-2 gap-4 px-4 pt-4 pb-2">
        <div><p className="text-xs text-slate-500">{month} {period.year}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{monthlyTotal}</p></div>
        <div className="border-l pl-4"><p className="text-xs text-slate-500">{period.year} total</p><p className="mt-1 text-2xl font-semibold tabular-nums text-blue-900">{annualTotal}{!teamView&&<span className="ml-1 text-sm font-normal text-slate-500">/ {annualLimit}</span>}</p></div>
      </div>
      <div className="flex-1 px-4 pb-3">{teamView?<p className={'text-xs '+(reached?'font-medium text-amber-800':'text-slate-500')}>{reached} {reached===1?'member':'members'} at / over individual limit</p>:<><div className="mb-1.5 flex flex-wrap justify-between gap-1 text-xs"><span className="text-slate-500">Annual allowance</span><span className={'font-medium '+(ownRow.remaining<0?'text-red-700':ownRow.total>=75?'text-amber-800':'text-slate-700')}>{statusText(ownRow.remaining)}</span></div><AllowanceBar {...ownRow}/></>}{limited&&<p className="mt-1 text-xs text-amber-800">Personal data only</p>}</div>
      <button type="button" aria-expanded={open} aria-controls={detailId} onClick={onToggle} className="mt-auto flex w-full items-center justify-between rounded-b-xl border-t px-4 py-2.5 text-left text-xs font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-700">{open?'Hide country-day details':'View country days by person'}<ChevronDown size={16} className={open?'rotate-180':''} aria-hidden="true"/></button>
    </article>
    <section id={detailId} hidden={!open} className="order-2 min-w-0 overflow-hidden rounded-xl border bg-white sm:col-span-2" aria-label="Days in country by person">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><h3 className="text-sm font-semibold text-slate-900">Days in country by person</h3><p className="mt-0.5 text-xs text-slate-500">Calendar days · {period.year}{rows.length!==allRows.length?' · Schedule filters applied':''}</p></div><div className="flex gap-3 text-xs text-slate-600"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-slate-600"/>Completed</span><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-blue-300"/>Planned</span></div></header>
      {limited&&<p role="status" className="mx-4 mb-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">Team flight data unavailable. Showing your trips only.</p>}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Annual country-day allowance by person"><table className="w-full text-left text-xs"><thead className="border-y bg-slate-50 text-slate-600"><tr>{['Team member',month+' '+period.year,period.year+' completed',period.year+' planned',period.year+' allowance'].map((label,i)=><th scope="col" className={'px-4 py-3 '+(i===0?'min-w-36':i===4?'min-w-52':'text-right whitespace-nowrap')} key={label}>{label}</th>)}</tr></thead><tbody className="divide-y">{rows.map(row=><tr key={row.person.id}><th scope="row" className="px-4 py-3 font-medium text-slate-900">{row.person.name}</th><td className="px-4 py-3 text-right tabular-nums text-slate-700">{row.month}</td><td className="px-4 py-3 text-right tabular-nums text-slate-700">{row.completed}</td><td className="px-4 py-3 text-right tabular-nums text-slate-700">{row.planned}</td><td className="px-4 py-3"><Allowance {...row}/></td></tr>)}{!rows.length&&<tr><td colSpan={5} className="p-6 text-center text-slate-500">No matching team members.</td></tr>}</tbody></table></div>
      <p className="border-t px-4 py-2.5 text-xs text-slate-500">Arrival through departure, including weekends. Overlaps count once; canceled trips excluded.</p>
    </section>
  </>;
}
