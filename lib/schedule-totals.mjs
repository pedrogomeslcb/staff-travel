import {SCHEDULE_BLANK,SCHEDULE_STATUSES,isWeekend,parse,display} from './planner.mjs';

const weights={'onsite-half':0.5,'offsite-half':0.5};
const emptyCounts=()=>Object.fromEntries(SCHEDULE_STATUSES.map(s=>[s,0]));
const validDate=value=>typeof value==='string'&&parse(display(value))===value;

// Count each weekday once. Manual entries override overlapping hotel stays.
export function summarizeSchedule(people,schedule,presence,{year,month,categories=SCHEDULE_STATUSES}) {
  if(!Number.isInteger(year)||year<1900||year>9999||!Number.isInteger(month)||month<1||month>12)throw new RangeError('Choose a valid schedule year and month.');
  const selected=new Set(categories.filter(s=>SCHEDULE_STATUSES.includes(s))),ranges=new Map();
  for(const stay of presence) {
    if(stay.canceledAt)continue;
    if(!validDate(stay.checkin)||!validDate(stay.checkout)||stay.checkin>=stay.checkout)continue;
    if(stay.checkout<`${year}-01-01`||stay.checkin>`${year}-12-31`)continue;
    if(!ranges.has(stay.userId))ranges.set(stay.userId,[]);
    ranges.get(stay.userId).push([stay.checkin,stay.checkout]);
  }
  const dates=[];
  for(let m=1;m<=12;m++)for(let d=1;d<=new Date(Date.UTC(year,m,0)).getUTCDate();d++) {
    const date=`${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if(!isWeekend(date))dates.push({date,month:m});
  }
  return people.map(person=>{
    const monthly=emptyCounts(),annual=emptyCounts(),stays=ranges.get(person.id)||[];
    for(const day of dates) {
      const manual=schedule[person.id+'|'+day.date]?.status;
      if (manual===SCHEDULE_BLANK) continue;
      const status=SCHEDULE_STATUSES.includes(manual)?manual:stays.some(([a,b])=>a<=day.date&&day.date<=b)?'onsite':null;
      if(!status)continue;
      const weight=weights[status]??1;
      annual[status]+=weight;
      if(day.month===month)monthly[status]+=weight;
    }
    return {person,monthly,annual,monthlyTotal:[...selected].reduce((n,s)=>n+monthly[s],0),annualTotal:[...selected].reduce((n,s)=>n+annual[s],0)};
  });
}
