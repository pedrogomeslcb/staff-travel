import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSchedule} from '../lib/schedule-totals.mjs';
const people=[{id:'p',name:'Person'}],period={year:2027,month:1};
test('man-days count only onsite and offsite, with half-day weights and no weekends',()=>{
 const schedule=Object.fromEntries([
 ['2027-01-04','onsite'],['2027-01-05','onsite-half'],['2027-01-06','remote'],['2027-01-07','offsite-half'],
 ['2027-01-08','off'],['2027-01-09','onsite'],['2027-01-11','vacation'],['2027-01-12','other'],['2027-02-01','remote'],
 ].map(([day,status])=>['p|'+day,{status}]));
 const [row]=summarizeSchedule(people,schedule,[],period);
 assert.equal(row.monthlyTotal,3);assert.equal(row.annualTotal,4);
 assert.equal(row.monthly.off,1);assert.equal(row.monthly.vacation,1);assert.equal(row.monthly.other,1);
 assert.equal(row.monthly['onsite-half'],0.5);
 const [filtered]=summarizeSchedule(people,schedule,[],{...period,categories:['vacation']});
 assert.equal(filtered.monthlyTotal,3);assert.equal(filtered.annualTotal,4);
});
test('manual leave and blank entries override automatic hotel days; overlapping stays count once',()=>{
 const stays=[{userId:'p',checkin:'2027-01-04',checkout:'2027-01-08'},{userId:'p',checkin:'2027-01-05',checkout:'2027-01-08'},{userId:'p',checkin:'2027-01-11',checkout:'2027-01-15',canceledAt:'2027-01-01'}];
 const [row]=summarizeSchedule(people,{'p|2027-01-05':{status:'vacation'},'p|2027-01-06':{status:'blank'},'p|2027-01-07':{status:'offsite-half'}},stays,period);
 assert.equal(row.monthlyTotal,2.5);assert.equal(row.annualTotal,2.5);
 assert.equal(row.monthly.onsite,2);assert.equal(row.monthly.vacation,1);
});
