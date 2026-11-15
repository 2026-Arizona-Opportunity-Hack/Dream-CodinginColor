import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRetention,parseFilters,previousYear} from '../lib/reporting.js';
import {validKey} from '../api/v1/metrics.js';
import metrics from '../api/v1/metrics.js';
import retention from '../api/reports/retention.js';
import funder from '../api/reports/funder.js';
const f=parseFilters({from:'2026-01-01',to:'2026-06-30'});
const gift=(id,date,cents,program='STEM',member='board-1')=>({donor_id:id,donated_at:date,amount_cents:cents,program,board_member_id:member});
test('retention compares matched periods and separates new, reactivated, and lapsed donors',()=>{
 const r=calculateRetention([gift('up','2025-02-01',1000),gift('up','2026-02-01',2000),gift('down','2025-03-01',2000),gift('down','2026-03-01',1000),gift('same','2025-02-01',1000),gift('same','2026-02-01',1000),gift('lapsed','2025-04-01',1000),gift('reactivated','2024-01-01',1000),gift('reactivated','2026-05-01',500),gift('new','2026-06-01',500),gift('outside','2025-10-01',1000),gift('outside','2026-06-01',500),gift('future','2026-12-01',100000)],f,3);
 assert.equal(r.donorTotal,6);assert.equal(r.returning,3);assert.equal(r.new,1);assert.equal(r.reactivated,2);assert.equal(r.lapsed,1);assert.equal(r.increased,1);assert.equal(r.decreased,1);assert.equal(r.unchanged,1);assert.equal(r.retentionRate,.75);assert.equal(r.churnRate,.25);assert.equal(r.giftTotal,55);assert.equal(r.activityCount,3);
});
test('empty periods have null rates and filters apply to complete history',()=>{
 const r=calculateRetention([gift('a','2025-01-01',100,'Other'),gift('a','2026-01-01',200)],{...f,program:'STEM'});
 assert.equal(r.new,1);assert.equal(r.retentionRate,null);assert.equal(r.churnRate,null);
 assert.equal(calculateRetention([gift('a','2026-01-01',100)],{...f,boardMember:'other'}).giftTotal,0);
});
test('date validation and leap-day comparison',()=>{
 assert.equal(previousYear('2024-02-29'),'2023-02-28');
 for(const query of [{from:'2026-02-30',to:'2026-03-01'},{from:'2026-06-30',to:'2026-01-01'},{from:'2025-01-01',to:'2026-01-01'},{from:['2026-01-01'],to:'2026-03-01'}])assert.throws(()=>parseFilters(query));
});
test('invalid financial data fails rather than fabricating a total',()=>assert.throws(()=>calculateRetention([gift('a','2026-02-01','not a number')],f)));
test('reporting key comparison rejects empty, missing and wrong credentials',()=>{
 assert.equal(validKey('Bearer example-secret','example-secret'),true);
 for(const header of [undefined,'example-secret','Bearer wrong','Bearer '])assert.equal(validKey(header,'example-secret'),false);
 assert.equal(validKey('Bearer ',''),false);
});
function response(){return {headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}};}
test('aggregate endpoint denies unauthenticated requests before database access',async()=>{
 const previous=process.env.REPORTING_API_KEY;process.env.REPORTING_API_KEY='test-only-key';
 try{const res=response();await metrics({method:'GET',headers:{},query:f},res);assert.equal(res.statusCode,401);assert.equal(res.body.data,undefined);}finally{if(previous===undefined)delete process.env.REPORTING_API_KEY;else process.env.REPORTING_API_KEY=previous;}
});
test('every report rejects mutations and disables caching',async()=>{
 for(const handler of [metrics,retention,funder]){const res=response();await handler({method:'POST'},res);assert.equal(res.statusCode,405);assert.equal(res.headers.Allow,'GET');assert.equal(res.headers['Cache-Control'],'no-store');}
});
test('restricted reports fail closed when shared authentication is absent',async()=>{
 for(const handler of [retention,funder]){const res=response();await handler({method:'GET',query:f},res);assert.ok([401,403,503].includes(res.statusCode));assert.equal(res.body.data,undefined);}
});

test('authorized metrics return only filtered aggregates, without donor PII',async()=>{
 const {createHandler}=await import('../api/v1/metrics.js');
 const previous=process.env.REPORTING_API_KEY;process.env.REPORTING_API_KEY='test-only-key';
 try{
  const handler=createHandler({connect:async()=>({sql:()=>{}}),giftsFor:async(_,filters)=>{assert.equal(filters.program,'STEM');return [{...gift('private-id','2026-02-01',500),email:'private@example.invalid',name:'Private Donor'}];},activitiesFor:async()=>2});
  const res=response();await handler({method:'GET',headers:{authorization:'Bearer test-only-key'},query:{from:f.from,to:f.to,program:'STEM',boardMember:'board-1'}},res);
  assert.equal(res.statusCode,200);assert.deepEqual(res.body.data,{from:f.from,to:f.to,program:'STEM',boardMember:'board-1',currency:'USD',donorTotal:1,giftTotal:5,giftCount:1,activityCount:2,byProgram:[{name:'STEM',total:5}],byBoardMember:[{name:'board-1',total:5}],monthly:[{month:'2026-02',total:5}]});
  assert.doesNotMatch(JSON.stringify(res.body),/private-id|private@example|Private Donor/);
 }finally{if(previous===undefined)delete process.env.REPORTING_API_KEY;else process.env.REPORTING_API_KEY=previous;}
});
