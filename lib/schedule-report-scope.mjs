// The personal summary is independent of the currently filtered table.
export function reportScope(user,requested){
  return user?.role==='admin'&&requested==='team'?'team':'my';
}
export function summaryRows(user,requested,teamRows,ownRow){
  if(reportScope(user,requested)==='team')return teamRows;
  return ownRow?.person?.id===user?.id?[ownRow]:[];
}
export function reportYearDate(period,year){
  if(!Number.isInteger(year)||year<1900||year>9999)throw new RangeError('Choose a valid year.');
  return new Date(year,period.month-1,1);
}
