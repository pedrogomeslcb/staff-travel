import {localRepository} from './repository.mjs';
import {PlannerError,SCHEDULE_STORED_STATUSES,prepareRequest,confirmRequest,markHotelRequested,updateScheduleEntries} from './planner.mjs';
import {auditHotelChange,cancelHotelRequest,markHotelCancellationNotified,publicTrip,auditScheduleChange} from './travel-audit.mjs';
import {prepareTransfer} from './transfers.mjs';
import {buildTransferPlan,prepareGroupAllocation} from './transfer-plan.mjs';

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
  const transferImportFlag='sp_shared_transfers_imported_v1';
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

  async function readTeamPresence(){
    const rows=[];
    for(let offset=0;;offset+=1000){
      const result=await client.rpc('staff_schedule_presence_v2')
        .order('user_id').order('checkin').order('checkout').order('arrival_day').order('departure_day')
        .range(offset,offset+999);
      if(result.error)return result;
      rows.push(...result.data);
      if(result.data.length<1000)return {data:rows,error:null};
    }
  }

  async function readScheduleAndPresence(localSnapshot,user){
    let [scheduleResponse,presenceResponse]=await Promise.all([
      readSchedule(),
      readTeamPresence(),
    ]);
    const teamFlights=!presenceResponse.error;
    if(missingDatabaseObject(presenceResponse))presenceResponse=await client.rpc('staff_schedule_presence');
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
      // Import every saved local day, even when this user already has some
      // cloud entries. The server ignores conflicts and never overwrites them.
      const legacy=Object.entries(localSnapshot.schedule||{})
        .filter(([key,record])=>key.startsWith(user.id+'|')&&
          SCHEDULE_STORED_STATUSES.includes(record?.status))
        .map(([key,record])=>({date:key.slice(user.id.length+1),status:record.status}));
      for(let offset=0;offset<legacy.length;offset+=366){
        const result=await client.rpc('staff_schedule_import',
          {entries:legacy.slice(offset,offset+366)});
        if(result.error){
          if(missingDatabaseObject(result))
            throw new PlannerError('Team Schedule migration is incomplete. Run supabase/shared-schedule.sql in Supabase SQL Editor, then reload.',503);
          fail(result.error);
        }
      }
      if(legacy.length){
        const updated=await readSchedule();
        fail(updated.error);
        scheduleRows=updated.data||[];
      }
      storage.setItem(importFlag,'done');
    }

    return {
      teamFlights,
      schedule:Object.fromEntries(scheduleRows.map(row=>[
        row.user_id+'|'+row.day,{status:row.status},
      ])),
      presence:(presenceResponse.data||[]).map(row=>({
        userId:row.user_id,checkin:row.checkin,checkout:row.checkout,outDate:row.arrival_day,returnDate:row.departure_day,
      })),
    };
  }

  async function readTeamAllocations(localSnapshot,user){
    const result=await client.rpc('staff_transfer_allocations_visible');
    if(result.error){
      if(missingDatabaseObject(result))return localSnapshot.transferAllocations||{};
      fail(result.error);
    }
    const cloud=Object.fromEntries((result.data||[]).map(row=>[
      row.slot_key,{key:row.slot_key,driverIds:row.driver_ids||[],revision:row.revision},
    ]));
    // Copy legacy selections once, without replacing any existing cloud allocation.
    // The authenticated server validates every group and the admin role.
    if(user.role==='admin'&&storage.getItem(transferImportFlag)!=='done'){
      let complete=true;
      for(const [key,allocation] of Object.entries(localSnapshot.transferAllocations||{})){
        if(cloud[key]||!allocation?.driverIds?.length)continue;
        let values;
        try{values=JSON.parse(key);}catch{continue;}
        if(!Array.isArray(values)||values.length!==6||values[5]!==null)continue;
        const [date,time,leg,airport,hotel]=values;
        const saved=await client.rpc('staff_transfer_assign',{
          p_key:key,p_day:date,p_time:time,p_leg:leg,p_airport:airport,
          p_hotel:hotel||'',p_driver_ids:allocation.driverIds,p_revision:0,
        });
        if(saved.error){
          if(/changed elsewhere/i.test(saved.error.message||''))continue;
          complete=false;
          break;
        }
        cloud[key]=saved.data;
      }
      if(complete)storage.setItem(transferImportFlag,'done');
    }
    return cloud;
  }

  async function pickupOptions({date,airport}){
    // A hotel is no longer selected on new requests. Search by date and
    // departure airport and return the existing pickup location so accepting
    // an option can join the *same* vehicle group, not merely copy its time.
    const result=await client.rpc('staff_transfer_pickup_options_v2',{
      p_day:date,p_airport:airport,
    });
    if(result.error){
      if(missingDatabaseObject(result))
        throw new Error('Matching transfer suggestions require supabase/transfer-pickup-date-search.sql in Supabase SQL Editor.');
      fail(result.error);
    }
    return (result.data||[]).map(row=>({
      time:row.pickup_time,requestedBy:row.requested_by,
      pickupLocation:row.pickup_location,
      driverIds:row.driver_ids||[],assignedDriver:row.assigned_driver||'',
    }));
  }

  async function readCopassengers(user){
    if(user.role==='admin')return {ready:true,rows:[]};
    const {data,error}=await client.rpc('staff_transfer_copassengers');
    if(error){
      if(missingDatabaseObject({error}))return {ready:false,rows:[]};
      fail(error);
    }
    return {ready:true,rows:data||[]};
  }

  async function allHotels(){
    const trips=[];
    for(let offset=0;;offset+=1000){
      const {data,error}=await client.from(table).select('record').order('id').range(offset,offset+999);
      fail(error);
      trips.push(...data.map(row=>publicTrip(row.record)));
      if(data.length<1000)return trips.sort((a,b)=>String(b.updated).localeCompare(String(a.updated)));
    }
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
    const [cloud,transferAllocations,copassengers]=await Promise.all([
      readScheduleAndPresence(localSnapshot,user),
      readTeamAllocations(localSnapshot,user),
      readCopassengers(user),
    ]);
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
      countryTrips:cloud.teamFlights?cloud.presence:active,
      countryLimited:!cloud.teamFlights && user.role!=='admin',
      schedule:cloud.schedule,
      transferAllocations,
      transferPassengersReady:copassengers.ready,
      people,
      users:user.role==='admin'?people:[],
      trips,
      presence:cloud.presence??active.map(({userId,checkin,checkout})=>({userId,checkin,checkout})),
      transferTrips:[
        ...active.filter(t=>!t.archivedAt).map(({id,userId,person,hotel,outDestination,outFlight,outDate,outTime,
          returnOrigin,returnFlight,pickupDate,pickupTime,transfers,revision})=>({
          id,userId,person,hotel,outDestination,outFlight,outDate,outTime,returnOrigin,
          returnFlight,pickupDate,pickupTime,transfers,revision,
        })),
        ...copassengers.rows.map(row=>({
          id:'shared-'+row.trip_id,userId:row.user_id,person:row.person,
          sharedLeg:row.leg,
          hotel:row.hotel||'',outDestination:row.leg==='arrival'?row.airport:'',
          outDate:row.leg==='arrival'?row.transfer_day:'',
          outTime:row.leg==='arrival'?row.transfer_time:'',
          outFlight:row.leg==='arrival'?row.flight:'',
          returnOrigin:row.leg==='return'?row.airport:'',
          pickupDate:row.leg==='return'?row.transfer_day:'',
          pickupTime:row.leg==='return'?row.transfer_time:'',
          returnFlight:row.leg==='return'?row.flight:'',
          transfers:{},
        })),
      ],
    };
  }

  async function save(user,draft,editing,targetUserId=user.id){
    const old=editing!==null?await lookup(editing):null;
    let targetUser=user;
    if(editing===null&&targetUserId!==user.id) {
      if(user.role!=='admin')throw new PlannerError('Only an admin can request a hotel for another team member.',403);
      const {data,error}=await client.from('staff_profiles')
        .select('user_id,display_name,username,role').eq('user_id',targetUserId).maybeSingle();
      fail(error);
      if(!data||!['admin','user'].includes(data.role))throw new PlannerError('Select a registered team member.',400);
      targetUser={id:data.user_id,name:data.display_name||data.username||'Staff'};
    }
    const result=prepareRequest(user,draft,old,undefined,undefined,targetUser);
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
  async function allocateDrivers(user,key,driverIds,revision){
    if(user?.role!=='admin')throw new PlannerError('Admin access is required.',403);
    const current=await snapshot(user);
    const checked=prepareGroupAllocation(user,current.transferTrips,key,driverIds,revision,
      current.transferAllocations[key]);
    const group=buildTransferPlan(current.transferTrips,{period:'all'}).days
      .flatMap(day=>day.groups).find(item=>item.key===key);
    if(!group||!group.assignable)
      throw new PlannerError('The transfer details changed. Reload and try again.',409);
    const result=await client.rpc('staff_transfer_assign',{
      p_key:key,p_day:group.date,p_time:group.time,p_leg:group.leg,
      p_airport:group.airport,p_hotel:group.leg==='return'?group.hotel:'',
      p_driver_ids:checked.driverIds,p_revision:revision,
    });
    if(result.error){
      if(missingDatabaseObject(result))
        throw new PlannerError('Shared transfer assignments require supabase/shared-transfer-pickups.sql in Supabase SQL Editor.',503);
      if(/changed elsewhere/i.test(result.error.message||''))
        throw new PlannerError('The driver allocation changed elsewhere. Reload and retry.',409);
      fail(result.error);
    }
    return result.data;
  }

  async function scheduleBatch(user,changes,acknowledgedHotels=[]){
    // Evaluate reminder warnings against the latest shared hotel requests.
    const current=await snapshot(user);
    const targetId=changes[0]?.targetUserId||user.id;
    if(changes.some(change=>(change.targetUserId||user.id)!==targetId))
      throw new PlannerError('Select dates for one team member at a time.');
    if(targetId!==user.id &&
      (user.role!=='admin'||!current.people.some(person=>person.id===targetId)))
      throw new PlannerError('Only admins may edit another team member’s Schedule.',403);
    const targetUser=targetId===user.id?user:{...user,id:targetId};
    const updated=updateScheduleEntries(targetUser,current.schedule,changes);
    auditScheduleChange(targetUser,current.schedule,updated,current.trips,changes,acknowledgedHotels);

    // Never acknowledge a Schedule edit as shared when the database is missing.
    // Existing local entries remain available for one-time migration after SQL setup.
    if(!sharedScheduleReady)
      throw new PlannerError('Team Schedule is not synchronized. Ask an admin to run supabase/shared-schedule.sql in Supabase SQL Editor, then reload this page. Your changes were not saved.',503);

    const withExpectations=changes.map(change=>({
      ...change,
      expected:change.expected??(current.schedule[targetId+'|'+change.date]?.status||'clear'),
    }));
    const {data,error}=targetId===user.id
      ?await client.rpc('staff_schedule_apply',{changes:withExpectations})
      :await client.rpc('staff_schedule_apply_admin',{
        p_target_user_id:targetId,changes:withExpectations,
      });
    if(error){
      if(targetId!==user.id&&missingDatabaseObject({error}))
        throw new PlannerError('Admin Schedule editing requires supabase/admin-schedule-edit.sql in Supabase SQL Editor. No changes were saved.',503);
      if(/changed elsewhere|reload and try again/i.test(error.message||''))
        throw new PlannerError('The schedule changed elsewhere. Reload and try again.',409);
      fail(error);
    }
    if(!Array.isArray(data?.previous))
      throw new Error('Schedule update did not return valid results.');
    return data;
  }

  async function audit(user,{all=false}={}){
    if(user?.role!=='admin')throw new PlannerError('Admin access is required.',403);
    const data=[];
    for(let offset=0;;offset+=1000){
      const page=await client.from('staff_activity_logs')
        .select('id,created_at,kind,actor_user_id,actor_name,subject_user_id,subject_name,details')
        .order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+999);
      const {error}=page;
      if(error){
        if(missingDatabaseObject({error}))
          throw new Error('Activity logs are not configured. Run supabase/admin-activity-logs.sql in the Supabase SQL Editor.');
        fail(error);
      }
      data.push(...page.data);
      if(!all || page.data.length<1000)break;
    }
    return data.map(row=>({
      id:String(row.id),
      at:row.created_at,
      kind:row.kind,
      actorId:row.actor_user_id||'system',
      actorName:row.actor_name||'System / administrator',
      personId:row.subject_user_id||'system',
      personName:row.subject_name||'Team member',
      ...row.details,
    }));
  }

  return {...local,snapshot,save,requested,confirm,remove,hotelNotified,transfer,allocateDrivers,pickupOptions,scheduleBatch,audit};
}
