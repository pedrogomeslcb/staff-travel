import {DRIVERS} from './transfers.mjs';
export function driverIdentity(row){
  const id=row.driver_id||row.name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-');
  const original=DRIVERS.find(d=>d.id===id);
  return {id,name:row.name,licensePlate:row.license_plate||'',contact:row.contact||'',capacity:original?.capacity||3};
}
