import {localRepository} from './repository.mjs';
import {prepareRequest,confirmRequest,markHotelRequested,updateScheduleEntries} from './planner.mjs';
import {auditHotelChange,cancelHotelRequest,markHotelCancellationNotified,publicTrip,auditScheduleChange} from './travel-audit.mjs';
import {prepareTransfer} from './transfers.mjs';

const DEPARTMENT_TAGS=Object.freeze([
  {id:'department-tmo',name:'TMO',color:'#F0EBFA'},
  {id:'department-cost-excellence',name:'Cost Excellence',color:'#EAF3FF'},
  {id:'department-revenue-enhancement',name:'Revenue Enhancement',color:'#E7F5EE'},
]);
const departmentTagIds=Object.fromEntries(DEPARTMENT_TAGS.map(t=>[t.name,t.id]));

// The cloud stores hotel requests across browsers; roster settings remain browser-local.
// All remote queries are authenticated and constrained by Supabase RLS.
export function supabaseWorkspace(client,viewer,storage){
  const local=localRepository(storage);
  const fail=error=>{if(error)throw new Error(error.message||'Database request failed.');};
  const table='staff_hotel_requests';

  async function allHotels(){
    const {data,error}=await client.from(table).select('record').order('updated_at',{ascending:false});
    fail(error);
    return (data||[]).map(row=>publicTrip(row.record));
  }

  async function lookup(id){
    const {data,error}=await client.from(table).select('record,revision').eq('id',id).maybeSingle();
    fail(error);
    if(!data)throw new Error('Hotel request not found. It may have been changed or removed.');
    return data.record;
  }

  async function persist(record,old=null){
    const input={id:record.id,owner_user_id:record.userId,record,revision:record.revision};
    const {data,error}=old
      ?await client.from(table).update({record,revision:record.revision})
        .eq('id',old.id).eq('revision',old.revision).select('record').maybeSingle()
      :await client.from(table).insert(input).select('record').single();
    fail(error);
    if(!data)throw new Error('This request was updated by someone else. Refresh and try again.');
    return publicTrip(data.record);
  }

  async function snapshot(user=viewer){
    const [localSnapshot,trips,profilesResponse]=await Promise.all([
      local.snapshot(user),
      allHotels(),
      // Read a restricted, server-verified team directory. Ordinary users
      // cannot enumerate staff_profiles directly under the existing RLS.
      client.rpc('staff_schedule_directory'),
    ]);
    if(profilesResponse.error){
      if(profilesResponse.error.code==='PGRST202'||profilesResponse.error.code==='42883')
        throw new Error('Team directory is not yet enabled. Run supabase/schedule-directory.sql in the Supabase SQL Editor.');
      fail(profilesResponse.error);
    }
    const people=(profilesResponse.data||[]).map(p=>({
      id:p.user_id,name:p.display_name||p.username||'Staff',
      role:p.role,username:p.username,
      isPrimaryAdmin:false,department:p.department||null,
      tagId:departmentTagIds[p.department]||null,
    }));
    const active=trips.filter(t=>!t.canceledAt);
    return {
      ...localSnapshot,
      tags:DEPARTMENT_TAGS,
      currentUser:user,
      people,
      users:user.role==='admin'?people:[],
      trips,
      presence:active.map(({userId,checkin,checkout})=>({userId,checkin,checkout})),
      transferTrips:active.map(({id,userId,person,hotel,outDestination,outFlight,outDate,outTime,
        returnOrigin,returnFlight,pickupDate,pickupTime,transfers,revision})=>({
        id,userId,person,hotel,outDestination,outFlight,outDate,outTime,returnOrigin,
        returnFlight,pickupDate,pickupTime,transfers,revision,
      })),
    };
  }

  async function save(user,draft,editing){
    const old=editing!==null?await lookup(editing):null;
    const result=prepareRequest(user,draft,old);
    if(!result.changed)return {...result,record:publicTrip(result.record)};
    const record=auditHotelChange(old?'hotel_edited':'hotel_created',user,old,result.record);
    return {...result,record:await persist(record,old)};
  }
  async function requested(user,trip,value){
    const old=await lookup(trip.id);
    const next=markHotelRequested(user,old,value,trip.revision);
    if(next===old)return publicTrip(old);
    return persist(auditHotelChange(value?'hotel_requested':'hotel_unrequested',user,old,next),old);
  }
  async function confirm(user,trip,number){
    const old=await lookup(trip.id);
    const next=confirmRequest(user,old,number,trip.revision);
    return persist(auditHotelChange('hotel_confirmed',user,old,next),old);
  }
  async function remove(user,trip,acknowledgeHotelNotification=false){
    const old=await lookup(trip.id);
    const next=cancelHotelRequest(user,old,trip.revision,acknowledgeHotelNotification);
    return {id:next.id,record:await persist(next,old)};
  }
  async function hotelNotified(user,trip){
    const old=await lookup(trip.id);
    const next=markHotelCancellationNotified(user,old,trip.revision);
    if(next===old)return publicTrip(old);
    return persist(next,old);
  }
  async function transfer(user,trip,leg,draft){
    const old=await lookup(trip.id);
    return persist(prepareTransfer(user,old,leg,draft,trip.revision),old);
  }
  async function scheduleBatch(user,changes,acknowledgedHotels=[]){
    // The local schedule engine needs shared hotel details to issue hotel reminders.
    const current=await snapshot(user);
    const updated=updateScheduleEntries(user,current.schedule,changes);
    auditScheduleChange(user,current.schedule,updated,current.trips,changes,acknowledgedHotels);
    return local.scheduleBatch(user,changes,acknowledgedHotels);
  }

  return {...local,snapshot,save,requested,confirm,remove,hotelNotified,transfer,scheduleBatch};
}
