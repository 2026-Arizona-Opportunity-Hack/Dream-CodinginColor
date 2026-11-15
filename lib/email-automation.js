import {createEmailProvider,emailConfiguration} from './email-provider.js';
import {createDraftInTransaction,sendDraft,validDonations} from './outreach.js';
import {audit,newId} from './retention-store.js';
import {digest} from './permissions.js';
import {canAccessDonor} from './donor-access.js';
import {check,fail,record,text} from './retention-http.js';

const TEMPLATE='board-reminder-v1',MAX_BATCH=25;
const policy=state=>({donorEnabled:false,boardEnabled:false,...state.settings.emailPolicy});
const principal=(state,id)=>{
 const user=state.users.find(u=>u.id===id&&u.active),role=user&&state.roles.find(r=>r.id===user.roleId&&r.active!==false);
 return role?{...user,permissions:role.permissions,administrator:role.id==='administrator'}:null;
};
function operator(state,id){
 const actor=principal(state,id);
 if(!actor||(!actor.administrator&&(actor.boardMember||actor.roleId==='board-member'))||!['tasks.manage','outreach.write','outreach.send'].every(p=>actor.permissions.includes(p)))fail(403,'EMAIL_AUTOMATION_FORBIDDEN','The automation account requires staff task, outreach and send permissions.');
 return actor;
}
export async function readEmailSettings(store,env=process.env){return store.read(state=>({policy:policy(state),configuration:emailConfiguration(env),storageReady:store.kind!=='sql'||Object.hasOwn(state.settings,'emailPolicy')}));}
export async function saveEmailSettings(store,actor,input,now=new Date(),env=process.env){
 record(input,['donorEnabled','boardEnabled','confirmed','reason']);check(input.confirmed===true,'Explicitly confirm the email automation policy.');
 for(const key of ['donorEnabled','boardEnabled'])check(typeof input[key]==='boolean','Choose whether each email workflow is enabled.');
 const reason=text(input.reason,'approval reason',1000);check(reason.length>=10,'Record the approval decision and reference.');
 const configuration=emailConfiguration(env);
 if(input.donorEnabled&&!configuration.testOnly&&!configuration.cicApproved)fail(403,'CIC_APPROVAL_REQUIRED','Live donor automation requires CIC approval recorded in server configuration.');
 return store.transaction(state=>{
  if(store.kind==='sql'&&!Object.hasOwn(state.settings,'emailPolicy'))fail(503,'EMAIL_MIGRATION_REQUIRED','Email automation policy requires reviewed migration 010. No policy was changed.');
  const current=principal(state,actor.id);if(!current?.administrator||!current.permissions.includes('settings.manage')||!current.permissions.includes('outreach.approve'))fail(403,'FORBIDDEN','An active administrator with settings and approval permissions must approve this policy.');
  const value={donorEnabled:input.donorEnabled,boardEnabled:input.boardEnabled,boardTemplateVersion:TEMPLATE,approvedBy:actor.id,approvedAt:now.toISOString(),reason};
  state.settings.emailPolicy=value;audit(state,actor.id,'email.policy.updated','email-automation',now,value);return value;
 });
}
const localDay=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Phoenix',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
// Legacy date-only inputs are stored at UTC midnight; keep their calendar date.
export const followUpDay=value=>{const date=new Date(value),iso=date.toISOString();return iso.endsWith('T00:00:00.000Z')?iso.slice(0,10):localDay(date);};
export function reminderWindow(dueAt,now){
 if(typeof dueAt!=='string'||!dueAt.trim()||!Number.isFinite(+new Date(dueAt)))return null;
 const due=followUpDay(dueAt),today=localDay(now),days=Math.round((Date.parse(due)-Date.parse(today))/86400000);
 return days>0&&days<=3?`approaching:${due}`:days===0?`due:${due}`:days<0?`overdue:${Math.floor((-days-1)/7)}`:null;
}
const suppressed=(state,email)=>state.events.some(e=>e.type==='email.suppression'&&e.details?.recipientHash===digest(email.toLowerCase()));
function reminderOrigin(env){
 try{
  const url=new URL(env.APP_ORIGIN),hosted=env.VERCEL==='1'||!!env.VERCEL_ENV||env.NODE_ENV==='production';
  check(url.protocol==='https:'&&url.origin===env.APP_ORIGIN,'Configure the exact HTTPS application origin.');
  check(!hosted||!(/^(?:localhost|0\.0\.0\.0|127\.[\d.]+|\[::1\])$|\.localhost$/i.test(url.hostname.replace(/\.$/,''))),'Hosted reminders require the deployed website origin.');
  return url.origin;
 }catch{fail(503,'EMAIL_ORIGIN_UNCONFIGURED','Configure the exact deployed HTTPS application origin for reminder links.');}
}
function authorizeDispatch(state,draft,userId,configuration,now,env){
 operator(state,userId);const current=policy(state),approver=principal(state,draft.approvedBy);
 if(!approver?.permissions.includes('outreach.approve'))fail(403,'APPROVAL_REVOKED','The message approver is no longer eligible. Review it again.');
 if(draft.audience==='donor'){
  if(!current.donorEnabled||(!configuration.testOnly&&!configuration.cicApproved))fail(403,'DONOR_AUTOMATION_DISABLED','Donor automation remains disabled pending CIC and administrator approval.');
  if(!canAccessDonor(state,approver,draft.donorId))fail(403,'APPROVAL_REVOKED','The approver no longer has access to this donor.');
  if(draft.donationId&&!validDonations(state,draft.donorId,now).some(g=>g.id===draft.donationId))fail(409,'GIFT_CHANGED','The linked gift is no longer a verified completed donation. Review the message.');
 }else{
  if(!current.boardEnabled)fail(403,'BOARD_AUTOMATION_DISABLED','Internal reminder automation is disabled.');
  const member=principal(state,draft.userId);if(!member?.boardMember)fail(403,'RECIPIENT_INACTIVE','The assigned board account is no longer eligible.');
  if(draft.eventKey?.startsWith('board-reminder:')){
   const event=state.events.find(e=>e.draftId===draft.id&&e.type==='email.board-reminder'),task=state.tasks.find(t=>t.id===event?.taskId);
   if(!task||!['open','in_progress'].includes(task.status)||task.assigneeId!==member.id||task.dueAt!==event.details?.dueAt||reminderWindow(task.dueAt,now)!==event.details?.window||!state.donors.some(d=>d.id===task.donorId&&d.active)||!state.assignments.some(a=>a.active&&a.donorId===task.donorId&&a.assigneeId===member.id))fail(409,'REMINDER_CHANGED','The follow-up changed or was completed; this reminder will not be sent.');
   if(!draft.body.endsWith(`\nOpen ColorLoop: ${reminderOrigin(env)}/#tasks?task=${encodeURIComponent(task.id)}`))fail(409,'REMINDER_LINK_CHANGED','The approved reminder link does not match this website. Review a fresh reminder.');
  }
 }
 const to=draft.audience==='donor'?state.donors.find(d=>d.id===draft.donorId)?.email:state.users.find(u=>u.id===draft.userId)?.email;
 if(to&&suppressed(state,to))fail(403,'EMAIL_SUPPRESSED','This recipient is suppressed after a provider bounce or complaint.');
}
async function prepareBoardReminders(store,actor,now,env){
 return store.transaction(state=>{
  operator(state,actor.id);const p=policy(state),approver=principal(state,p.approvedBy);
  if(!p.boardEnabled||p.boardTemplateVersion!==TEMPLATE||!approver?.administrator||!approver.permissions.includes('settings.manage')||!approver.permissions.includes('outreach.approve'))return [];
  const origin=reminderOrigin(env);
  const prepared=[];
  for(const task of state.tasks.filter(t=>['open','in_progress'].includes(t.status))){
   const member=principal(state,task.assigneeId),donor=state.donors.find(d=>d.id===task.donorId&&d.active),window=reminderWindow(task.dueAt,now);
   if(!window||typeof task.nextAction!=='string'||!task.nextAction.trim()||!member?.boardMember||!donor||!state.assignments.some(a=>a.active&&a.donorId===task.donorId&&a.assigneeId===member.id))continue;
   const key=`board-reminder:${task.id}:${member.id}:${digest(task.dueAt).slice(0,16)}:${window}`;
   const existed=state.drafts.some(d=>d.eventKey===key);
   const draft=createDraftInTransaction(state,{audience:'board',userId:member.id,channel:'email',subject:'Coding in Color: donor follow-up reminder',body:`Follow-up for ${donor.name}\nNext action: ${task.nextAction}\nDue: ${followUpDay(task.dueAt)} (America/Phoenix)\nStatus: ${window.split(':')[0]}\nOpen ColorLoop: ${origin}/#tasks?task=${encodeURIComponent(task.id)}`},actor.id,now,key);
   // Explicit administrator approval covers this fixed internal template, not donor content.
   if(!existed&&draft.status==='draft'){
    draft.status='approved';draft.approvedBy=approver.id;draft.approvedRevision=draft.revision;draft.approvedAt=p.approvedAt;
    audit(state,approver.id,'email.board-template.approved',draft.id,now,{template:TEMPLATE,policyApprovedAt:p.approvedAt});
    state.events.push({id:newId(),key,type:'email.board-reminder',donorId:donor.id,taskId:task.id,draftId:draft.id,actorId:actor.id,at:now.toISOString(),details:{dueAt:task.dueAt,window}});
   }
   prepared.push(draft.id);
  }
  return prepared;
 });
}
async function reconcile(store,actor,provider,now,canContinue){
 const messages=await store.read(state=>{
  const checked=id=>Math.max(0,...state.audit.filter(a=>a.action==='email.status.checked'&&a.entityId===id).map(a=>Date.parse(a.at)));
  return state.drafts.filter(d=>['queued','sent','delivered'].includes(d.status)&&d.providerId&&d.providerId!=='human-attested'&&Date.parse(d.createdAt)>+now-30*86400000).sort((a,b)=>checked(a.id)-checked(b.id)||a.createdAt.localeCompare(b.createdAt)).slice(0,MAX_BATCH);
 });
 let changed=0;
 for(const message of messages){
  if(!canContinue())break;
  let receipt;try{receipt=await provider.getStatus(message.providerId);}catch{await store.transaction(s=>audit(s,actor.id,'email.status.checked',message.id,now,{code:'EMAIL_STATUS_UNAVAILABLE'}));continue;}
  await store.transaction(state=>{
   const draft=state.drafts.find(d=>d.id===message.id);audit(state,actor.id,'email.status.checked',message.id,now,{event:receipt.event});
   if(!draft||draft.providerId!==receipt.id||draft.status===receipt.status)return;
   // Never regress delivery evidence to a less advanced provider event.
   if(draft.status==='delivered'&&!['bounced','suppressed'].includes(receipt.status))return;
   if(draft.status==='sent'&&receipt.status==='queued')return;
   const attempt=[...state.sendHistory].filter(h=>h.draftId===draft.id&&h.providerId===receipt.id).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];if(!attempt)return;
   draft.status=receipt.status;draft.updatedAt=now.toISOString();if(['sent','delivered'].includes(receipt.status))draft.sentAt??=now.toISOString();
   const code=`PROVIDER_${receipt.event.toUpperCase()}`;
   if(!state.sendHistory.some(h=>h.attemptId===attempt.attemptId&&h.status===receipt.status))state.sendHistory.push({id:newId(),draftId:draft.id,attemptId:attempt.attemptId,status:receipt.status,providerId:receipt.id,code,at:now.toISOString()});
   if(['bounced','suppressed'].includes(receipt.status)){
    const original=state.sendHistory.find(h=>h.attemptId===attempt.attemptId&&h.recipient),hash=original?.recipient&&digest(original.recipient.toLowerCase());
    if(hash&&!state.events.some(e=>e.key===`email-suppressed:${hash}`))state.events.push({id:newId(),key:`email-suppressed:${hash}`,type:'email.suppression',actorId:actor.id,at:now.toISOString(),details:{recipientHash:hash,reason:receipt.event}});
   }
   audit(state,actor.id,'email.delivery.recorded',draft.id,now,{status:receipt.status,code});changed++;
  });
 }
 return changed;
}
export async function processEmailAutomation(store,userId,now=new Date(),{env=process.env,provider}={}){
 const deadline=Date.now()+35000,canContinue=()=>Date.now()<deadline;
 const configuration=emailConfiguration(env);
 if(configuration.mode==='disabled')return {enabled:false,queued:0,failed:0,blocked:0,deliveryUpdates:0};
 const actor=await store.read(state=>operator(state,userId));
 provider??=createEmailProvider({env});
 const deliveryUpdates=await reconcile(store,actor,provider,now,canContinue);
 await prepareBoardReminders(store,actor,now,env);
 const candidates=await store.read(state=>{
  const lastBlocked=id=>Math.max(0,...state.audit.filter(a=>a.action==='email.dispatch.blocked'&&a.entityId===id).map(a=>Date.parse(a.at)));
  return state.drafts.filter(d=>d.channel==='email'&&(d.audience==='donor'?policy(state).donorEnabled:policy(state).boardEnabled)&&(d.status==='approved'||(d.status==='failed'&&!d.outcomeUnknown))).sort((a,b)=>lastBlocked(a.id)-lastBlocked(b.id)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).slice(0,100);
 });
 const result={enabled:true,queued:0,failed:0,blocked:0,deliveryUpdates};let attempts=0;
 for(const candidate of candidates){
  if(attempts>=MAX_BATCH||!canContinue())break;
  if(candidate.status==='failed'){
   const retry=await store.transaction(state=>{
    const draft=state.drafts.find(d=>d.id===candidate.id),history=state.sendHistory.filter(h=>h.draftId===candidate.id),last=history.filter(h=>h.status==='failed').sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0],count=history.filter(h=>h.status==='sending').length;
    if(draft?.status!=='failed'||draft.outcomeUnknown||last?.code!=='EMAIL_RATE_LIMITED'||count>=3||+now<Date.parse(last.at)+15*60000*2**(count-1))return false;
    authorizeDispatch(state,draft,actor.id,configuration,now,env);draft.status='approved';return true;
   }).catch(()=>false);if(!retry)continue;
  }
  try{
   let submitted=false;
   const sent=await sendDraft(store,actor,{id:candidate.id,revision:candidate.revision},now,{...provider,sendEmail:payload=>{submitted=true;return provider.sendEmail(payload);},authorizeClaim:(s,d)=>authorizeDispatch(s,d,actor.id,configuration,now,env)});
   if(submitted&&sent.status==='queued')result.queued++;if(submitted)attempts++;
  }catch(error){
   if(error.code==='DELIVERY_FAILED'){result.failed++;attempts++;}else{
    result.blocked++;
    await store.transaction(state=>{if(!state.audit.some(a=>a.action==='email.dispatch.blocked'&&a.entityId===candidate.id&&a.details?.code===error.code&&a.details?.revision===candidate.revision&&a.at.slice(0,10)===now.toISOString().slice(0,10)))audit(state,actor.id,'email.dispatch.blocked',candidate.id,now,{code:error.code||'EMAIL_BLOCKED',revision:candidate.revision});});
   }
  }
 }
 return result;
}
