import {parse,nightsBetween} from './planner.mjs';
import {annualLimit,countryMonths,yearCounts} from './country-days.mjs';

/** Read-only preview. Archived trips count, canceled trips do not; overlapping dates count once. */
export function tripReview(draft,trips,userId,editing=null){
  const arrival=parse(draft.outDate),departure=parse(draft.returnDate);
  const nights=nightsBetween(draft.checkin,draft.checkout);
  if(!arrival||!departure||departure<arrival)return {days:null,nights,years:[]};
  const days=Math.round((Date.parse(departure)-Date.parse(arrival))/86400000)+1;
  const others=trips.filter(t=>t.userId===userId&&(editing===null||t.id!==editing));
  const before=countryMonths(others).get(userId);
  const after=countryMonths([...others,{userId,outDate:arrival,returnDate:departure}]).get(userId);
  const years=[];
  const old=editing===null?null:trips.find(t=>t.userId===userId&&t.id===editing);
  // Show the new travel years and any old travel years affected by rescheduling.
  const affected=new Set();
  const addYears=(start,end)=>{for(let year=Number(start.slice(0,4));year<=Number(end.slice(0,4));year++)affected.add(year);};
  addYears(arrival,departure);
  if(old?.outDate&&old?.returnDate&&/^\d{4}-\d{2}-\d{2}$/.test(old.outDate)&&/^\d{4}-\d{2}-\d{2}$/.test(old.returnDate))addYears(old.outDate,old.returnDate);
  for(const year of [...affected].sort((a,b)=>a-b)){
    const otherDays=yearCounts(before,year).reduce((sum,days)=>sum+days,0);
    const total=yearCounts(after,year).reduce((sum,days)=>sum+days,0);
    years.push({year,otherDays,additionalDays:total-otherDays,total,remaining:annualLimit-total});
  }
  return {days,nights,years};
}
