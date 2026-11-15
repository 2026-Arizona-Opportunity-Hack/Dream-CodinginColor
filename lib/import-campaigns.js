import {newId} from './retention-store.js';
import {allowlist,ensure,text,uuid} from './data-validation.js';
import {saveCampaign} from './custom-field-data.js';
export async function inspectCampaign(query,data){
 if(!data.donation)return null;
 if(data.donation.campaign_id){
  const rows=(await query('SELECT id,name FROM campaigns WHERE id=$1 AND archived_at IS NULL',[data.donation.campaign_id])).rows;
  ensure(rows.length,'Campaign ID is missing or archived.');return {name:data.campaign||rows[0].name,status:'matched',candidates:rows};
 }
 if(!data.campaign)return null;
 const rows=(await query('SELECT id,name FROM campaigns WHERE lower(btrim(name))=lower(btrim($1)) AND archived_at IS NULL ORDER BY id LIMIT 101',[data.campaign])).rows;
 if(rows.length===1)data.donation.campaign_id=rows[0].id;
 return {name:data.campaign,status:rows.length===1?'matched':rows.length?'ambiguous':'missing',candidates:rows};
}
export async function confirmCampaign(query,data,decision,actor){
 if(!data.donation){ensure(!decision,'Campaign decisions require a gift.');return;}
 if(decision){
  allowlist(decision,['action','id','name','approved']);ensure(['map','create','none'].includes(decision.action),'Choose a campaign review action.');
  if(decision.action==='none'){data.donation.campaign_id=null;return;}
  if(decision.action==='map'){
   const id=uuid(decision.id);ensure((await query('SELECT id FROM campaigns WHERE id=$1 AND archived_at IS NULL',[id])).rows.length,'Choose an active campaign.');data.donation.campaign_id=id;return;
  }
  ensure(decision.approved===true,'Explicit approval is required to create a campaign.','CAMPAIGN_APPROVAL_REQUIRED',409);
  ensure(actor.permissions?.includes('settings.manage'),'Campaign creation requires settings.manage.','FORBIDDEN',403);
  const name=text(decision.name||data.campaign,200,true);
  const existing=(await query('SELECT id,archived_at FROM campaigns WHERE lower(btrim(name))=lower(btrim($1)) ORDER BY id LIMIT 2',[name])).rows;
  ensure(existing.length<2,'Campaign name is ambiguous; map to a specific active campaign.','CAMPAIGN_REVIEW_REQUIRED',409);
  if(existing[0]){ensure(!existing[0].archived_at,'This campaign is archived. Choose an active campaign or leave it unassigned.');data.donation.campaign_id=existing[0].id;}
  else{data.donation.campaign_id=(await saveCampaign(query,{name})).id;await query("INSERT INTO audit_events(id,actor_id,action,entity_id,occurred_at,details) VALUES ($1,$2,'campaigns.create-from-import',$3,now(),$4)",[newId(),actor.id,data.donation.campaign_id,JSON.stringify({approved:true,name})]);}
  return;
 }
 const review=await inspectCampaign(query,data);
 ensure(!review||review.status==='matched','Review the campaign: map, explicitly create, or leave it unassigned.','CAMPAIGN_REVIEW_REQUIRED',409);
}
