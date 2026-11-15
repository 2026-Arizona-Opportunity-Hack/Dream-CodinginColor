import {ApiError} from './retention-http.js';

export function emailConfiguration(env=process.env){
 const mode=env.EMAIL_DELIVERY_MODE||'disabled';
 return {mode,testOnly:mode==='test'||env.NODE_ENV!=='production'||env.COLORLOOP_DEMO==='true',
  configured:!!(env.RESEND_API_KEY&&env.EMAIL_FROM),testInboxesConfigured:!!env.EMAIL_TEST_INBOXES?.trim(),cronEnabled:env.EMAIL_CRON_ENABLED==='true',
  cicApproved:env.CIC_DONOR_AUTOMATION_APPROVED==='true'&&!!env.CIC_EMAIL_APPROVAL_REFERENCE?.trim()};
}
function realAddress(value){
 if(typeof value!=='string'||value.length>254||! /^[^\s@<>,;]+@[^\s@<>,;]+$/.test(value))return false;
 const [local,domain]=value.toLowerCase().split('@'),labels=domain.split('.');
 if(local.length>64||labels.length<2||!labels.every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))return false;
 return !/(?:^|\.)(?:example\.(?:com|net|org)|resend\.dev)$|\.(?:test|invalid|localhost|example)$/.test(domain);
}
function deliveryError(code,definitelyNotSent=false,retryable=false){
 return Object.assign(new ApiError(502,code,'Email delivery was not confirmed. Review delivery history before retrying.'),{definitelyNotSent,retryable,providerCode:code});
}
export function createEmailProvider({env=process.env,fetcher=globalThis.fetch}={}){
 const configuration=emailConfiguration(env),from=env.EMAIL_FROM?.trim(),key=env.RESEND_API_KEY;
 if(configuration.mode==='disabled')throw new ApiError(503,'EMAIL_DISABLED','Email delivery is disabled. Manual handoff remains available.');
 const defaultTestSender=configuration.testOnly&&from?.toLowerCase()==='onboarding@resend.dev';
 if(!['test','live'].includes(configuration.mode)||!key||(!realAddress(from)&&!defaultTestSender))throw new ApiError(503,'EMAIL_UNCONFIGURED','Configure a server-side Resend credential and verified sender address.');
 const inboxes=new Set((env.EMAIL_TEST_INBOXES||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean));
 const validateRecipient=to=>{
  if(!realAddress(to))throw new ApiError(403,'EMAIL_RECIPIENT_BLOCKED','Synthetic, reserved or invalid email addresses cannot receive provider mail.');
  if(configuration.testOnly&&!inboxes.has(to.toLowerCase()))throw new ApiError(403,'EMAIL_TEST_INBOX_REQUIRED','The recipient is not in EMAIL_TEST_INBOXES. No email was sent or redirected. Account email addresses are unchanged.');
 };
 async function request(path,options={}){
  let response;
  try{response=await fetcher(`https://api.resend.com/emails${path}`,{...options,redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',...options.headers}});}
  catch{throw deliveryError('EMAIL_TRANSPORT_UNKNOWN');}
  if(!response.ok){
   if(response.status===429)throw deliveryError('EMAIL_RATE_LIMITED',true,true);
   throw deliveryError('EMAIL_PROVIDER_REJECTED',response.status>=400&&response.status<500&&![408,409].includes(response.status));
  }
  try{const body=await response.text();if(body.length>100000)throw new Error();return JSON.parse(body);}catch{throw deliveryError('EMAIL_RESPONSE_UNKNOWN');}
 }
 return {name:'resend',configuration,validateRecipient,
  async sendEmail({to,subject,text,idempotencyKey}){
   validateRecipient(to);
   if(typeof subject!=='string'||/[\r\n]/.test(subject)||subject.length>200||typeof text!=='string'||text.length>8000||typeof idempotencyKey!=='string'||!/^[-A-Za-z0-9_:/]{1,240}$/.test(idempotencyKey))throw new ApiError(400,'EMAIL_INPUT_INVALID','Email content or retry identity is invalid.');
   const result=await request('',{method:'POST',headers:{'Idempotency-Key':`colorloop/${idempotencyKey}`},body:JSON.stringify({from,to:[to],subject,text})});
   if(typeof result.id!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(result.id))throw deliveryError('EMAIL_RESPONSE_UNKNOWN');
   return {id:result.id,status:'accepted'}; // API acceptance is not delivery evidence.
  },
  async getStatus(id){
   if(typeof id!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(id))throw new ApiError(400,'EMAIL_ID_INVALID','Invalid provider receipt identifier.');
   const result=await request(`/${encodeURIComponent(id)}`);
   if(result.id!==id)throw deliveryError('EMAIL_RESPONSE_UNKNOWN');
   const statuses={sent:'sent',delivered:'delivered',bounced:'bounced',complained:'suppressed',failed:'failed',opened:'sent',clicked:'sent',delivery_delayed:'queued',queued:'queued',scheduled:'queued'};
   if(!Object.hasOwn(statuses,result.last_event))throw deliveryError('EMAIL_STATUS_UNKNOWN');
   return {id,status:statuses[result.last_event],event:result.last_event};
  }};
}
