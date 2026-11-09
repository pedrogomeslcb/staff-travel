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
  async function profile(){
    const {data:{user},error}=await client.auth.getUser();
    if(error||!user)throw new Error('Sign in to access the Database.');
    return check(await client.from('staff_profiles').select('staff_code,role').eq('user_id',user.id).single());
  }
  async function references(){
    const p=await profile();
    const [flightRows,driverRows,memberRows]=await Promise.all([
      client.from('flights').select('flight_number,origin,destination,departure,arrival'),
      client.from('drivers').select('name,license_plate,contact'),
      p.staff_code
        ?client.from('ihg_memberships').select('membership').eq('staff_code',p.staff_code).maybeSingle()
        :Promise.resolve({data:null,error:null}),
    ]);
    const flights=check(flightRows)||[];
    const drivers=check(driverRows)||[];
    const membership=check(memberRows)?.membership||'';
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
    const p=await profile();
    if(p.role!=='admin')throw new Error('Only an administrator can view the Database.');
    const [a,b,c,refs]=await Promise.all([
      client.from('flights').select('*').order('flight_number'),
      client.from('ihg_memberships').select('*').order('staff_code'),
      client.from('drivers').select('*').order('name'),
      references(),
    ]);
    const flights=check(a)||[],memberships=check(b)||[],drivers=check(c)||[];
    return {
      flights:flights.map(f=>({id:f.flight_number,flightNumber:f.flight_number,
        origin:f.origin,destination:f.destination,departure:toTime(f.departure),arrival:toTime(f.arrival)})),
      memberships:memberships.map(m=>({id:m.staff_code,name:m.staff_code,membership:m.membership})),
      drivers:drivers.map(d=>({id:d.name,name:d.name,licensePlate:d.license_plate||'',
        contact:d.contact||'',capacity:DRIVERS.find(x=>x.name.toLowerCase()===d.name.toLowerCase())?.capacity||3})),
      membership:refs.membership,
      revision:Date.now(),
    };
  }
  async function save(kind,id,draft){
    const p=await profile();
    if(p.role!=='admin')throw new Error('Only an administrator may change the Database.');
    let table,key,record;
    if(kind==='flights'){
      table='flights';key='flight_number';
      record={flight_number:nonempty(draft.flightNumber,'flight number').toUpperCase(),
        origin:nonempty(draft.origin,'origin').toUpperCase(),
        destination:nonempty(draft.destination,'destination').toUpperCase(),
        departure:nonempty(draft.departure,'departure time'),
        arrival:nonempty(draft.arrival,'arrival time')};
    }else if(kind==='memberships'){
      table='ihg_memberships';key='staff_code';
      record={staff_code:nonempty(draft.name,'staff code').toUpperCase(),
        membership:nonempty(draft.membership,'membership')};
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
  return {read,references,save,capture:async()=>{}};
}
