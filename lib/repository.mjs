import {PlannerError, prepareRequest, confirmRequest, markHotelRequested, checkScheduleExpectations, updateScheduleEntries, newId, SCHEDULE_STORED_STATUSES} from './planner.mjs';
import {HotelReminderError,auditHotelChange,auditScheduleChange,cancelHotelRequest,markHotelCancellationNotified,publicTrip,restoreHotelScheduleDefaults,travelAudit} from './travel-audit.mjs';
import {DRIVERS,prepareTransfer} from './transfers.mjs';
import {prepareGroupAllocation} from './transfer-plan.mjs';
import {DEFAULT_TAGS,currentActor,publicUser,requireAdmin,prepareMember,prepareTag,removeMember,checkAccountRevision,projectSnapshot,normalizeName} from './accounts.mjs';
import {hashPassword,verifyPassword} from './passwords.mjs';
export const KEYS={people:'sp_people_v1',trips:'sp_trips_v2',schedule:'sp_schedule_v1',tags:'sp_tags_v1',transferAllocations:'sp_transfer_allocations_v1'};
const empty={people:[],trips:[],schedule:{},tags:DEFAULT_TAGS,transferAllocations:{}};
function load(storage,key,fallback) {
  let value;
  try {const raw=storage.getItem(key);value=raw===null?fallback:JSON.parse(raw);}catch {throw new PlannerError('Browser data could not be read. Enable browser storage or restore valid saved data.');}
  if (Array.isArray(fallback)?!Array.isArray(value):!value||typeof value!=='object'||Array.isArray(value)) throw new PlannerError('Saved browser data is invalid. No data was overwritten.');
  if(key===KEYS.tags&&!value.every(t=>t&&typeof t.id==='string'&&typeof t.name==='string'&&/^#[0-9a-f]{6}$/i.test(t.color)))throw new PlannerError('Saved sector data is invalid. No data was overwritten.');
  if (key===KEYS.people && !value.every(p=>p&&p.id!=null&&typeof p.name==='string')) throw new PlannerError('Saved team data is invalid. No data was overwritten.');
  if (key===KEYS.trips && !value.every(t=>t&&t.id!=null&&t.userId!=null&&typeof t.person==='string')) throw new PlannerError('Saved request data is invalid. No data was overwritten.');
  if (key===KEYS.schedule) {
    const data=Object.hasOwn(value,'entries')?value:{entries:value,auditEvents:[]};
    if(!data.entries||typeof data.entries!=='object'||Array.isArray(data.entries)||!Array.isArray(data.auditEvents)||
      !Object.values(data.entries).every(s=>s&&SCHEDULE_STORED_STATUSES.includes(s.status))) {
      throw new PlannerError('Saved schedule data is invalid. No data was overwritten.');
    }
    return data;
  }
  if (key===KEYS.transferAllocations&&!Object.entries(value).every(([slot,row])=>row?.key===slot&&
    Number.isSafeInteger(row.revision)&&row.revision>0&&Array.isArray(row.driverIds)&&
    row.driverIds.every(id=>DRIVERS.some(driver=>driver.id===id))&&new Set(row.driverIds).size===row.driverIds.length)) {
    throw new PlannerError('Saved driver allocations are invalid. No data was overwritten.');
  }
  return value;
}
function write(storage,key,value) {try {storage.setItem(key,JSON.stringify(value));}catch {throw new PlannerError('Browser storage is unavailable. Your changes were not saved.');}}
export function localRepository(storage) {
  let session=null,initialization=null;
  function raw() {
    const data=Object.fromEntries(Object.entries(KEYS).map(([k,v])=>[k,load(storage,v,empty[k])]));
    const {entries,auditEvents}=data.schedule;
    return {...data,schedule:restoreHotelScheduleDefaults(entries,data.trips,auditEvents)};
  }
  const actor=user=>currentActor(load(storage,KEYS.people,[]),user);
  const admin=user=>{const current=actor(user);requireAdmin(current);return current;};
  function scheduleBatch(user,changes,acknowledgedHotels=[]) {
    const current=actor(user),{entries,auditEvents}=load(storage,KEYS.schedule,{});
    const trips=load(storage,KEYS.trips,[]);
    const schedule=restoreHotelScheduleDefaults(entries,trips,auditEvents);
    const next=updateScheduleEntries(current,schedule,changes);
    const previous=changes.map(({date})=>({date,status:schedule[current.id+'|'+date]?.status??'clear'}));
    checkScheduleExpectations(changes,previous);
    const event=auditScheduleChange(current,schedule,next,trips,changes,acknowledgedHotels);
    if(event)write(storage,KEYS.schedule,{
      entries:schedule===entries?next:updateScheduleEntries(current,entries,changes),
      auditEvents:[...auditEvents,event],
    });
    return {previous};
  }
  function persistTrip(trips,old,record) {
    if(record!==old)write(storage,KEYS.trips,old?trips.map(trip=>trip.id===old.id?record:trip):[record,...trips]);
    return publicTrip(record);
  }
  async function initialize() {
    if(initialization)return initialization;
    initialization=(async()=>{
      const people=load(storage,KEYS.people,[]);let changed=false;
      for(let i=0;i<people.length;i++)if(!people[i].passwordHash){people[i]={...people[i],role:people[i].role==='admin'||normalizeName(people[i].name).toLowerCase()==='admin'?'admin':'user',passwordHash:await hashPassword('test'),authVersion:people[i].authVersion??1,revision:people[i].revision??1,tagId:people[i].tagId??null};changed=true;}
      if(!people.some(p=>!p.deletedAt&&p.role==='admin')){people.push({id:newId(),name:'admin',role:'admin',passwordHash:await hashPassword('test'),authVersion:1,revision:1,tagId:null});changed=true;}
      if(changed)write(storage,KEYS.people,people);
      if(storage.getItem(KEYS.tags)===null)write(storage,KEYS.tags,[...DEFAULT_TAGS]);
    })().catch(error=>{initialization=null;throw error;});
    return initialization;
  }
  return {
    initialize,
    snapshot:(viewer=session)=>projectSnapshot(raw(),viewer),
    audit(user) {
      if(actor(user).role!=='admin')throw new PlannerError('Only an admin can view the audit log.',403);
      return travelAudit(load(storage,KEYS.trips,[]),load(storage,KEYS.schedule,{}).auditEvents);
    },
    async login(name,password) {
      await initialize();const people=load(storage,KEYS.people,[]),n=normalizeName(name).toLowerCase();
      const person=people.find(p=>!p.deletedAt&&normalizeName(p.name).toLowerCase()===n);
      if(person?.lockedUntil&&Date.parse(person.lockedUntil)>Date.now())throw new PlannerError('Too many sign-in attempts. Try again in five minutes.',429);
      if(!person||!await verifyPassword(password,person.passwordHash)){
        if(person){const attempts=(person.failedLogins??0)+1;write(storage,KEYS.people,people.map(p=>p.id===person.id?{...p,failedLogins:attempts,lockedUntil:attempts>=5?new Date(Date.now()+300000).toISOString():null}:p));}
        throw new PlannerError('Full name or password is incorrect.',401);
      }
      if(person.failedLogins)write(storage,KEYS.people,people.map(p=>p.id===person.id?{...p,failedLogins:0,lockedUntil:null}:p));
      session=publicUser(person);return session;
    },
    logout() {session=null;},
    async createUser(user,draft) {
      await initialize();const current=admin(user),data=raw();
      const person=prepareMember(current,data.people,data.tags,draft);person.passwordHash=await hashPassword('test');
      write(storage,KEYS.people,[...data.people,person]);return publicUser(person);
    },
    async updateUser(user,id,draft) {
      const current=admin(user),data=raw(),old=data.people.find(p=>p.id===id&&!p.deletedAt);
      if(!old)throw new PlannerError('User not found.',404);
      const person=prepareMember(current,data.people,data.tags,draft,old);write(storage,KEYS.people,data.people.map(p=>p.id===id?person:p));return publicUser(person);
    },
    async resetPassword(user,id,password,revision) {
      admin(user);const people=load(storage,KEYS.people,[]),old=people.find(p=>p.id===id&&!p.deletedAt);
      if(!old)throw new PlannerError('User not found.',404);checkAccountRevision(old,revision);
      const passwordHash=await hashPassword(password),next={...old,passwordHash,authVersion:(old.authVersion??1)+1,revision:(old.revision??1)+1,failedLogins:0,lockedUntil:null};
      write(storage,KEYS.people,people.map(p=>p.id===id?next:p));return {ok:true};
    },
    async deleteUser(user,id,revision) {
      const current=admin(user),people=load(storage,KEYS.people,[]),old=people.find(p=>p.id===id);
      const next=removeMember(current,people,old,revision);write(storage,KEYS.people,people.map(p=>p.id===id?next:p));return {ok:true};
    },
    async saveTag(user,draft) {
      const current=admin(user),tags=load(storage,KEYS.tags,DEFAULT_TAGS),old=draft.id?tags.find(t=>t.id===draft.id):null;
      if(draft.id&&!old)throw new PlannerError('Sector not found.',404);
      const next=prepareTag(current,tags,draft,old);write(storage,KEYS.tags,old?tags.map(t=>t.id===old.id?next:t):[...tags,next]);return next;
    },
    save(user,draft,editing) {
      user=actor(user);
      const trips=load(storage,KEYS.trips,[]),old=editing!==null?trips.find(t=>t.id===editing):null;
      if (editing!==null && !old) throw new PlannerError('Request not found. Refresh and try again.',404);
      const result=prepareRequest(user,draft,old);
      if(!result.changed)return {...result,record:publicTrip(result.record)};
      const record=auditHotelChange(old?'hotel_edited':'hotel_created',user,old,result.record);
      return {...result,record:persistTrip(trips,old,record)};
    },
    requested(user,trip,requested) {
      user=actor(user);
      const trips=load(storage,KEYS.trips,[]),old=trips.find(t=>t.id===trip.id);
      const record=markHotelRequested(user,old,requested,trip.revision);
      return persistTrip(trips,old,record===old?old:auditHotelChange(requested?'hotel_requested':'hotel_unrequested',user,old,record));
    },
    confirm(user,trip,number) {
      user=actor(user);
      const trips=load(storage,KEYS.trips,[]), old=trips.find(t=>t.id===trip.id);
      const record=confirmRequest(user,old,number,trip.revision);
      return persistTrip(trips,old,auditHotelChange('hotel_confirmed',user,old,record));
    },
    transfer(user,trip,leg,draft) {
      user=actor(user);
      const trips=load(storage,KEYS.trips,[]),old=trips.find(t=>t.id===trip.id);
      const record=prepareTransfer(user,old,leg,draft,trip.revision);
      return persistTrip(trips,old,record);
    },
    allocateDrivers(user,key,driverIds,revision) {
      const allocations=load(storage,KEYS.transferAllocations,{}),trips=load(storage,KEYS.trips,[]);
      const allocation=prepareGroupAllocation(actor(user),trips,key,driverIds,revision,allocations[key]);
      write(storage,KEYS.transferAllocations,{...allocations,[key]:allocation});
      return allocation;
    },
    remove(user,trip,acknowledgeHotelNotification=false) {
      user=actor(user);
      const trips=load(storage,KEYS.trips,[]),old=trips.find(t=>t.id===trip.id);
      const record=cancelHotelRequest(user,old,trip.revision,acknowledgeHotelNotification);
      return {id:record.id,record:persistTrip(trips,old,record)};
    },
    hotelNotified(user,trip) {
      const trips=load(storage,KEYS.trips,[]),old=trips.find(t=>t.id===trip.id);
      return persistTrip(trips,old,markHotelCancellationNotified(actor(user),old,trip.revision));
    },
    schedule:(user,date,status)=>scheduleBatch(user,[{date,status}]),
    scheduleBatch
  };
}
export function remoteRepository(fetcher=fetch) {
  async function api(method,body,path='/api/workspace') {
    const response=await fetcher(path,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    let data;try {data=await response.json();}catch {throw new PlannerError('The workspace could not be reached. Your changes were not saved.');}
    if (!response.ok) {
      if(data.code==='hotel_reminder'&&Array.isArray(data.hotels))throw new HotelReminderError(data.hotels);
      throw new PlannerError(data.error||'Could not save changes.',response.status);
    }
    return data;
  }
  return {
    initialize:async()=>{},
    snapshot:()=>api('GET'),
    audit:()=>api('GET',undefined,'/api/workspace?view=audit'),
    login:(_name,password)=>api('POST',{action:'login',password}),
    logout:()=>api('POST',{action:'logout'}),
    createUser:(_user,draft)=>api('POST',{action:'user_create',draft}),
    updateUser:(_user,id,draft)=>api('POST',{action:'user_update',id,draft}),
    resetPassword:(_user,id,password,revision)=>api('POST',{action:'user_password',id,password,revision}),
    deleteUser:(_user,id,revision)=>api('POST',{action:'user_delete',id,revision}),
    saveTag:(_user,draft)=>api('POST',{action:'tag_save',draft}),
    save:(_user,draft,id)=>api('POST',{action:'save',draft,id}),
    requested:(_user,trip,requested)=>api('POST',{action:'hotel_requested',id:trip.id,requested,revision:trip.revision}),
    confirm:(_user,trip,number)=>api('POST',{action:'confirm',id:trip.id,number,revision:trip.revision}),
    transfer:(_user,trip,leg,draft)=>api('POST',{action:'transfer',id:trip.id,leg,draft,revision:trip.revision}),
    allocateDrivers:(_user,key,driverIds,revision)=>api('POST',{action:'transfer_drivers',key,driverIds,revision}),
    remove:(_user,trip,acknowledgeHotelNotification=false)=>api('POST',{action:'delete',id:trip.id,revision:trip.revision,acknowledgeHotelNotification}),
    hotelNotified:(_user,trip)=>api('POST',{action:'hotel_cancellation_notified',id:trip.id,revision:trip.revision}),
    schedule:(_user,date,status)=>api('POST',{action:'schedule',date,status}),
    scheduleBatch:(_user,changes,acknowledgedHotels=[])=>api('POST',{action:'schedule_batch',changes,acknowledgedHotels})
  };
}
