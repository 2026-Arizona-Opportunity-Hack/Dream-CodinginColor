import {displayMoney,timeOrder} from './ui.js';

export const profileUrl=(id,tab='giving')=>`#donors/${encodeURIComponent(id)}?tab=${encodeURIComponent(tab)}`;
export function parseRoute(hash){
 const [path,query='']=hash.replace(/^#/,'').split('?');
 const [screen,encodedId]=path.split('/');let donorId=null;
 try{if(screen==='donors'&&encodedId)donorId=decodeURIComponent(encodedId);}catch{/* Invalid links get a readable error in the profile. */}
 return {screen,donorId,params:new URLSearchParams(query)};
}
export const outreachStatus=draft=>draft.status==='sent'?((draft.providerId==='human-attested'||draft.manualSendReference)?'Human-reported sent':'Delivery recorded'):({draft:'Draft',approved:'Approved',handed_off:'Handed off',failed:'Delivery not confirmed'})[draft.status]||'Status unavailable';
export function givingSummary(gifts){
 const totals=new Map();let unknown=0;
 for(const gift of gifts){if(gift.status!=='completed'||!gift.currency||gift.amount===null||gift.amount===undefined||gift.amount===''||!Number.isFinite(Number(gift.amount))||Number(gift.amount)<=0){unknown++;continue;}totals.set(gift.currency,(totals.get(gift.currency)||0)+Math.round(Number(gift.amount)*100));}
 return {totals:[...totals].map(([currency,cents])=>displayMoney(cents/100,currency)),unverified:unknown,lastGift:[...gifts].sort((a,b)=>timeOrder(b.donated_at)-timeOrder(a.donated_at))[0]||null};
}
export function donorTimeline({gifts=[],activities=[],drafts=[],history=[],tasks=[]},campaignName=id=>id?'Campaign unavailable':'No campaign',actorName=()=>null){
 const events=[
  ...gifts.map(g=>({id:`gift:${g.id}`,date:g.donated_at,category:'giving',label:g.import_batch_id?'Imported gift':'Gift recorded',content:`${displayMoney(g.amount,g.currency)} · ${g.status||'Payment status unknown'} · ${campaignName(g.campaign_id)}`,actor:g.recorded_by_name||null})),
  ...activities.map(a=>({id:`activity:${a.id}`,date:a.created_at,category:'notes',label:({note:'Note',call:'Call',meeting:'Meeting',email:'Email interaction',text:'Text interaction'})[a.type]||'Interaction',content:a.note,actor:a.actorName||a.createdByName||actorName(a.createdBy)||null})),
  ...drafts.map(d=>({id:`draft:${d.id}`,date:d.createdAt,category:'outreach',label:'Draft prepared',content:d.subject||'Message draft',actor:d.createdByName||actorName(d.createdBy)||null})),
  ...history.map(h=>({id:`history:${h.id}`,date:h.at,category:'outreach',label:outreachStatus(h),content:h.subject||'Outreach status recorded',actor:h.actorName||actorName(h.actorId)||null})),
  ...tasks.map(t=>({id:`task:${t.id}`,date:t.updatedAt||t.createdAt,category:'tasks',label:'Follow-up record',content:`${t.title} · ${t.status.replaceAll('_',' ')}`,actor:t.updatedByName||actorName(t.updatedBy||t.createdBy)||null}))
 ];
 return events.sort((a,b)=>timeOrder(b.date)-timeOrder(a.date));
}
export function taskBucket(task,today){
 if(!['open','in_progress'].includes(task.status))return 'closed';
 const day=task.due_date;if(!day)return 'undated';
 if(day<today)return 'overdue';if(day===today)return 'today';
 const soon=new Date(`${today}T12:00:00Z`);soon.setUTCDate(soon.getUTCDate()+7);
 return day<=soon.toISOString().slice(0,10)?'soon':'later';
}
export const localDay=(now=new Date(),zone='America/Phoenix')=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);

export const boardScoped=user=>user.roleId!=='administrator'&&(user.boardMember||user.roleId==='board-member');

let listLocation='#donors';
export const donorListLocation=()=>listLocation;
export function rememberDonorList(location){listLocation=/^#donors(?:\?|$)/.test(location)?location:'#donors';}
