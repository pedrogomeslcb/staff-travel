import {MAX_SCHEDULE_CHANGES,PlannerError,SCHEDULE_CATEGORIES,display,isWeekend,parse} from './planner.mjs';

const DAY_MS=86400000;
const dateAt=time=>new Date(time).toISOString().slice(0,10);
const dayTime=date=>parse(display(date))===date?Date.parse(date+'T00:00:00Z'):NaN;

export function scheduleWeekdays(start,end) {
  const from=dayTime(start),through=dayTime(end);
  if (!Number.isFinite(from)||!Number.isFinite(through)||through<from) {
    throw new PlannerError('Enter valid dates, with the end date on or after the start date.');
  }
  if ((through-from)/DAY_MS>=MAX_SCHEDULE_CHANGES) {
    throw new PlannerError(`Choose a date range of up to ${MAX_SCHEDULE_CHANGES} calendar days.`);
  }
  const dates=[];
  for (let time=from;time<=through;time+=DAY_MS) {
    const date=dateAt(time);
    if (!isWeekend(date)) dates.push(date);
  }
  if (!dates.length) throw new PlannerError('Choose a range that includes at least one weekday.');
  return dates;
}

const normalize=value=>value.trim().toLowerCase().replace(/[-\s]/g,'');
const clipboardStatuses=new Map(SCHEDULE_CATEGORIES.flatMap(([status,label,,code])=>
  [status,label,code].map(value=>[normalize(value),status])));
for (const [label,status] of [['onsite','onsite'],['offsite','remote'],['day off','off'],['clear','clear'],['','clear']]) {
  clipboardStatuses.set(normalize(label),status);
}

export function schedulePaste(text,start,selectedDates) {
  if (!text) throw new PlannerError('Copy schedule categories before pasting.');
  const rows=text.replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n').map(row=>row.split('\t'));
  if (rows.length>1&&rows.some(row=>row.length>1)) throw new PlannerError('Copy a single row or column of categories.');
  const cells=rows.flat();
  if (cells.length>MAX_SCHEDULE_CHANGES) {
    throw new PlannerError(`Paste up to ${MAX_SCHEDULE_CHANGES} weekdays at a time.`);
  }
  const statuses=cells.map((value,index)=>{
    const status=clipboardStatuses.get(normalize(value));
    if (!status) throw new PlannerError(`Cell ${index+1} does not match a schedule category or code.`);
    return status;
  });
  if (statuses.length===1) return selectedDates.map(date=>({date,status:statuses[0]}));

  const changes=[];
  for (let time=dayTime(start);changes.length<statuses.length;time+=DAY_MS) {
    if (!Number.isFinite(time)||time>Date.UTC(9999,11,31)) throw new PlannerError('The paste goes beyond the calendar.');
    const date=dateAt(time);
    if (!isWeekend(date)) changes.push({date,status:statuses[changes.length]});
  }
  return changes;
}
