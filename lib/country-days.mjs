import {display,parse} from './planner.mjs';

export const annualLimit=90;
const dayMs=86400000;
export function validDay(date){
  return typeof date==='string' && parse(display(date))===date;
}
// Merge intervals before allocating them to months. Flight dates are local calendar dates.
export function countryMonths(trips){
  const intervals=new Map(), result=new Map();
  for(const {userId,outDate,returnDate,canceledAt} of trips){
    if(canceledAt || !validDay(outDate) || !validDay(returnDate) || returnDate<outDate)continue;
    if(!intervals.has(userId))intervals.set(userId,[]);
    intervals.get(userId).push([Date.parse(outDate),Date.parse(returnDate)]);
  }
  for(const [id,ranges] of intervals){
    const months=new Map();
    let last=-Infinity;
    for(const [start,end] of ranges.sort((a,b)=>a[0]-b[0])){
      for(let cursor=Math.max(last+dayMs,start);cursor<=end;){
        const date=new Date(cursor);
        const next=Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1);
        const thru=Math.min(next,end+dayMs);
        const key=date.toISOString().slice(0,7);
        months.set(key,(months.get(key)||0)+(thru-cursor)/dayMs);
        cursor=thru;
      }
      last=Math.max(last,end);
    }
    result.set(id,months);
  }
  return result;
}
export function yearCounts(months,year){
  return Array.from({length:12},(_,i)=>months?.get(year+'-'+String(i+1).padStart(2,'0'))||0);
}

/** Inclusive local calendar days; today's day is used, future dates are planned. */
export function countryYearBreakdown(trips,userId,year,today){
  const own=trips.filter(t=>t.userId===userId);
  const used=own.filter(t=>validDay(t.outDate)&&t.outDate<=today).map(t=>({...t,returnDate:t.returnDate>today?today:t.returnDate}));
  const total=yearCounts(countryMonths(own).get(userId),year).reduce((a,b)=>a+b,0);
  const completed=yearCounts(countryMonths(used).get(userId),year).reduce((a,b)=>a+b,0);
  return {completed,planned:total-completed,total,remaining:annualLimit-total};
}
