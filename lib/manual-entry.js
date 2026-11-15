import {createHash} from 'node:crypto';
import {allowlist,donorKeys,donorInput,donationInput,ensure,text,uuid} from './data-validation.js';
import {createDonor,getDonor,addDonation,insert} from './donor-data.js';
import {matchDonor} from './matching.js';
import {assignReviewedOwner} from './assignment-sql.js';
import {prepareDonationThanks} from './communication-sql.js';
import {newId} from './retention-store.js';

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export async function writableActor(query,actor,permission,staffOnly=false){
 const user=(await query(`SELECT u.id,u.role_id,u.active,u.board_member,r.active AS role_active,
   ARRAY(SELECT permission_name FROM role_permissions WHERE role_id=u.role_id) AS permissions
   FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1`,[uuid(actor.id)])).rows[0];
 ensure(user?.active&&user.role_active&&user.permissions.includes(permission),'Your permission changed or does not allow this operation.','FORBIDDEN',403);
 const scoped=user.role_id!=='administrator'&&(user.board_member||user.role_id==='board-member');
 ensure(!staffOnly||!scoped,'This operation requires a staff account.','FORBIDDEN',403);return {...user,scoped};
}
function controls(input){
 if(input.allow_duplicate!==undefined)ensure(typeof input.allow_duplicate==='boolean','Invalid duplicate decision.');
 const reason=text(input.duplicate_reason,500);
 if(input.allow_duplicate)ensure(reason&&reason.length>=3,'Explain why this is a distinct record.');
 let key=input.idempotency_key;
 if(key!==undefined){ensure(typeof key==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(key),'Use a stable 8–100 character idempotency key.');key=fingerprint(key);}
 return {key,reason};
}
async function previous(query,actor,action,key,payload){
 if(!key)return null;
 const row=(await query("SELECT details FROM audit_events WHERE actor_id=$1 AND action=$2 AND details->>'request_key'=$3 ORDER BY occurred_at,id LIMIT 1",[actor.id,action,key])).rows[0];
 if(row)ensure(row.details.request_hash===fingerprint(payload),'Idempotency key was used for different input.','IDEMPOTENCY_CONFLICT',409);
 return row?.details.result||null;
}
async function auditEntry(query,actor,action,id,key,payload,result,extra={}){
 await query('INSERT INTO audit_events(id,actor_id,action,entity_id,occurred_at,details) VALUES ($1,$2,$3,$4,now(),$5)',[newId(),actor.id,action,id,JSON.stringify({...extra,...(key?{request_key:key,request_hash:fingerprint(payload)}:{}),result})]);
}
async function note(query,donorId,content,actor){
 if(!content)return null;const id=newId(),at=new Date().toISOString();
 await insert(query,'activities',{id,donor_id:donorId,type:'note',content,occurred_at:at,created_by:actor.id,created_at:at,updated_by:actor.id,updated_at:at});return id;
}
export async function createManualDonor(query,input,actor){
 allowlist(input,[...donorKeys,'owner_id','notes','idempotency_key','allow_duplicate','duplicate_reason']);
 await query('SELECT pg_advisory_xact_lock(78234902)');const user=await writableActor(query,actor,'donors.write',true),{key,reason}=controls(input);
 const fields=Object.fromEntries(Object.entries(input).filter(([k])=>donorKeys.includes(k)));
 fields.donor_type??='person';const normalized=await donorInput(query,fields),notes=text(input.notes,4000),owner=input.owner_id?uuid(input.owner_id):null;
 // Archive timestamps are generated per request; hash the user's decision instead.
 const {archived_at,...stableFields}=normalized;if('archived' in fields)stableFields.archived=fields.archived;
 const payload={fields:stableFields,notes,owner,distinct:input.allow_duplicate===true,reason};
 const replay=await previous(query,actor,'manual.donor-created',key,payload);if(replay){const alias=(await query('SELECT canonical_donor_id FROM donor_aliases WHERE alias_donor_id=$1',[replay.donor_id])).rows[0];return {...await getDonor(query,alias?.canonical_donor_id||replay.donor_id),replayed:true,note_activity_id:replay.note_activity_id};}
 const matching=await matchDonor(query,normalized,null,null);
 ensure(!matching.candidates.length||input.allow_duplicate===true,'Possible donor duplicate. Review candidates before explicitly creating a distinct record.','DUPLICATE_DONOR',409);
 if(owner)ensure(user.permissions.includes('assignments.manage'),'Selecting an owner requires assignments.manage.','FORBIDDEN',403);
 const donor=await createDonor(query,fields,actor.id);
 if(owner){await assignReviewedOwner(query,donor.id,owner,actor.id);donor.assigned_board_member_id=owner;}
 const noteId=await note(query,donor.id,notes,actor),result={donor_id:donor.id,note_activity_id:noteId};
 await auditEntry(query,actor,'manual.donor-created',donor.id,key,payload,result,{duplicate_review:input.allow_duplicate===true,reason});
 return {...donor,note_activity_id:noteId,replayed:false};
}
export async function recordManualGift(query,input,actor){
 const extras=['notes','idempotency_key','allow_duplicate','duplicate_reason'];
 const fields=Object.fromEntries(Object.entries(input).filter(([k])=>!extras.includes(k))),normalized=donationInput(fields),notes=text(input.notes,4000),{key,reason}=controls(input);
 await query('SELECT pg_advisory_xact_lock(78234902)');const user=await writableActor(query,actor,'donations.write');
 const donor=await getDonor(query,normalized.donor_id,true);
 ensure(!user.scoped||donor.assigned_board_member_id===actor.id,'This donor is outside your board assignments.','DONOR_ACCESS_DENIED',403);
 const payload={gift:normalized,notes,distinct:input.allow_duplicate===true,reason};
 const replay=await previous(query,actor,'manual.gift-recorded',key,payload);
 if(replay){const gift=(await query('SELECT * FROM donations WHERE id=$1',[replay.donation_id])).rows[0];ensure(gift,'Original gift is unavailable.','DATA_CONFLICT',409);return {donation:gift,duplicate:true,note_activity_id:replay.note_activity_id};}
 if(!normalized.external_transaction_id){
  const possible=(await query('SELECT id FROM donations WHERE donor_id=$1 AND amount=$2 AND donation_date=$3 AND currency IS NOT DISTINCT FROM $4 LIMIT 1',[normalized.donor_id,normalized.amount,normalized.donation_date,normalized.currency])).rows.length;
  ensure(!possible||input.allow_duplicate===true,'A gift with this amount and date exists. Review before recording a distinct gift.','POSSIBLE_DUPLICATE_GIFT',409);
 }
 const result=await addDonation(query,fields);let noteId=null;
 if(!result.duplicate){noteId=await note(query,donor.id,notes?`Gift ${normalized.amount} ${normalized.currency||'(currency unknown)'} on ${normalized.donation_date}: ${notes}`:null,actor);await prepareDonationThanks(query,[result.donation.id],actor.id);}
 else if(notes){const old=(await query("SELECT details FROM audit_events WHERE action='manual.gift-recorded' AND entity_id=$1 AND details->>'gift_input_hash'=$2 ORDER BY occurred_at LIMIT 1",[result.donation.id,fingerprint(payload)])).rows[0];ensure(old,'Gift already exists; add additional notes through donor activities.','TRANSACTION_CONFLICT',409);noteId=old.details.result.note_activity_id;}
 const saved={donation_id:result.donation.id,note_activity_id:noteId};
 await auditEntry(query,actor,'manual.gift-recorded',result.donation.id,key,payload,saved,{gift_input_hash:fingerprint(payload),duplicate_review:input.allow_duplicate===true,reason});
 return {...result,note_activity_id:noteId};
}
