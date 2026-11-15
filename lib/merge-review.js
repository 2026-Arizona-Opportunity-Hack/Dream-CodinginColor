import {allowlist,ensure,uuid,text} from './data-validation.js';
import {getDonor,insert} from './donor-data.js';
import {mergeDonors,eventPlan} from './matching.js';
import {fingerprint,writableActor} from './manual-entry.js';
import {newId} from './retention-store.js';

function identities(input){const canonical=uuid(input.canonical_donor_id),merged=uuid(input.merged_donor_id);ensure(canonical!==merged,'Choose two different donors.');return {canonical,merged};}
async function snapshot(query,canonical,merged){
 const ids=[canonical,merged],state={};
 const tables=['donors','donations','activities','activity_history','tasks','outreach_messages','board_assignments','retention_events','verified_funder_outcomes','import_rows','donor_aliases','donor_merge_history'];
 for(const table of tables){
  const condition=table==='donors'?'id=ANY($1::uuid[])':table==='donor_aliases'?'canonical_donor_id=ANY($1::uuid[]) OR alias_donor_id=ANY($1::uuid[])':table==='donor_merge_history'?'canonical_donor_id=ANY($1::uuid[]) OR merged_donor_id=ANY($1::uuid[])':'donor_id=ANY($1::uuid[])';
  state[table]=(await query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE ${condition} ORDER BY to_jsonb(t)::text`,[ids])).rows.map(r=>r.row);
 }
 const messages=state.outreach_messages.map(m=>m.id);
 for(const table of ['outreach_revisions','outreach_approval_history','outreach_delivery_history'])state[table]=(await query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE message_id=ANY($1::uuid[]) ORDER BY to_jsonb(t)::text`,[messages])).rows.map(r=>r.row);
 const owners=[...new Set(state.board_assignments.map(a=>a.assignee_id).concat(state.donors.map(d=>d.assigned_board_member_id)).filter(Boolean))];
 state.owners=(await query('SELECT id,name,email,active,board_member,role_id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id',[owners])).rows;
 return state;
}
async function assess(query,canonical,merged){
 const main=await getDonor(query,canonical),old=await getDonor(query,merged);ensure(!main.archived_at&&!old.archived_at,'Both donors must be active.','MERGE_CONFLICT',409);
 const blockers=[];
 if((await query("SELECT id FROM outreach_messages WHERE donor_id=ANY($1::uuid[]) AND (status IN ('sending','queued') OR outcome_unknown) LIMIT 1",[[canonical,merged]])).rows.length)blockers.push({code:'MERGE_OUTREACH_IN_FLIGHT',message:'Resolve in-flight or unknown outreach delivery before merging.'});
 try{await eventPlan(query,canonical,merged);}catch(error){if(error.code!=='MERGE_EVENT_CONFLICT')throw error;blockers.push({code:error.code,message:error.message});}
 if((await query('SELECT a.id FROM donations a JOIN donations b ON a.donor_id=$1 AND b.donor_id=$2 AND a.external_transaction_id IS NULL AND b.external_transaction_id IS NULL AND a.amount=b.amount AND a.donation_date=b.donation_date AND a.currency IS NOT DISTINCT FROM b.currency LIMIT 1',[canonical,merged])).rows.length)blockers.push({code:'MERGE_AMBIGUOUS_GIFTS',message:'Matching gifts without transaction references require evidence review.'});
 const state=await snapshot(query,canonical,merged);
 return {state,main,old,blockers};
}
const comparison=d=>Object.fromEntries(['id','donor_type','display_name','first_name','last_name','normalized_email','secondary_email','phone','company','organization_name','contact_person','custom_data','assigned_board_member_id','email_consent','sms_consent','opted_out'].map(k=>[k,d[k]??null]));
export async function previewMerge(query,input,actor,now=new Date()){
 allowlist(input,['canonical_donor_id','merged_donor_id','reason']);await query('SELECT pg_advisory_xact_lock(78234902)');await writableActor(query,actor,'donors.write',true);
 const attempts=(await query("SELECT count(*)::int AS n FROM audit_events WHERE actor_id=$1 AND action='donors.merge-preview' AND occurred_at>=now()-interval '15 minutes'",[actor.id])).rows[0].n;ensure(attempts<30,'Too many merge previews. Try again later.','RATE_LIMITED',429);
 const {canonical,merged}=identities(input);for(const id of [canonical,merged].sort())await getDonor(query,id,true);const reason=text(input.reason,500,true);ensure(reason.length>=3,'Provide an identity-verification reason.');
 const {state,main,old,blockers}=await assess(query,canonical,merged),sourceMessages=new Set(state.outreach_messages.filter(m=>m.donor_id===merged).map(m=>m.id)),previewId=newId(),expires=new Date(+now+10*60000).toISOString();
 await insert(query,'audit_events',{id:previewId,actor_id:actor.id,action:'donors.merge-preview',entity_id:canonical,occurred_at:now.toISOString(),details:{canonical,merged,reason,fingerprint:fingerprint(state),expires_at:expires}});
 return {preview_id:previewId,expires_at:expires,canonical:comparison(main),source:comparison(old),affected:Object.fromEntries(Object.entries(state).filter(([k])=>k!=='owners').map(([k,rows])=>[k,rows.filter(r=>r.donor_id===merged||r.canonical_donor_id===merged||r.merged_donor_id===merged||r.id===merged||sourceMessages.has(r.message_id)).length])),blockers,warnings:['Name similarity is not proof of identity. Confirm using independent evidence.','Canonical contact/custom fields stay unchanged; source identity remains archived with the merge audit.','Consent is combined conservatively. Canonical ownership wins when both donors have owners.','Moved unsent approved/handoff/failed messages return to draft and require fresh approval; sent history is preserved.']};
}
export async function confirmMerge(query,input,actor,now=new Date()){
 allowlist(input,['canonical_donor_id','merged_donor_id','reason','preview_id','confirmed','identity_confirmed']);
 ensure(input.confirmed===true&&input.identity_confirmed===true,'Explicitly confirm independently verified identity and the reviewed merge.','MERGE_CONFIRMATION_REQUIRED',409);
 ensure(input.preview_id,'Create a server merge preview before confirming.','MERGE_PREVIEW_REQUIRED',409);
 await query('SELECT pg_advisory_xact_lock(78234902)');await writableActor(query,actor,'donors.write',true);
 const {canonical,merged}=identities(input);for(const id of [canonical,merged].sort())await getDonor(query,id,true);const reason=text(input.reason,500,true),previewId=uuid(input.preview_id);
 const preview=(await query("SELECT * FROM audit_events WHERE id=$1 AND actor_id=$2 AND action='donors.merge-preview' FOR UPDATE",[previewId,actor.id])).rows[0];
 ensure(preview&&preview.details.canonical===canonical&&preview.details.merged===merged&&preview.details.reason===reason,'Preview does not match this actor, direction or reason.','INVALID_MERGE_PREVIEW',409);
 ensure(new Date(preview.details.expires_at)>now,'Merge preview expired; compare the donors again.','STALE_MERGE_PREVIEW',409);
 ensure(!(await query("SELECT id FROM audit_events WHERE action='donors.merge-preview-consumed' AND entity_id=$1 LIMIT 1",[previewId])).rows.length,'This merge preview was already used.','MERGE_PREVIEW_CONSUMED',409);
 const assessed=await assess(query,canonical,merged);ensure(fingerprint(assessed.state)===preview.details.fingerprint,'Records changed after preview. Review a fresh comparison.','STALE_MERGE_PREVIEW',409);
 ensure(!assessed.blockers.length,assessed.blockers[0]?.message,assessed.blockers[0]?.code,409);
 const result=await mergeDonors(query,{canonical_donor_id:canonical,merged_donor_id:merged,reason},actor);
 await insert(query,'audit_events',{id:newId(),actor_id:actor.id,action:'donors.merge-preview-consumed',entity_id:previewId,occurred_at:now.toISOString(),details:{result}});
 return {...result,preview_id:previewId};
}
export async function confirmAlias(query,donorId,input,actor){
 allowlist(input,['source','source_identifier','original_name','confirmed','reason']);ensure(input.confirmed===true,'Explicitly confirm this source identity.');
 await query('SELECT pg_advisory_xact_lock(78234902)');await writableActor(query,actor,'donors.write',true);
 const donor=await getDonor(query,donorId,true);ensure(!donor.archived_at,'Use an active canonical donor.');
 const source=text(input.source,100,true),identifier=text(input.source_identifier,300,true),name=text(input.original_name,300,true),reason=text(input.reason,500,true);ensure(reason.length>=3,'Provide identity-verification evidence.');
 const existing=(await query('SELECT * FROM donor_aliases WHERE source=$1 AND source_identifier=$2',[source,identifier])).rows[0];
 ensure(!existing||existing.canonical_donor_id===donor.id,'Source identity belongs to another donor.','SOURCE_CONFLICT',409);if(existing)return existing;
 const alias=await insert(query,'donor_aliases',{canonical_donor_id:donor.id,original_name:name,source,source_identifier:identifier});
 await insert(query,'audit_events',{id:newId(),actor_id:actor.id,action:'donors.alias-confirmed',entity_id:donor.id,occurred_at:new Date().toISOString(),details:{alias_id:alias.id,source,reason}});return alias;
}
