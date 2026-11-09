import {DRIVERS} from './transfers.mjs';

const toTime=value=>String(value??'').slice(0,5);
const nonempty=(value,label)=>{
  const result=String(value??'').trim();
  if(!result)throw new Error('Enter '+label+'.');
  return result;
};
function check(result){
  if(result.error)throw new Error(result.error.message);
  return result.data;
}

export function supabaseDatabaseClient(client){
  async function authenticatedProfile(){
    const {data:{user},error:authError}=await client.auth.getUser();
    if(authError||!user)throw new Error('Sign in to access the Database.');
    const p=check(await client.from('staff_profiles')
      .select('user_id,staff_code,role,username').eq('user_id',user.id).single());
    return p;
  }

  async function references(){
    const p=await authenticatedProfile();
    // IHG is linked to the logged-in user's immutable Auth ID, never to their
    // editable staff code, display name, or a submitted username.
    const [flightsResult,driversResult,memberResult]=await Promise.all([
      client.from('flights').select('flight_number,origin,destination,departure,arrival'),
      client.from('drivers').select('name,license_plate,contact'),
      client.from('staff_ihg_memberships').select('membership').eq('user_id',p.user_id).maybeSingle(),
    ]);
    const flights=check(flightsResult)||[];
    const drivers=check(driversResult)||[];
    const membership=check(memberResult)?.membership||'';
    return {
      membership,
      flights:Object.fromEntries(flights.map(row=>[row.flight_number,{
        origin:row.origin,destination:row.destination,
        departure:toTime(row.departure),arrival:toTime(row.arrival),
      }])),
      drivers:drivers.map(row=>{
        const match=DRIVERS.find(d=>d.name.toLowerCase()===row.name.toLowerCase());
        return {id:match?.id||row.name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),
          name:row.name,licensePlate:row.license_plate||'',contact:row.contact||'',
          capacity:match?.capacity||3};
      }),
    };
  }

  async function read(){
    const p=await authenticatedProfile();
    if(p.role!=='admin')throw new Error('Only an administrator can view the Database.');
    const [a,b,c,d,legacy,refs]=await Promise.all([
      client.from('flights').select('*').order('flight_number'),
      client.from('staff_ihg_memberships').select('user_id,membership'),
      client.from('drivers').select('*').order('name'),
      client.from('staff_profiles').select('user_id,username,display_name,staff_code').order('username'),
      client.from('ihg_memberships').select('staff_code,membership').order('staff_code'),
      references(),
    ]);
    const flights=check(a)||[],linked=check(b)||[],drivers=check(c)||[];
    const staff=check(d)||[],old=check(legacy)||[];
    const byUser=new Map(linked.map(x=>[x.user_id,x.membership]));
    const linkedNumbers=new Set(linked.map(x=>x.membership));
    return {
      flights:flights.map(f=>({id:f.flight_number,flightNumber:f.flight_number,
        origin:f.origin,destination:f.destination,
        departure:toTime(f.departure),arrival:toTime(f.arrival)})),
      // All current users appear so admins can directly set their IHG number.
      memberships:staff.map(u=>({
        id:u.user_id,username:u.username||'',name:u.display_name||u.username||'Staff',
        membership:byUser.get(u.user_id)||'',
      })),
      // Original data not yet matched to a username is kept visible to admins.
      legacyMemberships:old.filter(x=>!linkedNumbers.has(x.membership)),
      drivers:drivers.map(d=>({id:d.name,name:d.name,licensePlate:d.license_plate||'',
        contact:d.contact||'',capacity:DRIVERS.find(x=>x.name.toLowerCase()===d.name.toLowerCase())?.capacity||3})),
      membershipUsers:staff.filter(u=>!!u.username).map(u=>({id:u.user_id,username:u.username,
        name:u.display_name||u.username})),
      membership:refs.membership,
      revision:Date.now(),
    };
  }

  async function save(kind,id,draft){
    const p=await authenticatedProfile();
    if(p.role!=='admin')throw new Error('Only an administrator may change the Database.');

    if(kind==='memberships'){
      const username=nonempty(draft.username,'username').toLowerCase();
      const profile=check(await client.from('staff_profiles')
        .select('user_id,username').eq('username',username).maybeSingle());
      if(!profile)throw new Error('Select an existing username.');
      if(id!==null && profile.user_id!==id)
        throw new Error('The username cannot be changed for an existing IHG entry.');

      const membership=String(draft.membership??'').trim();
      if(membership.length>64)throw new Error('IHG membership may be at most 64 characters.');
      if(membership){
        check(await client.from('staff_ihg_memberships')
          .upsert({user_id:profile.user_id,membership,updated_at:new Date().toISOString()})
          .select('user_id').single());
      }else{
        check(await client.from('staff_ihg_memberships').delete()
          .eq('user_id',profile.user_id).select('user_id'));
      }
      return read();
    }

    let table,key,record;
    if(kind==='flights'){
      table='flights';key='flight_number';
      record={flight_number:nonempty(draft.flightNumber,'flight number').toUpperCase(),
        origin:nonempty(draft.origin,'origin').toUpperCase(),
        destination:nonempty(draft.destination,'destination').toUpperCase(),
        departure:nonempty(draft.departure,'departure time'),
        arrival:nonempty(draft.arrival,'arrival time')};
    }else if(kind==='drivers'){
      table='drivers';key='name';
      record={name:nonempty(draft.name,'driver name'),
        license_plate:nonempty(draft.licensePlate,'license plate'),
        contact:nonempty(draft.contact,'contact')};
    }else throw new Error('Unknown Database table.');
    if(id!==null&&String(record[key]).toLowerCase()!==String(id).toLowerCase()){
      throw new Error('The identifying code/name cannot be changed. Edit its other fields.');
    }
    const result=id===null
      ?await client.from(table).insert(record).select().single()
      :await client.from(table).update(record).eq(key,id).select().single();
    check(result);
    return read();
  }
  return {linkedMemberships:true,read,references,save,capture:async()=>{}};
}
