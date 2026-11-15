import {approveDraft} from './outreach.js';
import {sendApprovedEmail} from './email-automation.js';
import {assertDraftAccess} from './donor-access.js';
import {check,fail,id,record,text} from './retention-http.js';

const progress=new Set(['sending','queued','sent','delivered','bounced','suppressed']);
export async function approveAndSendEmail(store,actor,input,now=new Date(),options={}){
 record(input,['id','revision','recipient','subject','body','confirmed']);
 check(input.confirmed===true,'Review the recipient and exact message before approving and sending.');
 const draftId=id(input.id),recipient=text(input.recipient,'reviewed recipient',254).toLowerCase();
 check(Number.isSafeInteger(input.revision)&&input.revision>0,'A current draft revision is required.');
 check(typeof input.subject==='string'&&input.subject.length<=200&&typeof input.body==='string'&&input.body.length<=8000,'Review the complete email subject and body.');
 const snapshot=state=>{
  const user=state.users.find(u=>u.id===actor.id&&u.active),role=state.roles.find(r=>r.id===user?.roleId&&r.active!==false);
  if(!role||!['outreach.approve','outreach.send'].every(p=>role.permissions.includes(p)))fail(403,'FORBIDDEN','Approval and email sending permissions are both required.');
  const draft=state.drafts.find(d=>d.id===draftId);if(!draft)fail(404,'NOT_FOUND','Draft not found.');assertDraftAccess(state,actor,draft);
  if(draft.channel!=='email'||draft.audience!=='donor')fail(400,'DONOR_EMAIL_REQUIRED','This action is only for donor email drafts.');
  if(draft.revision!==input.revision||draft.subject!==input.subject||draft.body!==input.body)fail(409,'REVISION_CONFLICT','The message changed. Reload and review the current content before approving.');
  if(state.donors.find(d=>d.id===draft.donorId)?.email?.trim().toLowerCase()!==recipient)fail(409,'RECIPIENT_CHANGED','The donor email changed. Reload and review the current recipient before approving.');
  return draft;
 };
 const approved=await store.transaction(async state=>{
  const draft=snapshot(state);
  if(progress.has(draft.status)||draft.status==='approved')return draft;
  if(draft.status!=='draft')fail(409,'DELIVERY_REVIEW_REQUIRED','Review the previous send outcome before preparing a fresh email. No automatic retry was made.');
  // Reuse approval validation/audit inside this same transaction, without a nested database transaction.
  return approveDraft({transaction:work=>work(state)},actor,{id:draftId,revision:input.revision},now);
 });
 if(progress.has(approved.status))return approved;
 let first=true;
 const claimedStore={kind:store.kind,read:work=>store.read(work),transaction:work=>store.transaction(state=>{
  // Bind review to the send claim; provider-result persistence must still finish if contact data changes afterward.
  if(first){snapshot(state);first=false;}return work(state);
 })};
 try{return await sendApprovedEmail(claimedStore,actor,{id:draftId,revision:input.revision},now,options);}
 catch(error){
  if(error.code==='APPROVAL_REQUIRED'){
   const current=await store.read(snapshot);if(progress.has(current.status))return current;
  }
  throw error;
 }
}
