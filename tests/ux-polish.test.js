import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignGroups,reviewedImportRows,importSummary} from '../public/js/import-review.js';
import {donorChoices,displayDate,displayMoney,timeOrder} from '../public/js/ui.js';
import {listDrafts} from '../lib/outreach.js';
const row=(number,name,email,matched=false)=>({row_number:number,errors:[],data:{donor:{donor_type:'person',display_name:'Demo Alex',normalized_email:email},donation:{amount:'25'},board_contact:null},matching:{candidates:[],reason:'new'},campaign_review:{name,status:matched?'matched':'missing'}});

test('campaign names group by trimmed case, require one approval and expand safely with row exceptions',()=>{
 const preview={rows:[row(2,' DEMO Summer ','alex@example.test'),row(3,'demo summer','alex@example.test'),row(4,'DEMO Fall','blair@example.test')]};
 const groups=campaignGroups(preview.rows);assert.deepEqual(groups.map(g=>g.rows.length),[2,1]);
 const choices={'campaign:0':'create','campaign:0:approved':'on','campaign:1':'map:existing-campaign'};
 const decisions=reviewedImportRows(preview,choices,groups);
 assert.deepEqual(decisions[2].campaign,decisions[3].campaign);assert.equal(decisions[2].campaign.approved,true);assert.equal(decisions[4].campaign.id,'existing-campaign');
 assert.equal(reviewedImportRows(preview,{...choices,'campaign-row:3':'none'},groups)[3].campaign.action,'none');
 assert.throws(()=>reviewedImportRows(preview,{'campaign:0':'create','campaign:1':'none'},groups),/Explicitly approve/);
 assert.throws(()=>reviewedImportRows(preview,{'campaign:0':'keep','campaign:1':'none'},groups),/Review the campaign/);
 assert.deepEqual(importSummary(preview),{valid:3,donors:2,donations:3,existing:0,possibleDuplicates:0,campaigns:2});
});
test('matched campaigns retain server matches; duplicate and ownership decisions remain row-specific',()=>{
 const a=row(2,'Matched','alex@example.test',true);a.matching={match:'donor-a',reason:'existing_transaction',candidates:['donor-a']};a.possible_duplicate_gift=true;a.data.board_contact='board@example.test';
 assert.throws(()=>reviewedImportRows({rows:[a]},{'campaign:0':'keep'}),/ownership/);
 const decision=reviewedImportRows({rows:[a]},{'campaign:0':'keep','owner:2':'balanced','donor:2':'donor-a','duplicate:2':'on'})[2];
 assert.deepEqual(decision,{donor_id:'donor-a',allow_possible_duplicate:true,use_balanced_assignment:true});
 const summary=importSummary({rows:[a]});assert.equal(summary.existing,1);assert.equal(summary.possibleDuplicates,1);
});
test('donor selection searches names/emails and distinguishes equal names without altering internal IDs',()=>{
 const donors=[{id:'one',name:'Demo Alex',email:'alex@example.test'},{id:'two',name:'Demo Alex',email:'other@example.test'},{id:'three',name:'Demo Blair'}];
 assert.deepEqual(donorChoices(donors,'ALEX').map(d=>d.id),['one','two']);assert.equal(donorChoices(donors,'OTHER@')[0].id,'two');
 assert.notEqual(donorChoices(donors)[0].label,donorChoices(donors)[1].label);assert.equal(donorChoices(donors,'absent').length,0);
 assert.notEqual(donorChoices([{id:'a',name:'Same'},{id:'b',name:'Same'}])[0].label,donorChoices([{id:'a',name:'Same'},{id:'b',name:'Same'}])[1].label);
});
test('readable times preserve date-only gift dates and sort timezone offsets by actual instants',()=>{
 assert.equal(displayDate('2026-06-15','America/Phoenix'),'Jun 15, 2026');
 assert.match(displayDate('2026-11-15T05:13:58.721+00:00','America/Phoenix'),/Nov 14, 2026.*10:13 PM/);
 assert.ok(timeOrder('2026-01-01T01:00:00-07:00')>timeOrder('2026-01-01T07:30:00Z'));
 assert.equal(displayMoney('1000','USD'),'$1,000.00');assert.match(displayMoney('25',null),/currency unknown/);assert.equal(displayDate(null),'Not recorded');
});
test('outreach display metadata respects assignment scope and never guesses gift links',()=>{
 const state={donors:[{id:'a',name:'Demo Alex',email:'alex@example.test'},{id:'b',name:'Private donor',email:'private@example.test'}],users:[],assignments:[{donorId:'a',assigneeId:'board',active:true}],donations:[{id:'gift-a',donorId:'a',amountCents:10000,currency:'USD',donatedAt:'2026-06-15'}],drafts:[{id:'draft-a',donorId:'a',donationId:'gift-a',channel:'email'},{id:'draft-b',donorId:'b',channel:'email'},{id:'draft-unlinked',donorId:'a',donationId:'other',channel:'email'}]};
 const result=listDrafts(state,{}, {id:'board',roleId:'board-member'});assert.equal(result.length,2);assert.equal(JSON.stringify(result).includes('private@example.test'),false);
 assert.equal(result[0].donorName,'Demo Alex');assert.equal(result[0].recipientEmail,'alex@example.test');assert.equal(result[0].gift.amountCents,10000);assert.equal(result[1].gift,null);
 state.users.push({id:'board',email:'board@example.test',name:'Board account'});state.drafts.push({id:'own-board-summary',audience:'board',userId:'board',donorId:'b',donationId:'gift-a',channel:'email'});
 const ownSummary=listDrafts(state,{}, {id:'board',roleId:'board-member'}).find(d=>d.id==='own-board-summary');assert.equal(ownSummary.donorName,null);assert.equal(ownSummary.gift,null);assert.equal(ownSummary.recipientEmail,'board@example.test');
});
