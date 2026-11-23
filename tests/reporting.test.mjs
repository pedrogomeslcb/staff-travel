import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {countryMonths,yearCounts} from '../lib/country-days.mjs';
import {plannerWorkbook} from '../lib/export-workbook.mjs';

const stay=(outDate,returnDate,extra={})=>({userId:'p',outDate,returnDate,...extra});
test('country days include weekends and both endpoints, merge overlaps and split years',()=>{
  const counts=countryMonths([stay('2026-12-30','2027-01-03'),stay('2027-01-02','2027-01-04'),
    stay('2027-01-08','2027-01-08'),stay('2027-02-01','2027-02-08',{canceledAt:'2026-12-01'}),
    stay('2027-02-30','2027-03-01'),stay('2027-03-04','2027-03-01')]).get('p');
  assert.deepEqual([...counts],[['2026-12',2],['2027-01',5]]);
  assert.equal(yearCounts(countryMonths([stay('2028-01-01','2028-03-31')]).get('p'),2028).reduce((a,b)=>a+b),91);
});
test('Excel round trip keeps permissions, text identifiers and separate weekday and calendar totals',async()=>{
  const person={id:'p',name:'Traveler'};
  const trip=stay('2026-11-20','2026-11-23',{id:'t',person:'Traveler',checkin:'2026-11-20',checkout:'2026-11-23',membership:'000123'});
  const snapshot={currentUser:{...person,role:'user'},people:[person],presence:[trip],schedule:{},trips:[trip],transferTrips:[trip],tags:[],users:[person]};
  for(const role of ['user','admin']){
    snapshot.currentUser.role=role;
    const book=new ExcelJS.Workbook();
    await book.xlsx.load(await plannerWorkbook(snapshot,{year:2026}).xlsx.writeBuffer());
    assert.equal(book.getWorksheet('Schedule').rowCount,3);
    assert.equal(book.getWorksheet('Days in country').getCell('M2').value,4);
    assert.equal(book.getWorksheet('Hotel and flights').getCell('H2').value,'000123');
    assert.equal(book.getWorksheet('Transfers').rowCount,3);
    assert.equal(!!book.getWorksheet('Logs'),role==='admin');
    assert.equal(!!book.getWorksheet('Users and access'),role==='admin');
  }
});
