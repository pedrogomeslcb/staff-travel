import {PlannerError,flights as defaultFlights,newId,normalizeFlight} from './planner.mjs';
import {DRIVERS} from './transfers.mjs';
import {normalizeName} from './accounts.mjs';

const fallbackFlights=Object.entries(defaultFlights).map(([flightNumber,flight])=>({id:flightNumber,flightNumber,...flight}));
const matchName=value=>normalizeName(value).toLowerCase();
const clock=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const airport=/^[A-Z]{3}$/;
const kinds=['flights','memberships','drivers'];
const fail=(message,status=400)=>{throw new PlannerError(message,status);};
function value(input,label,limit=120) {
  if(typeof input!=='string'||!input.trim()||input.trim().length>limit)fail(`Enter a valid ${label}.`);
  return input.trim();
}
function requireDatabaseAdmin(user) {
  if(!user?.id||user.role!=='admin')fail('Only an admin can access the database.',403);
}
export function databaseOwner(identity,ownerEmail) {
  if(!identity?.userId||!identity.email)fail('Sign in with ChatGPT to access the database.',401);
  if(!ownerEmail||identity.email.trim().toLowerCase()!==ownerEmail)fail('Only an admin can access the database.',403);
  return {id:identity.userId,role:'admin'};
}
export function initialCatalog(seed={}) {
  return {
    flights:seed.flights?.map(flight=>({...flight,id:normalizeFlight(flight.flightNumber)}))??fallbackFlights,
    drivers:DRIVERS.map(driver=>({...driver,...seed.drivers?.find(item=>item.id===driver.id),capacity:driver.capacity})),
    memberships:(seed.memberships??[]).map(row=>({...row,id:'excel:'+matchName(row.name),matchKey:matchName(row.name)})),
  };
}
export function catalogReferences(catalog) {
  return {
    flights:Object.fromEntries(catalog.flights.map(({flightNumber,origin,destination,arrival,departure})=>[flightNumber,{origin,destination,arrival,departure}])),
    drivers:catalog.drivers.map(({id,name,licensePlate,contact,capacity})=>({id,name,licensePlate,contact,capacity})),
  };
}
function editedRow(kind,draft,old) {
  const id=old?.id??newId();
  if(kind==='memberships') {
    const name=normalizeName(value(draft.name,'staff name'));
    return {...old,id,name,matchKey:matchName(name),membership:value(draft.membership,'membership number',64)};
  }
  if(kind==='drivers')return {...old,id,name:value(draft.name,'driver name',80),
    licensePlate:value(draft.licensePlate,'license plate',32),contact:value(draft.contact,'contact number',64)};
  const flightNumber=normalizeFlight(value(draft.flightNumber,'flight number',24));
  const origin=value(draft.origin,'departure airport',3).toUpperCase();
  const destination=value(draft.destination,'arrival airport',3).toUpperCase();
  if(!/^[A-Z0-9]+$/.test(flightNumber)||!airport.test(origin)||!airport.test(destination))fail('Enter a flight number and valid three-letter airport codes.');
  if(!clock.test(draft.departure)||!clock.test(draft.arrival))fail('Enter departure and arrival times in HH:MM.');
  return {id,flightNumber,origin,destination,departure:draft.departure,arrival:draft.arrival};
}
export function editCatalog(catalog,kind,id,draft) {
  if(!kinds.includes(kind)||!draft||typeof draft!=='object'||Array.isArray(draft))fail('Choose a valid database entry.');
  const rows=catalog[kind],old=id===null?null:rows.find(row=>row.id===id);
  if((id!==null||kind==='drivers')&&!old)fail('Database entry not found.',404);
  const row=editedRow(kind,draft,old);
  const uniqueKey={flights:'flightNumber',memberships:'matchKey',drivers:'name'}[kind];
  if(rows.some(item=>item.id!==row.id&&matchName(item[uniqueKey])===matchName(row[uniqueKey])))fail('An entry with this name or flight number already exists.');
  return {...catalog,[kind]:old?rows.map(item=>item.id===id?row:item):[...rows,row]};
}

export function databaseStore(db,seed={}) {
  let initialization;
  function initialize() {
    if(!initialization) {
      initialization=db.prepare("INSERT OR IGNORE INTO reference_catalog (id,payload,revision) VALUES ('main',?,1)")
        .bind(JSON.stringify(initialCatalog(seed))).run().catch(error=>{initialization=null;throw error;});
    }
    return initialization;
  }
  async function read() {
    await initialize();
    const row=await db.prepare("SELECT payload,revision FROM reference_catalog WHERE id='main'").first();
    return {...JSON.parse(row.payload),revision:row.revision};
  }
  function captureStatement({userId,person,membership},afterWrite=false) {
    const name=normalizeName(person),number=typeof membership==='string'?membership.trim():'';
    if(typeof userId!=='string'||!userId||userId.length>160||typeof person!=='string'||!name||name.length>120||!number||number.length>64)return null;
    const row={id:newId(),personId:userId,name,matchKey:matchName(name),membership:number};
    return db.prepare(`
      UPDATE reference_catalog
      SET payload=json_insert(payload,'$.memberships[#]',json(?)), revision=revision+1
      WHERE id='main' AND NOT EXISTS (
        SELECT 1 FROM json_each(payload,'$.memberships')
        WHERE json_extract(value,'$.personId')=? OR json_extract(value,'$.matchKey')=?
      ) ${afterWrite?'AND changes()=1':''}
    `).bind(JSON.stringify(row),row.personId,row.matchKey);
  }
  return {
    initialize,captureStatement,
    async read(user) {requireDatabaseAdmin(user);return read();},
    async references() {return catalogReferences(await read());},
    async save(user,{kind,id,draft,revision}) {
      requireDatabaseAdmin(user);
      const current=await read();
      if(current.revision!==revision)fail('The database changed elsewhere. Refresh and try again.',409);
      const {revision:oldRevision,...catalog}=current;
      const next=editCatalog(catalog,kind,id,draft);
      const result=await db.prepare("UPDATE reference_catalog SET payload=?,revision=revision+1 WHERE id='main' AND revision=?")
        .bind(JSON.stringify(next),oldRevision).run();
      if(result.meta.changes!==1)fail('The database changed elsewhere. Refresh and try again.',409);
      return {...next,revision:oldRevision+1};
    },
    async capture(trips) {
      const statements=trips.map(trip=>captureStatement(trip)).filter(Boolean);
      if(!statements.length)return;
      await initialize();
      await db.batch(statements);
    },
  };
}
