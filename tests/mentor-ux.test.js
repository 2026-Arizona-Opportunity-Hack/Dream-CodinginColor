import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient} from '../public/js/api.js';
import {parseRoute,profileUrl,rememberDonorList,donorListLocation,givingSummary,donorTimeline,outreachStatus,taskBucket,localDay,boardScoped} from '../public/js/donor-view.js';
import {approvalSteps} from '../public/js/outreach-ui.js';
import {pagedRead} from '../public/js/mentor-data.js';

test('donor profile links round-trip opaque identifiers and retain section state',()=>{
 const route=parseRoute(profileUrl('donor /?#"','timeline'));
 assert.equal(route.screen,'donors');assert.equal(route.donorId,'donor /?#"');assert.equal(route.params.get('tab'),'timeline');
 assert.equal(parseRoute('#donors?sort=giving&q=Alex').params.get('q'),'Alex');
 assert.equal(parseRoute('#donors/%bad').donorId,null);
 rememberDonorList('#donors?q=Alex&sort=giving');assert.equal(donorListLocation(),'#donors?q=Alex&sort=giving');rememberDonorList('https://example.invalid');assert.equal(donorListLocation(),'#donors');
});
test('giving summary never combines currencies or counts pending and unknown gifts as verified',()=>{
 const summary=givingSummary([{id:'usd',amount:'0.10',currency:'USD',status:'completed',donated_at:'2026-01-01'},{id:'usd2',amount:'0.20',currency:'USD',status:'completed',donated_at:'2026-01-02'},{amount:'50',currency:'EUR',status:'completed',donated_at:'2026-01-03'},{amount:'999',currency:'USD',status:'pending',donated_at:'2026-01-04'},{amount:'888',currency:null,status:'completed',donated_at:'2026-01-05'}]);
 assert.deepEqual(summary.totals,['$0.30','€50.00']);assert.equal(summary.unverified,2);assert.equal(summary.lastGift.donated_at,'2026-01-05');
 assert.deepEqual(givingSummary([]).totals,[]);
});
test('categorized timeline distinguishes draft, handoff, attestation, imported gifts and task snapshots',()=>{
 const events=donorTimeline({gifts:[{id:'g',amount:'25',currency:'USD',status:'completed',donated_at:'2026-01-01',import_batch_id:'batch'}],activities:[{id:'n',type:'call',note:'Recorded conversation',created_at:'2026-01-04'}],drafts:[{id:'d',createdAt:'2026-01-02',subject:'A draft',status:'handed_off'}],history:[{id:'h',at:'2026-01-03',status:'handed_off'}],tasks:[{id:'t',title:'Call donor',status:'completed',updatedAt:'2026-01-05'}]});
 assert.equal(events[0].label,'Follow-up record');assert.ok(events.some(e=>e.label==='Imported gift'));assert.ok(events.some(e=>e.label==='Draft prepared'));assert.ok(events.some(e=>e.label==='Handed off'));assert.equal(events.some(e=>e.label==='Human-reported sent'),false);
 assert.equal(outreachStatus({status:'sent',manualSendReference:'Human evidence'}),'Human-reported sent');assert.equal(outreachStatus({status:'approved'}),'Approved');
 assert.match(approvalSteps({status:'handed_off'}),/aria-current="step">3\. Handed off/);
});
test('Today uses local dates, excludes completed work from urgency, and handles missing dates',()=>{
 assert.equal(localDay(new Date('2026-11-15T05:00:00Z'),'America/Phoenix'),'2026-11-14');
 const task=due_date=>({due_date,status:'open'});
 assert.equal(taskBucket(task('2026-11-13'),'2026-11-14'),'overdue');assert.equal(taskBucket(task('2026-11-14'),'2026-11-14'),'today');assert.equal(taskBucket(task('2026-11-21'),'2026-11-14'),'soon');assert.equal(taskBucket(task('2026-11-22'),'2026-11-14'),'later');assert.equal(taskBucket(task(null),'2026-11-14'),'undated');assert.equal(taskBucket({status:'completed',due_date:'2020-01-01'},'2026-11-14'),'closed');
});
test('board presentation follows assignment scoping even for custom roles with broad permissions',()=>{
 assert.equal(boardScoped({roleId:'custom-role',boardMember:true}),true);assert.equal(boardScoped({roleId:'administrator',boardMember:true}),false);assert.equal(boardScoped({roleId:'board-member'}),true);
});
test('paginated reads keep filters, follow has_more and never silently truncate export pages',async()=>{
 const urls=[];const data=await pagedRead('/imports/history?status=preview',async path=>{urls.push(new URL(path,'https://local.invalid'));return {items:urls.length===1?[{id:'one'}]:[{id:'two'}],has_more:urls.length===1};});
 assert.equal(data.length,2);assert.deepEqual(urls.map(u=>u.searchParams.get('offset')),['0','100']);assert.ok(urls.every(u=>u.searchParams.get('status')==='preview'));
 await assert.rejects(()=>pagedRead('/v1/follow-ups',async()=>[]),/unsupported page/);
});
function client(handler){const requests=[];const api=createApiClient(async(path,options)=>{const body=options.body?JSON.parse(options.body):undefined;requests.push({path,method:options.method,body});const data=path==='/api/auth/me'?{csrfToken:'synthetic-csrf',user:{id:'synthetic'}}:handler(path,body);return {ok:true,json:async()=>({data})};});return {api,requests};}
test('merge preview comes only from the server and confirmations include the complete 85b1985 contract',async()=>{
 const {api,requests}=client(path=>path.endsWith('/preview')?{preview_id:'preview-1',blockers:[],warnings:[]}:{});
 await api('/merges/preview',{method:'POST',body:{targetId:'keep',sourceId:'archive',reason:'Independent evidence'}});
 await api('/merges',{method:'POST',body:{targetId:'keep',sourceId:'archive',reason:'Independent evidence',preview_id:'preview-1',confirmed:true,identity_confirmed:true}});
 assert.deepEqual(requests.find(r=>r.path==='/api/merges/preview').body,{canonical_donor_id:'keep',merged_donor_id:'archive',reason:'Independent evidence'});
 assert.deepEqual(requests.find(r=>r.path==='/api/merges').body,{canonical_donor_id:'keep',merged_donor_id:'archive',reason:'Independent evidence',preview_id:'preview-1',confirmed:true,identity_confirmed:true});
 assert.equal(requests.some(r=>r.path.includes('/donors/')),false);
});
test('saved draft revisions update the adapter before approval in the same review visit',async()=>{
 const {api,requests}=client((path,body)=>path==='/api/outreach/drafts'&&!body?[{id:'draft',revision:1}]:path==='/api/outreach/drafts'?{id:'draft',revision:2}:{id:'draft',revision:2,status:'approved'});
 await api('/outreach/drafts');await api('/outreach/drafts/draft',{method:'PATCH',body:{subject:'Updated',body:'Reviewed'}});await api('/outreach/drafts/draft/approve',{method:'POST'});
 assert.equal(requests.find(r=>r.path==='/api/outreach/approve').body.revision,2);
});
test('manual gifts retain the intended save key and do not manufacture transaction references or confirmation overrides',async()=>{
 const {api,requests}=client(()=>({donation:{id:'gift'},duplicate:false}));
 const body={amount:'12.34',currency:'USD',status:'completed',source:'cash',donated_at:'2026-11-15',notes:'Synthetic offline gift',idempotency_key:'manual-intended-save'};
 await api('/donors/donor/donations',{method:'POST',body});await api('/donors/donor/donations',{method:'POST',body});
 const writes=requests.filter(r=>r.path==='/api/donations');assert.deepEqual(writes[0].body,writes[1].body);assert.equal(writes[0].body.donation_date,'2026-11-15');assert.equal(writes[0].body.idempotency_key,'manual-intended-save');assert.equal(writes[0].body.allow_duplicate,undefined);assert.equal(writes[0].body.external_transaction_id,undefined);
});
