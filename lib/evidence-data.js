import {allowlist,ensure,text,date,uuid} from './data-validation.js';
import {getDonor,insert} from './donor-data.js';
import {newId} from './retention-store.js';
export async function recordOutcome(query,input,actor){
  allowlist(input,['donor_id','description','evidence_reference','verified_at','period_start','period_end','program']);
  await query('SELECT pg_advisory_xact_lock(78234902)');
  const donor=await getDonor(query,uuid(input.donor_id),true);
  ensure(!donor.archived_at,'Use an active canonical donor.');
  const start=date(input.period_start),end=date(input.period_end),verified=date(input.verified_at);
  ensure(start<=end&&verified<=new Date().toISOString().slice(0,10),'Invalid evidence period or future verification.');
  const outcome=await insert(query,'verified_funder_outcomes',{donor_id:donor.id,description:text(input.description,4000,true),evidence_reference:text(input.evidence_reference,1000,true),verified_at:verified,period_start:start,period_end:end,program:text(input.program,120),board_member_id:donor.assigned_board_member_id,recorded_by:actor.id});
  await query("INSERT INTO audit_events(id,actor_id,action,entity_id,occurred_at,details) VALUES ($1,$2,'outcomes.record',$3,now(),$4)",[newId(),actor.id,outcome.id,JSON.stringify({donorId:donor.id,evidence:outcome.evidence_reference})]);
  return outcome;
}
