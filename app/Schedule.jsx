'use client';

import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {MAX_SCHEDULE_CHANGES,PlannerError,SCHEDULE_BLANK,SCHEDULE_CATEGORIES,iso,display,isWeekend,resolveScheduleDay} from '../lib/planner.mjs';
import {schedulePaste} from '../lib/schedule-edit.mjs';
import {WEEKEND_COLOR,dampMonthScroll,schedulePeople,timelineLayout,timelineMonthOffset,timelineMonths} from '../lib/timeline.mjs';
import {tagTextColor} from '../lib/accounts.mjs';
import {summarizeSchedule} from '../lib/schedule-totals.mjs';
import {Popover,PopoverTrigger,PopoverContent} from '@/components/ui/popover';
import ScheduleTotals from './ScheduleTotals';
import ScheduleDay from './ScheduleDay';

const todayColumnEdge='inset 1px 0 #BFDBFE, inset -1px 0 #BFDBFE';
const initialRange=anchor=>({start:new Date(anchor.getFullYear(),anchor.getMonth()-1,1),count:6,anchor:iso(anchor)});

export default function Schedule({month,setMonth,people,trips,tags=[],presence=trips||[],schedule,user,ready,busy,onEdit,onChange,onUndo,sectorLabel='Sector'}) {
  const today=iso(new Date());
  const [range,setRange]=useState(()=>initialRange(month));
  const [viewportWidth,setViewportWidth]=useState(0);
  const [period,setPeriod]=useState(()=>({year:month.getFullYear(),month:month.getMonth()+1}));
  const [sector,setSector]=useState('all'),[personId,setPersonId]=useState('all');
  const [categories,setCategories]=useState(()=>SCHEDULE_CATEGORIES.map(c=>c[0]));
  const [showCodes,setShowCodes]=useState(false);
  const [selectedDay,setSelectedDay]=useState(null);
  const [focusedDay,setFocusedDay]=useState(null);
  const [selection,setSelection]=useState(null),[selectionMessage,setSelectionMessage]=useState('');
  const dragAnchor=useRef(null);
  const selectionBeforeClick=useRef(null);
  const viewport=useRef(null),prepend=useRef(null),edgeLocked=useRef(false);
  const visibleMonth=useRef(iso(month).slice(0,7)),resizeAnchor=useRef(null),positionedRange=useRef(null);
  const months=useMemo(()=>timelineMonths(range.start,range.count),[range.start,range.count]);
  const dates=useMemo(()=>months.flatMap(m=>m.dates),[months]);
  const {nameWidth,visibleDayWidth,monthWidth,dayWidths}=useMemo(()=>timelineLayout(months,viewportWidth||1100),[months,viewportWidth]);
  const columnWidths=useMemo(()=>dayWidths.flat(),[dayWidths]);
  const monthBoundaries=useMemo(()=>months.slice(1).map((_,index)=>(index+1)*monthWidth),[months,monthWidth]);
  const boundaryBuffer=monthWidth/31;
  const team=useMemo(()=>schedulePeople(people,tags),[people,tags]);
  const available=useMemo(()=>team.filter(p=>sector==='all'||(sector==='unassigned'?!p.tagId:p.tagId===sector)),[team,sector]);
  const members=useMemo(()=>available.filter(p=>personId==='all'||p.id===personId),[available,personId]);
  const canEdit=ready&&!busy&&team.some(p=>p.id===user.id);
  const [start,end]=selection&&members.some(p=>p.id===user.id)?[selection.anchor,selection.end].sort():[];
  const selectedDates=useMemo(()=>start?dates.filter(date=>date>=start&&date<=end&&!isWeekend(date)):[],[dates,start,end]);
  const totals=useMemo(()=>summarizeSchedule(members,schedule,presence,{...period,categories}),[members,schedule,presence,period,categories]);
  const years=[...new Set([...Array.from({length:11},(_,i)=>period.year-5+i),...Object.keys(schedule).map(k=>Number(k.slice(-10,-6))),...presence.flatMap(t=>[Number(String(t.checkin??'').slice(0,4)),Number(String(t.checkout??'').slice(0,4))])])].filter(y=>Number.isInteger(y)&&y>=1900&&y<=9999).sort((a,b)=>a-b);
  const monthStarts=new Set(months.map(m=>m.dates[0]));
  const currentMonth=iso(new Date(period.year,period.month-1,1)).slice(0,7);
  const dayTabStop=focusedDay?.startsWith(currentMonth)?focusedDay:currentMonth+'-01';
  useLayoutEffect(()=>{
    const element=viewport.current;
    let lastWidth=0;
    function measure() {
      const width=element.clientWidth;
      if (!width||width===lastWidth) return;
      lastWidth=width;
      edgeLocked.current=true;
      resizeAnchor.current=visibleMonth.current+'-01';
      setViewportWidth(width);
    }
    measure();
    const observer=new ResizeObserver(measure);
    observer.observe(element);
    return ()=>observer.disconnect();
  },[]);
  useLayoutEffect(()=>{
    setPeriod({year:month.getFullYear(),month:month.getMonth()+1});
    visibleMonth.current=iso(month).slice(0,7);
    edgeLocked.current=true;
    setRange(initialRange(month));
  },[month]);
  useLayoutEffect(()=>{
    const element=viewport.current;
    if(!element||!viewportWidth) return;
    const target=range.anchor&&positionedRange.current!==range?range.anchor:resizeAnchor.current;
    if(target) {
      const index=months.findIndex(month=>month.key===target.slice(0,7));
      if(index>=0) {
        element.scrollLeft=timelineMonthOffset(index,dayWidths[index],Number(target.slice(-2))-1,visibleDayWidth);
      }
    }else if(prepend.current) {
      element.scrollLeft=prepend.current.left+(element.scrollWidth-prepend.current.width);
    }
    positionedRange.current=range;
    resizeAnchor.current=null;
    prepend.current=null;
    edgeLocked.current=false;
  },[range,months,dayWidths,visibleDayWidth,viewportWidth]);
  useEffect(()=>{
    const element=viewport.current;
    let remainder=0,lastPosition,lastDirection;
    function onWheel(event) {
      if (!event.cancelable||event.ctrlKey||event.metaKey) return;
      const mode=event.deltaMode,{deltaX,deltaY}=event;
      if (!event.shiftKey&&Math.abs(deltaX)<=Math.abs(deltaY)) return;
      const unit=mode===1?16:mode===2?element.clientWidth:1;
      const delta=(deltaX||(event.shiftKey?deltaY:0))*unit;
      if (!delta) return;
      const left=element.scrollLeft,direction=Math.sign(delta);
      const adjusted=dampMonthScroll(left,delta,monthBoundaries,boundaryBuffer);
      if (lastPosition!==left||lastDirection!==direction) remainder=0;
      // Handle the whole horizontal gesture so its momentum also slows at the divider.
      event.preventDefault();
      const target=Math.max(0,Math.min(left+adjusted+remainder,element.scrollWidth-element.clientWidth));
      element.scrollLeft=target;
      lastPosition=element.scrollLeft;
      lastDirection=direction;
      remainder=target-lastPosition;
    }
    element.addEventListener('wheel',onWheel,{passive:false});
    return ()=>element.removeEventListener('wheel',onWheel);
  },[monthBoundaries,boundaryBuffer]);
  function extendTimeline(event) {
    const element=event.currentTarget;
    if(edgeLocked.current||element.scrollWidth<=element.clientWidth) return;
    const index=Math.min(months.length-1,Math.max(0,Math.floor((element.scrollLeft+0.5)/monthWidth)));
    const key=months[index].key;
    if(key!==visibleMonth.current) {
      visibleMonth.current=key;
      setPeriod({year:Number(key.slice(0,4)),month:Number(key.slice(5,7))});
    }
    if(element.scrollLeft<120) {
      edgeLocked.current=true;prepend.current={left:element.scrollLeft,width:element.scrollWidth};
      setRange(previous=>({start:new Date(previous.start.getFullYear(),previous.start.getMonth()-3,1),count:previous.count+3}));
    }else if(element.scrollWidth-element.clientWidth-element.scrollLeft<240) {
      edgeLocked.current=true;
      setRange(previous=>({...previous,count:previous.count+3,anchor:null}));
    }
  }
  function jump(date) {
    setSelection(null);
    setSelectionMessage('');
    setMonth(date);
  }
  function fitVisibleMonth() {
    const index=months.findIndex(month=>month.key===visibleMonth.current);
    if(index>=0) viewport.current.scrollLeft=index*monthWidth;
  }
  function selectDate(date,extend=false,from=date) {
    setSelection(previous=>({anchor:extend?(start?previous.anchor:from):date,end:date}));
    setSelectionMessage('');
  }
  function openDateRange(from,to) {
    if (!canEdit) return;
    const defaultDate=period.year===Number(today.slice(0,4))&&period.month===Number(today.slice(5,7))
      ?today:iso(new Date(period.year,period.month-1,1));
    const first=from||defaultDate,last=to||first;
    const entry=first===last?resolveScheduleDay(schedule,presence,user.id,first):null;
    onEdit(first,last,entry?.source==='manual'?entry.status:'');
  }
  function clipboardText() {
    if (selectedDates.length>MAX_SCHEDULE_CHANGES) throw new Error(`Copy up to ${MAX_SCHEDULE_CHANGES} weekdays at a time.`);
    return selectedDates.map(date=>{
      const status=resolveScheduleDay(schedule,presence,user.id,date)?.status;
      return SCHEDULE_CATEGORIES.find(category=>category[0]===status)?.[1]||'Clear';
    }).join('\t');
  }
  function copySelection(event) {
    if (!canEdit||!selectedDates.length||event.target.closest?.('thead')) return;
    event.preventDefault();
    try {
      event.clipboardData.setData('text/plain',clipboardText());
      setSelectionMessage(`Copied ${selectedDates.length} ${selectedDates.length===1?'weekday':'weekdays'}.`);
    } catch (error) {
      setSelectionMessage(error.message);
    }
  }
  async function pasteSelection(event) {
    if (!canEdit||!selectedDates.length||event.target.closest?.('thead')) return;
    event.preventDefault();
    setSelectionMessage('');
    try {
      const text=event.clipboardData.getData('text/plain');
      const changes=schedulePaste(text,start,selectedDates);
      const count=await onChange(changes);
      if (count) setSelectionMessage(`Pasted ${count} ${count===1?'weekday':'weekdays'}.`);
    } catch (error) {
      setSelectionMessage(error instanceof PlannerError?error.message:'Select the first destination day and press Ctrl+V to paste.');
    }
  }
  async function handleCalendarKey(event) {
    if (event.key!=='Delete'&&event.key!=='Backspace') return;
    if (event.target.closest?.('thead')) return;
    if (!selectedDates.length||event.ctrlKey||event.metaKey||event.altKey) return;
    event.preventDefault();
    if (!canEdit||event.repeat) return;
    setSelectionMessage('');
    const changes=selectedDates.map(date=>({
      date,status:resolveScheduleDay({},presence,user.id,date)?SCHEDULE_BLANK:'clear',
    }));
    const count=await onChange(changes);
    if (count) setSelectionMessage('Selected weekdays cleared.');
  }
  useEffect(()=>{
    if (!onUndo||selectedDay) return;
    function handleUndoKey(event) {
      if (event.defaultPrevented||!(event.ctrlKey||event.metaKey)||event.altKey||event.shiftKey||event.key.toLowerCase()!=='z') return;
      if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      if (!canEdit||event.repeat) return;
      setSelectionMessage('');
      onUndo();
    }
    window.addEventListener('keydown',handleUndoKey);
    return ()=>window.removeEventListener('keydown',handleUndoKey);
  },[canEdit,onUndo,selectedDay]);
  function moveDayFocus(event,index) {
    if (event.key!=='ArrowLeft'&&event.key!=='ArrowRight') return;
    const next=dates[index+(event.key==='ArrowLeft'?-1:1)];
    if (!next) return;
    event.preventDefault();
    viewport.current.querySelector(`button[data-day-view="${next}"]`)?.focus();
  }
  function moveSelection(event,date) {
    if (!canEdit) return;
    if (event.key==='Enter') {
      event.preventDefault();
      if (start&&date>=start&&date<=end) openDateRange(start,end);
      else {selectDate(date);openDateRange(date,date);}
    }
    if (event.key==='ArrowLeft'||event.key==='ArrowRight') {
      const step=event.key==='ArrowLeft'?-1:1;
      let index=dates.indexOf(date)+step;
      while (dates[index]&&isWeekend(dates[index])) index+=step;
      if (!dates[index]) return;
      event.preventDefault();
      selectDate(dates[index],event.shiftKey,date);
      viewport.current.querySelector(`button[data-editable-date="${dates[index]}"]`)?.focus();
    }
    if (event.key==='Escape') {setSelection(null);setSelectionMessage('');}
  }
  return <div className="space-y-4"><section className="bg-white border rounded-xl overflow-hidden isolate">
    <div className="flex flex-wrap justify-between items-center gap-3 p-4">
      <div className="flex items-center gap-2">
          <h2 className="font-medium">Team schedule</h2>
          <Popover>
            <PopoverTrigger aria-label="Schedule help" className="inline-grid size-5 place-items-center rounded-full border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-blue-50 hover:text-blue-700">?</PopoverTrigger>
            <PopoverContent align="start" aria-label="Schedule help" className="max-w-[calc(100vw_-_2rem)] space-y-2 bg-white text-xs text-slate-700">
              <p className="font-semibold text-slate-900">Schedule shortcuts</p>
              <p>Open Filters to select a month or use Fit month. Swipe or scroll horizontally to move between months.</p>
              <p>Click a date in the header to see who is onsite or in another category that day. Use the arrow keys to move between dates.</p>
              <p>Drag or Shift-click to select weekdays in your row. Double-click inside the selection to edit the whole range.</p>
              <p><kbd>Ctrl+C</kbd> copies the selection. Select the first destination day and press <kbd>Ctrl+V</kbd> to paste.</p>
              <p><kbd>Delete</kbd> or <kbd>Backspace</kbd> clears the selected weekdays. To restore hotel-based entries, use the hotel default in the category menu.</p>
              <p><kbd>Ctrl+Z</kbd> undoes the last schedule edit in this session.</p>
            </PopoverContent>
          </Popover>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Popover>
          <PopoverTrigger className="rounded-lg border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Filters</PopoverTrigger>
          <PopoverContent align="end" aria-label="Schedule filters" className="w-[32rem] max-w-[calc(100vw_-_2rem)] space-y-4 bg-white text-slate-800">
            <h3 className="text-sm font-semibold">Schedule filters</h3>
            <div className="grid grid-cols-2 gap-3" aria-label="Schedule filters">
              <label className="text-xs text-slate-500">Month<select className="w-full border rounded-lg bg-white p-2 mt-1 text-sm text-slate-800" value={period.month} onChange={e=>jump(new Date(period.year,Number(e.target.value)-1,1))}>{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{new Date(2000,i,1).toLocaleDateString('en-US',{month:'long'})}</option>)}</select></label>
              <label className="text-xs text-slate-500">Year<select className="w-full border rounded-lg bg-white p-2 mt-1 text-sm text-slate-800" value={period.year} onChange={e=>jump(new Date(Number(e.target.value),period.month-1,1))}>{years.map(year=><option key={year}>{year}</option>)}</select></label>
              <label className="text-xs text-slate-500">{sectorLabel}<select className="w-full border rounded-lg bg-white p-2 mt-1 text-sm text-slate-800" value={sector} onChange={e=>{setSector(e.target.value);setPersonId('all');}}><option value="all">{sectorLabel==='Department'?'All departments':'All sectors'}</option>{[...tags].sort((a,b)=>a.name.localeCompare(b.name)).map(t=><option value={t.id} key={t.id}>{t.name}</option>)}<option value="unassigned">Unassigned</option></select></label>
              <label className="text-xs text-slate-500">Team member<select className="w-full border rounded-lg bg-white p-2 mt-1 text-sm text-slate-800" value={personId} onChange={e=>setPersonId(e.target.value)}><option value="all">All team members</option>{available.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
            </div>
            <div className="flex flex-wrap gap-2 text-xs" aria-label="Schedule categories and legend"><button className="rounded border px-2.5 py-1.5 text-slate-600" aria-pressed={categories.length===SCHEDULE_CATEGORIES.length} onClick={()=>setCategories(SCHEDULE_CATEGORIES.map(c=>c[0]))}>All categories</button><button className="rounded border px-2.5 py-1.5 text-slate-600" onClick={()=>setCategories([])}>Clear categories</button>{SCHEDULE_CATEGORIES.map(([status,label,color,code])=><button key={status} aria-pressed={categories.includes(status)} onClick={()=>setCategories(previous=>previous.includes(status)?previous.filter(s=>s!==status):[...previous,status])} className="rounded px-2.5 py-1.5 font-semibold" style={{backgroundColor:categories.includes(status)?color:'#F1F5F9',color:categories.includes(status)?'#FFFFFF':'#64748B'}} title={'Calendar code: '+code}>{categories.includes(status)?'✓ ':''}{label}</button>)}<span className="rounded px-2.5 py-1.5 text-slate-600" style={{backgroundColor:WEEKEND_COLOR}}>Weekend</span></div>
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <button type="button" role="switch" aria-checked={showCodes} onClick={()=>setShowCodes(value=>!value)}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                <span aria-hidden="true" className={'h-4 w-7 rounded-full p-0.5 '+(showCodes?'bg-blue-700':'bg-slate-300')}>
                  <span className={'block size-3 rounded-full bg-white shadow-sm transition-transform '+(showCodes?'translate-x-3':'')}/>
                </span>
                Show codes
              </button>
              <button type="button" className="text-sm border rounded-lg px-3 py-2 text-blue-700" onClick={fitVisibleMonth}>Fit month</button>
            </div>
          </PopoverContent>
        </Popover>
        <button className="text-sm border rounded-lg px-3 py-2 text-blue-700" onClick={()=>jump(new Date())}>Today</button>
        {team.some(p=>p.id===user.id)&&<button aria-disabled={!canEdit} onClick={()=>openDateRange(start,end)} className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 aria-disabled:opacity-40">Set date range</button>}
      </div>
    </div>
    <div ref={viewport} onScroll={extendTimeline} onCopy={copySelection} onPaste={pasteSelection} onKeyDown={handleCalendarKey}
      onPointerUp={()=>{dragAnchor.current=null;}} onPointerCancel={()=>{dragAnchor.current=null;}} onPointerLeave={()=>{dragAnchor.current=null;}}
      className="overflow-auto max-h-[55vh] border-t [scrollbar-gutter:stable]" role="region" aria-label="Continuous schedule timeline" tabIndex={0}>
      <table className="text-xs" aria-label="Continuous team schedule" style={{tableLayout:'fixed',borderCollapse:'separate',borderSpacing:0,width:nameWidth+months.length*monthWidth}}>
        <colgroup><col style={{width:nameWidth}}/>{dates.map((date,index)=><col key={date} style={{width:columnWidths[index]}}/>)}</colgroup>
        <thead className="sticky top-0 z-30"><tr>
          <th scope="col" rowSpan={2} className="p-2 text-left sticky left-0 bg-white z-40 border-r border-b">Team member</th>
          {months.map(m=><th key={m.key} scope="colgroup" colSpan={m.dates.length} className="bg-slate-50 text-left border-r border-b py-1.5"><span className="sticky block w-fit px-2 font-semibold text-slate-700" style={{left:nameWidth}}>{m.label}</span></th>)}
        </tr><tr>
          {dates.map((date,index)=>{
            const isToday=date===today,weekend=isWeekend(date);
            const weekday=new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'});
            const compact=columnWidths[index]<24;
            return <th key={date} scope="col" aria-current={isToday?'date':undefined}
              className={'border-b text-[11px] '+(monthStarts.has(date)?'schedule-month-start ':'')+(isToday?'bg-blue-100 text-blue-900':weekend?'text-slate-500':'bg-white')}
              style={isToday?{boxShadow:todayColumnEdge}:weekend?{backgroundColor:WEEKEND_COLOR}:undefined}>
              <button type="button" aria-haspopup="dialog"
                data-day-view={date} tabIndex={date===dayTabStop?0:-1}
                aria-label={'View team schedule for '+weekday+' '+display(date)}
                title={'View team schedule for '+display(date)}
                onFocus={()=>setFocusedDay(date)} onKeyDown={event=>moveDayFocus(event,index)}
                onClick={()=>setSelectedDay(date)} className="block w-full py-1.5 hover:bg-blue-100 hover:text-blue-900 focus-visible:outline-offset-[-2px]">
                {date.slice(-2)}<span className="block text-[10px] font-normal">{compact?weekday.slice(0,2):weekday}</span>
                {isToday&&<span className={columnWidths[index]<28?'sr-only':'block text-[9px] font-semibold'}>Today</span>}
              </button>
            </th>;
          })}
        </tr></thead>
        <tbody>{members.map(person=>{const tag=tags.find(t=>t.id===person.tagId);return <tr key={person.id}>
          <th scope="row" className="font-normal p-2 whitespace-nowrap sticky left-0 bg-white z-20 text-left border-r border-b truncate" title={person.name}><span className="block truncate">{person.name}</span><span className="inline-block max-w-full truncate align-top mt-1 rounded-full px-1.5 py-0.5 text-[10px]" title={tag?.name} style={tag?{backgroundColor:tag.color,color:tagTextColor(tag.color)}:{backgroundColor:'#F1F5F9',color:'#64748B'}}>{tag?.name||'Unassigned'}</span></th>
          {dates.map(date=>{
            const isToday=date===today;
            const weekend=isWeekend(date),entry=resolveScheduleDay(schedule,presence,person.id,date),category=SCHEDULE_CATEGORIES.find(c=>c[0]===entry?.status);
            const editable=!weekend&&person.id===user.id&&ready,selected=editable&&start&&date>=start&&date<=end;
            const description=weekend?'Weekend':category?.[1]||'No entry';
            const detail=entry?.source==='hotel'?' · From hotel request':'';
            const cellStyle=isToday
              ? {backgroundColor:weekend?WEEKEND_COLOR:'#EFF6FF',boxShadow:todayColumnEdge}
              : weekend?{backgroundColor:WEEKEND_COLOR}:undefined;
            return <td className={'py-1 border-b '+(monthStarts.has(date)?'schedule-month-start':'')}
              style={selected?{backgroundColor:'#DBEAFE',boxShadow:'inset 0 1px #2563EB, inset 0 -1px #2563EB'}:cellStyle} key={date}
              onPointerEnter={editable?event=>{
                if (canEdit&&event.pointerType==='mouse'&&event.buttons===1&&dragAnchor.current) {
                  selectionBeforeClick.current=null;
                  setSelection({anchor:dragAnchor.current,end:date});
                }
              }:undefined}><button
              disabled={!editable}
              aria-pressed={editable?Boolean(selected):undefined}
              aria-label={person.name+' · '+display(date)+' · '+description+detail}
              title={display(date)+' · '+description+detail}
              data-schedule-date={date}
              data-schedule-source={entry?.source||''}
              data-schedule-status={entry?.status||''}
              data-editable-date={editable?date:undefined}
              className={'block mx-auto rounded h-6 w-[calc(100%_-_4px)] max-w-8 text-[10px] font-semibold select-none '+(category?'text-white':selected?'text-blue-700':'text-slate-400')}
              style={{backgroundColor:weekend?WEEKEND_COLOR:category?.[2]||(selected||isToday?'transparent':'#FFFFFF'),opacity:category&&!categories.includes(category[0])?0.2:1,cursor:editable?undefined:'default'}}
              onMouseDown={event=>{
                if (!canEdit||event.button!==0) return;
                // The first click selects one cell. Retain the original range for a double-click.
                if (event.detail===1) selectionBeforeClick.current=selected?{date,selection,start,end}:null;
                dragAnchor.current=event.shiftKey&&start?selection.anchor:date;
                selectDate(date,event.shiftKey);
              }}
              onClick={event=>{if (canEdit&&event.nativeEvent.pointerType!=='mouse') selectDate(date,event.shiftKey);}}
              onDoubleClick={()=>{
                const previous=selectionBeforeClick.current;
                selectionBeforeClick.current=null;
                if (previous?.date===date) {
                  setSelection(previous.selection);
                  openDateRange(previous.start,previous.end);
                } else openDateRange(date,date);
              }}
              onKeyDown={event=>moveSelection(event,date)}
            >{weekend?null:category?(showCodes?category[3]:null):'·'}</button></td>;
          })}
        </tr>;})}</tbody>
      </table>
      {!members.length&&<p className="p-6 text-sm text-slate-500">No team members to display yet.</p>}
    </div>
    {(selectedDates.length>0||selectionMessage)&&<div className="flex flex-wrap items-center gap-2 border-t px-4 py-2 text-xs text-blue-800">
      {selectedDates.length>0&&<span className="rounded-full bg-blue-100 px-2.5 py-1 font-medium">{display(start)}{end!==start&&' – '+display(end)} · {selectedDates.length} {selectedDates.length===1?'weekday':'weekdays'}</span>}
      {selectionMessage&&<span role="status">{selectionMessage}</span>}
    </div>}
  </section><ScheduleTotals rows={totals} categories={categories} year={period.year} month={period.month} tags={tags}/>
    {selectedDay&&<ScheduleDay key={selectedDay} date={selectedDay} people={team} tags={tags} schedule={schedule} presence={presence} userId={user.id} onClose={()=>setSelectedDay(null)}/>}
  </div>;
}
