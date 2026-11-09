import {SCHEDULE_STATUSES,iso,resolveScheduleDay} from './planner.mjs';
export const WEEKEND_COLOR='#F1F5F9';
export function schedulePeople(people,tags=[]) {
  const tagNames=new Map(tags.map(t=>[t.id,t.name])),collator=new Intl.Collator('en-US',{sensitivity:'base',numeric:true});
  return people.filter(person=>!person.deletedAt&&person.isPrimaryAdmin!==true&&(person.isPrimaryAdmin===false||person.name.trim().toLowerCase()!=='admin')).sort((a,b)=>{
    const x=tagNames.get(a.tagId),y=tagNames.get(b.tagId);
    if(!x&&y)return 1;if(x&&!y)return -1;
    return collator.compare(x||'',y||'')||collator.compare(a.name,b.name)||String(a.id).localeCompare(String(b.id));
  });
}
export function timelineMonths(start,count) {
  return Array.from({length:count},(_,offset)=>{
    const month=new Date(start.getFullYear(),start.getMonth()+offset,1);
    const dates=Array.from({length:new Date(month.getFullYear(),month.getMonth()+1,0).getDate()},(_,i)=>iso(new Date(month.getFullYear(),month.getMonth(),i+1)));
    return {key:iso(month).slice(0,7),label:month.toLocaleDateString('en-US',{month:'long',year:'numeric'}),dates};
  });
}

export function scheduleDayGroups(people,schedule,presence,date,{category='all',sector='all'}={}) {
  const groups=new Map([...SCHEDULE_STATUSES,'unplanned'].map(status=>[status,[]]));
  for (const person of people) {
    const matchesSector=sector==='all'||(sector==='unassigned'?!person.tagId:person.tagId===sector);
    if (!matchesSector) continue;
    const status=resolveScheduleDay(schedule,presence,person.id,date)?.status??'unplanned';
    groups.get(status).push(person);
  }
  const matching=category==='onsite-any'?['onsite','onsite-half']:category==='offsite-any'?['remote','offsite-half']:[category];
  return [...groups].filter(([status,members])=>members.length&&(category==='all'||matching.includes(status)));
}

export function timelineLayout(months,viewportWidth) {
  const minimumMonthWidth=31*18;
  const nameWidth=Math.max(92,Math.min(168,Math.round(viewportWidth*0.15),viewportWidth-minimumMonthWidth));
  const visibleDayWidth=viewportWidth-nameWidth;
  const monthWidth=Math.max(minimumMonthWidth,visibleDayWidth);
  const dayWidths=months.map(({dates})=>{
    const base=Math.floor(monthWidth/dates.length),remainder=monthWidth%dates.length;
    return dates.map((_,index)=>base+(index<remainder?1:0));
  });
  return {nameWidth,visibleDayWidth,monthWidth,dayWidths};
}

export function timelineMonthOffset(monthIndex,dayWidths,dayIndex,visibleDayWidth) {
  const monthWidth=dayWidths.reduce((sum,width)=>sum+width,0);
  const dayEnd=dayWidths.slice(0,dayIndex+1).reduce((sum,width)=>sum+width,0);
  const revealDay=dayIndex>0?Math.max(0,dayEnd-visibleDayWidth):0;
  return monthIndex*monthWidth+revealDay;
}

export function dampMonthScroll(scrollLeft,delta,boundaries,buffer) {
  const direction=Math.sign(delta);
  if (!direction) return 0;
  let position=scrollLeft*direction,remaining=Math.abs(delta);
  const speed=0.45;
  for (let index=direction>0?0:boundaries.length-1;index>=0&&index<boundaries.length;index+=direction) {
    const center=boundaries[index]*direction,end=center+buffer;
    if (position>=end) continue;
    const approach=Math.max(0,center-buffer-position);
    if (remaining<=approach) break;
    position+=approach;
    remaining-=approach;
    const inside=Math.min(remaining*speed,end-position);
    position+=inside;
    remaining=Math.max(0,remaining-inside/speed);
  }
  return (position+remaining)*direction-scrollLeft;
}
