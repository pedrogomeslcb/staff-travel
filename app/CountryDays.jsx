import {useMemo} from 'react';
import {annualLimit,countryMonths,yearCounts} from '../lib/country-days.mjs';

export default function CountryDays({people,trips,period,limited}){
  const counts=useMemo(()=>countryMonths(trips),[trips]);
  const month=new Date(period.year,period.month-1,1).toLocaleDateString('en-US',{month:'short'});
  return <details className="rounded-xl border bg-white p-4 text-sm">
    <summary className="cursor-pointer font-semibold">Days in country · {period.year}</summary>
    <p className="my-3 text-xs text-slate-600">Based on active flight dates, including planned trips, weekends, arrival and departure days. Overlapping dates count once.</p>
    {limited&&<p role="status">Only your own flight dates are available until team flight dates are enabled.</p>}
    <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{['Team member',month,String(period.year),'Annual allowance'].map(label=><th className="p-2" key={label}>{label}</th>)}</tr></thead>
    <tbody>{people.map(person=>{
      const months=yearCounts(counts.get(person.id),period.year);
      const total=months.reduce((a,b)=>a+b,0);
      return <tr className="border-t" key={person.id}><th scope="row" className="p-2">{person.name}</th><td className="p-2">{months[period.month-1]}</td><td className="p-2">{total}</td><td className={'p-2 '+(total>=annualLimit?'font-semibold text-amber-800':'')}>{total>annualLimit?(total-annualLimit)+' over limit':total===annualLimit?'90-day limit reached':(annualLimit-total)+' days left'}</td></tr>;
    })}</tbody></table></div>
  </details>;
}
