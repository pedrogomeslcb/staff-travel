import {localRepository} from './repository.mjs';
import {PlannerError,SCHEDULE_STORED_STATUSES,prepareRequest,confirmRequest,markHotelRequested,updateScheduleEntries} from './planner.mjs';
import {auditHotelChange,cancelHotelRequest,markHotelCancellationNotified,publicTrip,auditScheduleChange} from './travel-audit.mjs';
import {prepareTransfer} from './transfers.mjs';

const DEPARTMENT_TAGS=Object.freeze([
  {id:'department-tmo',name:'TMO',color:'#F0EBFA'},
  {id:'department-cost-excellence',name:'Cost Excellence',color:'#EAF3FF'},
  {id:'department-revenue-enhancement',name:'Revenue Enhancement',color:'#E7F5EE'},
]);
const departmentTagIds=Object.fromEntries(DEPARTMENT_TAGS.map(t=>[t.name,t.id]));

// The cloud stores hotel requests and Schedule categories across browsers.
// Transfer driver allocations and other browser-only preferences remain local.
// All remote queries are authenticated and constrained by Supabase RLS.
export function supabaseWorkspace(client,viewer,storage){
  const local=localRepository(storage);
  const fail=error=>{if(error)throw new Error(error.message||'Database request failed.');};
  const table='staff_hotel_requests';
  const scheduleTable='staff_schedule_entries';
  const importFlag='sp_shared_schedule_imported_v1';
  const missingDatabaseObject=result=>['PGRST202','PGRST205','42P01','42883'].includes(result?.error?.code);
  let sharedScheduleReady=false;

  // Fetch the entire roster. Supabase REST defaults to 1,000 rows per response;
  // multiple users and annual totals would otherwise be silently truncated.
  async function readSchedule(){
    const rows=[];
    const batchSize=1000;
    for(let offset=0;offset<100000;offset+=batchSize){
      const result=await client.from(scheduleTable).select('user_id,day,status')
        .order('day',{ascending:true}).order('user_id',{ascending:true})
        .range(offset,offset+batchSize-1);
      if(result.error)return result;
      rows.push(...(result.data||[]));
      if((result.data||[]).length<batchSize)
        return {data:rows,error:null};
    }
    throw new Error('The team schedule is unusually large. Contact an administrator.');
  }

  async function readScheduleAndPresence(localSnapshot,user){
    const [scheduleResponse,presenceResponse]=await Promise.all([
      readSchedule(),
      client.rpc('staff_schedule_presence'),
    ]);
    if(scheduleResponse.error||presenceResponse.error){
      if(missingDatabaseObject(scheduleResponse)||missingDatabaseObject(presenceResponse)){
        sharedScheduleReady=false;
        return {schedule:localSnapshot.schedule,presence:null};
      }
      fail(scheduleResponse.error);
      fail(presenceResponse.error);
    }
    sharedScheduleReady=true;
    let scheduleRows=scheduleResponse.data||[];

    // One-time migration from the current authenticated user's browser data.
    // Never overwrite existing cloud entries or import another person's row.
    if(storage.getItem(importFlag)!=='done'){
      const mine=scheduleRows.filter(row=>row.user_id===user.id);
      if(!mine.length){
        const legacy=Object.entries(localSnapshot.schedule||{})
          .filter(([key,record])=>key.startsWith(user.id+'|')&&
            SCHEDULE_STORED_STATUSES.includes(record?.status))
          .map(([key,record])=>({date:key.slice(user.id.length+1),status:record.status}));
        for(let offset=0;offset<legacy.length;offset+=366){
          const result=await client.rpc('staff_schedule_import',
            {entries:legacy.slice(offset,offset+366)});
          if(result.error){
            if(missingDatabaseObject(result))break;
            fail(result.error);
          }
        }
        if(legacy.length){
          const updated=await readSchedule();
          fail(updated.error);
          scheduleRows=updated.data||[];
        }
      }
      storage.setItem(importFlag,'done');
    }

    return {
      schedule:Object.fromEntries(scheduleRows.map(row=>[
        row.user_id+'|'+row.day,{status:row.status},
      ])),
      presence:(presenceResponse.data||[]).map(row=>({
        userId:row.user_id,checkin:row.checkin,checkout:row.checkout,
      })),
    };
  }

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
    const cloud=await readScheduleAndPresence(localSnapshot,user);
    // Keep the workspace usable while the one-time RPC migration has not
    // been applied. RLS restricts this fallback to the records already
    // permitted; full team visibility activates when the RPC is installed.
    let directory=profilesResponse;
    if(profilesResponse.error && ['PGRST202','42883'].includes(profilesResponse.error.code)){
      directory=await client.from('staff_profiles')
        .select('user_id,username,display_name,role,department,is_primary_admin')
        .eq('is_primary_admin',false)
        .order('display_name',{ascending:true});
    }
    fail(directory.error);
    const people=(directory.data||[]).filter(p=>!p.is_primary_admin).map(p=>({
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
      sharedScheduleReady,
      schedule:cloud.schedule,
      people,
      users:user.role==='admin'?people:[],
      trips,
      presence:cloud.presence??active.map(({userId,checkin,checkout})=>({userId,checkin,checkout})),
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
    // Evaluate reminder warnings against the latest shared hotel requests.
    const current=await snapshot(user);
    const updated=updateScheduleEntries(user,current.schedule,changes);
    auditScheduleChange(user,current.schedule,updated,current.trips,changes,acknowledgedHotels);

    // Keep legacy mode functional until the SQL migration is installed.
    if(!sharedScheduleReady)
      return local.scheduleBatch(user,changes,acknowledgedHotels);

    const withExpectations=changes.map(change=>({
      ...change,
      expected:change.expected??(current.schedule[user.id+'|'+change.date]?.status||'clear'),
    }));
    const {data,error}=await client.rpc('staff_schedule_apply',{changes:withExpectations});
    if(error){
      if(/changed elsewhere|reload and try again/i.test(error.message||''))
        throw new PlannerError('The schedule changed elsewhere. Reload and try again.',409);
      fail(error);
    }
    if(!Array.isArray(data?.previous))
      throw new Error('Schedule update did not return valid results.');
    return data;
  }

  return {...local,snapshot,save,requested,confirm,remove,hotelNotified,transfer,scheduleBatch};
}
