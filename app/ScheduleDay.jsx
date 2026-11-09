'use client';

import {useState} from 'react';
import {SCHEDULE_CATEGORIES,display,isWeekend,resolveScheduleDay} from '../lib/planner.mjs';
import {scheduleDayGroups} from '../lib/timeline.mjs';
import Dialog from './Dialog';

const categories=[...SCHEDULE_CATEGORIES,['unplanned','No entry','#94A3B8']];
const categoryDetails=new Map(categories.map(([status,label,color])=>[status,{label,color}]));
const select='mt-1 w-full rounded-lg border bg-white px-2.5 py-2 text-sm text-slate-800';

export default function ScheduleDay({date,people,tags,schedule,presence,userId,onClose}) {
  const isTeamMember=people.some(person=>person.id===userId);
  const ownStatus=(isTeamMember&&resolveScheduleDay(schedule,presence,userId,date)?.status)||'unplanned';
  const [category,setCategory]=useState(()=>['onsite','onsite-half'].includes(ownStatus)?'onsite-any':'all');
  const [sector,setSector]=useState('all');
  const weekend=isWeekend(date);
  const weekday=new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'long',timeZone:'UTC'});
  const groups=weekend?[]:scheduleDayGroups(people,schedule,presence,date,{category,sector});
  const count=groups.reduce((sum,[,members])=>sum+members.length,0);
  const tagsById=new Map(tags.map(tag=>[tag.id,tag]));
  return <Dialog wide title={'Team schedule · '+display(date)} onClose={onClose}>
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <p>{weekday}</p>
        {!weekend&&isTeamMember&&<p>Your schedule <strong className="font-semibold text-slate-900">{categoryDetails.get(ownStatus).label}</strong></p>}
      </div>
      {weekend?<p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">The team schedule covers weekdays.</p>:<>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600">Schedule category
            <select className={select} value={category} onChange={event=>setCategory(event.target.value)}>
              <option value="all">All categories</option>
              <option value="onsite-any">Onsite (full or half day)</option>
              <option value="offsite-any">Offsite (full or half day)</option>
              {categories.map(([value,label])=><option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">Sector
            <select className={select} value={sector} onChange={event=>setSector(event.target.value)}>
              <option value="all">All sectors</option>
              {[...tags].sort((a,b)=>a.name.localeCompare(b.name)).map(tag=><option key={tag.id} value={tag.id}>{tag.name}</option>)}
              <option value="unassigned">Unassigned</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-slate-600" role="status">{count} {count===1?'team member':'team members'}</p>
        <div className={'grid gap-3 '+(groups.length>1?'sm:grid-cols-2':'')}>
          {groups.map(([status,members])=>{
            const {label,color}=categoryDetails.get(status);
            return <section key={status} className="self-start rounded-lg border">
              <h3 className="flex items-center gap-2 border-b bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                <span aria-hidden="true" className="size-2.5 rounded-sm" style={{backgroundColor:color}}/>{label}
                <span className="ml-auto text-xs font-medium text-slate-500">{members.length}</span>
              </h3>
              <ul className="divide-y">{members.map(person=><li key={person.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
                <span className="break-words font-medium text-slate-800">{person.name}</span>
                {person.id===userId&&<span className="rounded bg-blue-50 px-1.5 text-xs font-medium text-blue-800">You</span>}
                <span className="text-xs text-slate-600">{tagsById.get(person.tagId)?.name||'Unassigned'}</span>
              </li>)}</ul>
            </section>;
          })}
          {!groups.length&&<p className="text-sm text-slate-600">No team members match these filters.</p>}
        </div>
      </>}
    </div>
  </Dialog>;
}
