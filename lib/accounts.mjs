import {PlannerError,newId} from './planner.mjs';
import {transferSlot} from './transfer-plan.mjs';
import {publicTrip} from './travel-audit.mjs';
export const DEFAULT_TAGS=Object.freeze([{id:'tmo',name:'TMO',color:'#2563EB',revision:1},{id:'cost-excellence',name:'Cost Excellence',color:'#0D9488',revision:1}]);
export const normalizeName=value=>String(value??'').trim().replace(/\s+/g,' ');
export const normalizeEmail=value=>String(value??'').trim().toLowerCase();
export function publicUser(p) {return {id:p.id,name:p.name,role:p.role||'user',tagId:p.tagId??null,authVersion:p.authVersion??1};}
export function currentActor(people,actor) {
  if(!actor?.id)throw new PlannerError('Sign in to access this workspace.',401);
  const stored=people.find(p=>p.id===actor.id);
  if(stored?.deletedAt||(stored&&actor.authVersion!=null&&actor.authVersion!==(stored.authVersion??1)))throw new PlannerError('Your access changed. Sign in again.',401);
  return stored?publicUser(stored):actor;
}
export function requireAdmin(actor) {if(!actor?.id||actor.role!=='admin')throw new PlannerError('Only an admin can manage users and sectors.',403);}
export function checkAccountRevision(old,revision) {if(old&&(old.revision??1)!==revision)throw new PlannerError('This user or sector changed elsewhere. Reopen the latest version.',409);}
export function prepareMember(actor,people,tags,draft,old=null) {
  requireAdmin(actor);if(old)checkAccountRevision(old,draft.revision);
  const name=normalizeName(draft.name),email=old?.email??(normalizeEmail(draft.email)||null);
  if(!name||name.length>120)throw new PlannerError('Enter a full name of up to 120 characters.');
  if(people.some(p=>!p.deletedAt&&p.id!==old?.id&&normalizeName(p.name).toLowerCase()===name.toLowerCase()))throw new PlannerError('A user with this name already exists.');
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new PlannerError('Enter a valid email address.');
  if(email&&people.some(p=>p.id!==old?.id&&normalizeEmail(p.email)===email))throw new PlannerError('This email address already belongs to an account.');
  const tagId=draft.tagId||null;if(tagId&&!tags.some(t=>t.id===tagId))throw new PlannerError('Choose an existing sector.');
  const role=old&&draft.role!==undefined?draft.role:old?.role||'user';
  if(!['user','admin'].includes(role))throw new PlannerError('Choose User or Admin.');
  if(old?.role==='admin'&&role!=='admin'&&people.filter(p=>!p.deletedAt&&p.role==='admin').length<=1)throw new PlannerError('Keep at least one active admin account. Promote another user first.');
  return {...old,id:old?.id??newId(),name,email,tagId,role,revision:(old?.revision??0)+1,authVersion:(old?.authVersion??1)+(old&&role!==(old.role||'user')?1:0),deletedAt:null};
}
export function removeMember(actor,people,target,revision,now=new Date().toISOString()) {
  requireAdmin(actor);if(!target||target.deletedAt)throw new PlannerError('User not found.',404);
  checkAccountRevision(target,revision);
  if(target.id===actor.id)throw new PlannerError('You cannot delete your own admin account.');
  if(target.role==='admin'&&people.filter(p=>!p.deletedAt&&p.role==='admin').length<=1)throw new PlannerError('Keep at least one active admin account.');
  return {...target,deletedAt:now,authVersion:(target.authVersion??1)+1,revision:(target.revision??1)+1};
}
export function prepareTag(actor,tags,draft,old=null) {
  requireAdmin(actor);if(old)checkAccountRevision(old,draft.revision);
  const name=normalizeName(draft.name),color=String(draft.color??'').toUpperCase();
  if(!name||name.length>60)throw new PlannerError('Enter a sector name of up to 60 characters.');
  if(!/^#[0-9A-F]{6}$/.test(color))throw new PlannerError('Choose a valid sector color.');
  if(tags.some(t=>t.id!==old?.id&&t.name.toLowerCase()===name.toLowerCase()))throw new PlannerError('A sector with this name already exists.');
  return {id:old?.id??newId(),name,color,revision:(old?.revision??0)+1};
}
export const tagTextColor=color=>{const rgb=[1,3,5].map(i=>{const n=parseInt(color.slice(i,i+2),16)/255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;});return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722>0.179?'#0F172A':'#FFFFFF';};
export function projectSnapshot(raw,viewer) {
  if(!viewer)return {people:[],trips:[],transferTrips:[],transferAllocations:{},presence:[],schedule:{},tags:[],users:[],currentUser:null};
  const actor=currentActor(raw.people,viewer),people=raw.people.filter(p=>!p.deletedAt).map(publicUser);
  const names=new Map(raw.people.map(p=>[p.id,p.name]));
  const trips=raw.trips.map(t=>({...publicTrip(t),person:names.get(t.userId)||t.person}));
  const active=trips.filter(trip=>!trip.canceledAt);
  const slots=new Set(active.flatMap(trip=>['arrival','return'].map(leg=>transferSlot(trip,leg).key)));
  return {
    people,tags:raw.tags,schedule:raw.schedule,currentUser:actor,
    trips:actor.role==='admin'?trips:active.filter(t=>t.userId===actor.id),
    presence:active.map(({userId,checkin,checkout})=>({userId,checkin,checkout})),
    transferTrips:active.map(({id,userId,person,hotel,outDestination,outFlight,outDate,outTime,returnOrigin,returnFlight,pickupDate,pickupTime,transfers,revision})=>({id,userId,person,hotel,outDestination,outFlight,outDate,outTime,returnOrigin,returnFlight,pickupDate,pickupTime,transfers,revision})),
    transferAllocations:Object.fromEntries(Object.entries(raw.transferAllocations??{}).filter(([key])=>slots.has(key))),
    users:actor.role==='admin'?raw.people.filter(p=>!p.deletedAt).map(p=>({...publicUser(p),email:p.email??'',revision:p.revision??1})):[],
  };
}
