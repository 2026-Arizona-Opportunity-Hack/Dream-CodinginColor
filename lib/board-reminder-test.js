import {createEmailProvider} from './email-provider.js';
import {reminderOrigin} from './email-automation.js';
import {audit,newId} from './retention-store.js';
import {check,fail,id,record,text} from './retention-http.js';

const TYPE='email.board-test';
function administrator(state,actor){
 const user=state.users.find(u=>u.id===actor.id&&u.active),role=state.roles.find(r=>r.id===user?.roleId&&r.active!==false);
 if(role?.id!=='administrator'||!['settings.manage','outreach.send'].every(p=>role.permissions.includes(p)))fail(403,'FORBIDDEN','An active administrator with email sending permission is required.');
}
const view=event=>({id:event.id,at:event.at,...event.details});
export const boardReminderTestHistory=(store,actor)=>store.read(state=>{administrator(state,actor);return state.events.filter(e=>e.type===TYPE).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,10).map(view);});
export async function sendBoardReminderTest(store,actor,input,now=new Date(),{env=process.env,provider}={}){
 record(input,['recipient','confirmed','idempotencyKey']);check(input.confirmed===true,'Explicitly approve sending ONE real TEST reminder.');
 if(env.EMAIL_DELIVERY_MODE!=='test')fail(403,'EMAIL_TEST_MODE_REQUIRED','One-time reminders require EMAIL_DELIVERY_MODE=test. Automation remains disabled.');
 const recipient=text(input.recipient,'verified test recipient',254).toLowerCase(),request=id(input.idempotencyKey,'idempotencyKey');
 check(request.length>=16,'Use a stable test request identity.');
 const origin=reminderOrigin(env);provider??=createEmailProvider({env});provider.validateRecipient(recipient);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Phoenix',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const subject='[TEST] ColorLoop board follow-up reminder';
 const body=`TEST ONLY: no real donor or follow-up is involved.\nDonor: Illustrative sample (no donor record created)\nNext action: Confirm this TEST email reached the explicitly selected inbox. Do not contact a donor.\nDeadline: ${day} (America/Phoenix)\nOpen ColorLoop follow-ups: ${origin}/#tasks\nThis manual test does not change board account emails or enable scheduled sending.`;
 const key=`board-reminder-test:${actor.id}:${request}`;
 const claim=await store.transaction(state=>{
  administrator(state,actor);const previous=state.events.find(e=>e.key===key);
  if(previous){if(previous.details.recipient!==recipient)fail(409,'IDEMPOTENCY_CONFLICT','This test request was already used for another recipient.');return {event:previous,existing:true};}
  if(state.events.filter(e=>e.type===TYPE&&e.actorId===actor.id&&Date.parse(e.at)>+now-3600000).length>=3)fail(429,'EMAIL_TEST_RATE_LIMITED','At most three one-time reminder tests are permitted per hour.');
  const event={id:newId(),key,type:TYPE,actorId:actor.id,at:now.toISOString(),details:{recipient,subject,body,status:'sending'}};
  state.events.push(event);audit(state,actor.id,'email.board-test.attempt',event.id,now,{status:'sending'});return {event,existing:false};
 });
 if(claim.existing)return {...view(claim.event),alreadyAttempted:true};
 let result;
 try{const receipt=await provider.sendEmail({to:recipient,subject,text:body,idempotencyKey:`board-test:${claim.event.id}`});check(receipt.status==='accepted'&&typeof receipt.id==='string','Unconfirmed provider response.');result={status:'queued',providerId:receipt.id};}
 catch(error){result={status:'failed',code:['EMAIL_RATE_LIMITED','EMAIL_PROVIDER_REJECTED','EMAIL_TRANSPORT_UNKNOWN','EMAIL_RESPONSE_UNKNOWN'].includes(error.providerCode)?error.providerCode:'EMAIL_TEST_FAILED',outcomeUnknown:error.definitelyNotSent!==true};}
 return store.transaction(state=>{const event=state.events.find(e=>e.id===claim.event.id);Object.assign(event.details,result);audit(state,actor.id,'email.board-test.result',event.id,now,result);return view(event);});
}
