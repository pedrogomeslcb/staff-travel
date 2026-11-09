// Keep the original full-day/off-day IDs so existing local and shared entries remain valid.
export const SCHEDULE_CATEGORIES = Object.freeze([
  ['onsite','Onsite fullday','#7030A0','O'],
  ['onsite-half','Onsite halfday','#C18AE6','½O'],
  ['remote','Offsite fullday','#FFC000','R'],
  ['offsite-half','Offsite halfday','#FFDD80','½R'],
  ['off','F-Day','#00B050','F'],
  ['vacation','Vacation','#FF0000','V'],
  ['other','Other','#FF6633','X'],
]);
export const SCHEDULE_STATUSES = SCHEDULE_CATEGORIES.map(c=>c[0]);
export const SCHEDULE_BLANK = 'blank';
export const SCHEDULE_STORED_STATUSES = [...SCHEDULE_STATUSES,SCHEDULE_BLANK];
export const MAX_SCHEDULE_CHANGES = 366;
export const DATE_KEYS = ['checkin', 'checkout', 'outDate', 'returnDate', 'pickupDate'];
export const DATE_OVERRIDES = ['outDate', 'returnDate', 'pickupDate'];
export const blank = Object.freeze({project:'', hotel:'', checkin:'', checkout:'', membership:'', outFlight:'', outOrigin:'', outDestination:'', outDate:'', outTime:'', returnFlight:'', returnOrigin:'', returnDestination:'', returnDate:'', returnTime:'', pickupDate:'', pickupTime:'', notes:''});
export const flights = Object.freeze({LH560:{origin:'FRA',destination:'NBJ',arrival:'06:20',departure:'21:45'}, LH561:{origin:'NBJ',destination:'FRA',arrival:'07:30',departure:'22:55'}});
export const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
export const normalizeFlight = v => String(v ?? '').replace(/\s/g, '').toUpperCase();
export const newId = (source=globalThis.crypto) => source.randomUUID?.() ?? Array.from(source.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
export const maskDate = v => {const s = v.replace(/\D/g,'').slice(0,8);return s.slice(0,2)+(s.length>2?'/'+s.slice(2,4):'')+(s.length>4?'/'+s.slice(4):'');};
export function parse(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v || '');
  if (!m || +m[3] < 1900) return null;
  const d = new Date(+m[3], +m[2]-1, +m[1], 12);
  return d.getFullYear()===+m[3] && d.getMonth()===+m[2]-1 && d.getDate()===+m[1] ? iso(d) : null;
}
export const display = v => {if (!v) return '';const [y,m,d]=String(v).split('T')[0].split('-');return `${d}/${m}/${y}`;};
export function nightsBetween(a,b) {const x=parse(a),y=parse(b);return x&&y?Math.round((Date.parse(y+'T00:00:00Z')-Date.parse(x+'T00:00:00Z'))/86400000):null;}
export function toDraft(record) {
  if (!record) return {...blank};
  const next = {...blank,...record};
  for (const key of DATE_KEYS) next[key]=display(record[key]);
  for (const key of DATE_OVERRIDES) next[key+'Edited']=record[key+'Edited'] ?? (record[key] !== record[key==='outDate'?'checkin':'checkout']);
  return next;
}
export function changeTrip(previous, key, value, flightTable=flights) {
  const next = {...previous,[key]:value};
  if (DATE_OVERRIDES.includes(key)) next[key+'Edited']=true;
  if (key==='checkin' && !previous.outDateEdited) next.outDate=value;
  if (key==='checkout') {
    if (!previous.returnDateEdited) next.returnDate=value;
    if (!previous.pickupDateEdited) next.pickupDate=value;
  }
  if (key==='outFlight' || key==='returnFlight') {
    const code=normalizeFlight(value), flight=Object.hasOwn(flightTable,code)?flightTable[code]:undefined;
    next[key]=value.toUpperCase();
    if (flight && code!==normalizeFlight(previous[key])) {
      next[key]=code;
      const prefix=key==='outFlight'?'out':'return';
      next[prefix+'Origin']=flight.origin;
      next[prefix+'Destination']=flight.destination;
      next[prefix+'Time']=prefix==='out'?flight.arrival:flight.departure;
    }
  }
  return next;
}
export class PlannerError extends Error {
  constructor(message, status=400) {super(message);this.status=status;}
}
const fail = (message,status) => {throw new PlannerError(message,status);};
export function assertRevision(old, expected) {
  if (old && (old.revision ?? 0)!==(expected ?? 0)) fail('This request changed elsewhere. Close it and reopen the latest version.',409);
}
export function prepareRequest(user, draft, old=null, id=newId(), now=new Date().toISOString()) {
  if (!user?.id) fail('Sign in to save a request.',401);
  if (old && old.userId!==user.id && user.role!=='admin') fail('You can only edit your own requests.',403);
  if (old) assertRevision(old,draft.revision);
  if (old) requireActiveRequest(old);
  const clean={};
  for (const key of Object.keys(blank)) {
    if (typeof draft[key]!=='string') fail('Complete all required request fields.');
    const value=draft[key].trim();
    const max=key==='notes'?2000:key==='membership'?64:80;
    if (value.length>max) fail(`${key==='notes'?'Comments':'A field'} exceeds the maximum length of ${max} characters.`);
    if (!value && !['membership','notes'].includes(key)) fail('Complete all required request fields.');
    clean[key]=value;
  }
  for (const key of DATE_KEYS) {clean[key]=parse(draft[key]);if (!clean[key]) fail('Enter valid dates in DD/MM/YYYY format.');}
  if (clean.checkout<=clean.checkin) fail('Check-out must be after check-in.');
  if (!['outTime','returnTime','pickupTime'].every(k=>/^([01]\d|2[0-3]):[0-5]\d$/.test(clean[k]))) fail('Select hours and minutes for every time.');
  const arrival=clean.outDate+'T'+clean.outTime, departure=clean.returnDate+'T'+clean.returnTime, pickup=clean.pickupDate+'T'+clean.pickupTime;
  if (departure<=arrival || pickup>=departure || pickup<=arrival) fail('Hotel pickup must be after arrival and before the return flight.');
  for (const key of ['outFlight','returnFlight']) clean[key]=normalizeFlight(clean[key]);
  for (const key of ['outOrigin','outDestination','returnOrigin','returnDestination']) clean[key]=clean[key].toUpperCase();
  const materialChanged=!old || Object.keys(blank).some(k=>(old[k]??'')!==clean[k]);
  for (const key of DATE_OVERRIDES) clean[key+'Edited']=!!draft[key+'Edited'];
  const flagsChanged=!!old && DATE_OVERRIDES.some(k=>!!old[k+'Edited']!==clean[k+'Edited']);
  if (old && !materialChanged && !flagsChanged) return {record:old, changed:false};
  // Preserve admin-owned allocations. Changes to flight/pickup details require another transport review.
  clean.transfers={...old?.transfers};
  const transferFields={arrival:['hotel','outFlight','outOrigin','outDestination','outDate','outTime'],return:['hotel','returnFlight','returnOrigin','returnDestination','returnDate','returnTime','pickupDate','pickupTime']};
  for(const [leg,fields] of Object.entries(transferFields)) {
    if(old?.transfers?.[leg]&&fields.some(key=>old[key]!==clean[key])) clean.transfers[leg]={...old.transfers[leg],needsReview:true};
  }
  clean.hotelRequested=old?.hotelRequested===true;
  clean.hotelRequestedBy=old?.hotelRequestedBy??'';
  clean.hotelRequestedAt=old?.hotelRequestedAt??null;
  return {changed:true,record:{...clean,id:old?.id??id,userId:old?.userId??user.id,person:old?.person??user.name,outArrival:arrival,returnDeparture:departure,pickup,created:old?.created??now,updated:now,confirmationNumber:old?.confirmationNumber??'',confirmationUpdatedBy:old?.confirmationUpdatedBy??'',confirmationUpdatedAt:old?.confirmationUpdatedAt??null,needsReview:!!old?.needsReview || !!(old?.confirmationNumber && materialChanged),revision:(old?.revision??0)+1}};
}
export function canManageRequest(user, request) {
  return !!user?.id && !!request && (user.role==='admin' || request.userId===user.id);
}
export function hotelNeedsCancellation(request) {
  return request.hotelRequested===true||Boolean(request.confirmationNumber);
}
export function requireActiveRequest(request) {
  if(request.canceledAt)fail('This request was canceled.',409);
}
export function markHotelRequested(user,old,requested,expectedRevision,now=new Date().toISOString()) {
  if(!user?.id||user.role!=='admin')fail('Only an admin can update the hotel Requested status.',403);
  if(!old)fail('Request not found.',404);
  assertRevision(old,expectedRevision);
  requireActiveRequest(old);
  if(typeof requested!=='boolean')fail('Choose a valid Requested status.');
  if((old.hotelRequested===true)===requested)return old;
  return {...old,hotelRequested:requested,hotelRequestedBy:requested?user.name:'',hotelRequestedAt:requested?now:null,updated:now,revision:(old.revision??0)+1};
}
export function confirmRequest(user, old, number, expectedRevision, now=new Date().toISOString()) {
  if (!old) fail('Request not found.',404);
  if (!canManageRequest(user,old)) fail('Only the reservation owner or an admin can save its confirmation.',403);
  assertRevision(old,expectedRevision);
  requireActiveRequest(old);
  if (typeof number!=='string' || !number.trim() || number.trim().length>100) fail('Enter a confirmation number of up to 100 characters.');
  return {...old,confirmationNumber:number.trim(),needsReview:false,confirmationUpdatedBy:user.name,confirmationUpdatedAt:now,updated:now,revision:(old.revision??0)+1};
}
export function authorizeDeletion(user, old, expectedRevision, acknowledgeHotelNotification=false) {
  if (!old) fail('Request not found.',404);
  if (!canManageRequest(user,old)) fail('Only the reservation owner or an admin can delete this request.',403);
  assertRevision(old,expectedRevision);
  requireActiveRequest(old);
  if (hotelNeedsCancellation(old) && acknowledgeHotelNotification!==true) fail('Acknowledge that you must notify the hotel to cancel this booking.');
  return old.id;
}
export function updateSchedule(user, schedule, date, status) {
  return updateScheduleEntries(user,schedule,[{date,status}]);
}
export function validateScheduleChanges(user, changes) {
  if (!user?.id) fail('Sign in to update your schedule.',401);
  if (!Array.isArray(changes)||!changes.length||changes.length>MAX_SCHEDULE_CHANGES) {
    fail(`Select between 1 and ${MAX_SCHEDULE_CHANGES} weekdays to update.`);
  }
  const dates=new Set();
  for (const change of changes) {
    const {date,status,expected}=change??{};
    if (typeof date!=='string'||parse(display(date))!==date||(!SCHEDULE_STORED_STATUSES.includes(status)&&status!=='clear')||
      (expected!==undefined&&!SCHEDULE_STORED_STATUSES.includes(expected)&&expected!=='clear')) {
      fail('Choose a valid date and schedule category.');
    }
    if (isWeekend(date)||dates.has(date)) fail('Each weekday can only be updated once per change.');
    dates.add(date);
  }
}
export function checkScheduleExpectations(changes,previous) {
  if (changes.some(({expected},index)=>expected!==undefined&&expected!==previous[index].status)) {
    fail('The schedule changed elsewhere. That edit could not be undone.',409);
  }
}
export function updateScheduleEntries(user, schedule, changes) {
  validateScheduleChanges(user,changes);
  const next={...schedule};
  for (const {date,status} of changes) {
    const key=user.id+'|'+date;
    if (status==='clear') delete next[key];else next[key]={status};
  }
  return next;
}
export function isWeekend(date) {
  const day=new Date(date+'T12:00:00Z').getUTCDay();
  return day===0 || day===6;
}
export function hotelCoversDate(trip,date) {
  const {checkin,checkout,canceledAt}=trip;
  return !canceledAt&&parse(display(checkin))===checkin&&parse(display(checkout))===checkout&&
    checkin<checkout&&checkin<=date&&date<=checkout;
}
// Hotel defaults are derived from the current requests, not copied into stored manual entries.
// That keeps existing stays, date edits, overlapping requests and reloads consistent in both modes.
export function resolveScheduleDay(schedule, trips, userId, date) {
  if (parse(display(date))!==date || isWeekend(date)) return null;
  const manual=schedule[userId+'|'+date];
  if (manual?.status===SCHEDULE_BLANK) return null;
  if (manual && SCHEDULE_STATUSES.includes(manual.status)) return {status:manual.status,source:'manual'};
  const stay=trips.some(trip=>trip.userId===userId&&hotelCoversDate(trip,date));
  return stay?{status:'onsite',source:'hotel'}:null;
}
// A verified server identity is required. A browser-supplied name or role is never used here.
export function authorizeMember(identity, rawMembers) {
  if (!identity?.userId || !identity?.email) fail('Sign in with ChatGPT to access the team workspace.',401);
  let members;try {members=JSON.parse(rawMembers||'{}');}catch {fail('The team access list is not configured correctly.',503);}
  if (!members || typeof members!=='object' || Array.isArray(members)) fail('The team access list is not configured correctly.',503);
  const role=Object.hasOwn(members,identity.email.trim().toLowerCase())?members[identity.email.trim().toLowerCase()]:null;
  if (!['user','admin'].includes(role)) fail('Your account has not been added to this project.',403);
  return {id:identity.userId,name:identity.fullName||identity.displayName||identity.email,role};
}
