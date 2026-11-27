import test from 'node:test';
import assert from 'node:assert/strict';
import {reportScope,summaryRows,reportYearDate} from '../lib/schedule-report-scope.mjs';
const own={person:{id:'a'},monthlyTotal:3,annualTotal:7},other={person:{id:'b'},monthlyTotal:5,annualTotal:11},team=[own,other];
test('only administrators can request a collective summary',()=>{
 const user={id:'a',role:'user'},admin={id:'a',role:'admin'};
 assert.equal(reportScope(user,'team'),'my');
 assert.deepEqual(summaryRows(user,'team',team,own),[own]);
 assert.deepEqual(summaryRows(admin,'my',team,own),[own]);
 assert.deepEqual(summaryRows(admin,'team',team,own),team);
});
test('personal summary is independent of the displayed team filter and cannot select another user',()=>{
 const user={id:'a',role:'user'};
 assert.deepEqual(summaryRows(user,'my',[other],own),[own]);
 assert.deepEqual(summaryRows(user,'my',[other],other),[]);
 assert.deepEqual(summaryRows({id:'primary',role:'admin'},'my',team,null),[]);
});
test('year selector retains the calendar month when jumping across years',()=>{
 const next=reportYearDate({year:2026,month:11},2027);
 assert.equal(next.getFullYear(),2027);assert.equal(next.getMonth(),10);assert.equal(next.getDate(),1);
 assert.throws(()=>reportYearDate({year:2026,month:11},1899),RangeError);
});
