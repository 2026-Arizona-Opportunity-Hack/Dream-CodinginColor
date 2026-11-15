import {localDay} from './donor-view.js';
import {api,rows} from './api.js';
export async function pagedRead(path,read=api){
 const items=[];
 for(let offset=0;offset<=100000;offset+=100){
  const query=new URL(path,'https://local.invalid');query.searchParams.set('limit','100');query.searchParams.set('offset',String(offset));
  const page=await read(query.pathname+query.search);
  if(!Array.isArray(page?.items)||typeof page.has_more!=='boolean')throw new Error('The server returned an unsupported page. Reload after the integration is available.');
  items.push(...page.items);if(!page.has_more)return items;
 }
 throw new Error('Too many records to load. Narrow this request.');
}
export async function loadFollowUps(donorId,zone='America/Phoenix'){
 try{return (await pagedRead('/v1/follow-ups'+(donorId?'?donor_id='+encodeURIComponent(donorId):''))).map(t=>({...t,title:t.next_action,due_date:t.due_at?localDay(new Date(t.due_at),zone):null,dueAt:t.due_at}));}
 catch(error){if(![404,405].includes(error.status))throw error;return rows(await api('/tasks'+(donorId?'?donorId='+encodeURIComponent(donorId):'')));}
}
export async function loadOverview(day,zone){
 try{return await api(`/v1/overview?on=${encodeURIComponent(day)}&time_zone=${encodeURIComponent(zone||'America/Phoenix')}`);}
 catch(error){if([404,405].includes(error.status))return null;throw error;}
}
