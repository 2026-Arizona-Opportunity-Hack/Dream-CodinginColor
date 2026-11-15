import {loadFollowUps,loadOverview,pagedRead} from './mentor-data.js';
import {boardScoped} from './donor-view.js';
import {api,esc,rows,money} from './api.js';
import {profileUrl,taskBucket,localDay,rememberDonorList} from './donor-view.js';
import {displayDate} from './ui.js';

export async function renderToday(root,ctx){
 const {user,panel,workflows,pendingImport}=ctx;
 const can=p=>user.permissions.includes(p),today=localDay(new Date(),user.preferences?.timeZone);
 const requests={tasks:()=>loadFollowUps(null,user.preferences?.timeZone),donors:()=>api('/donors'),drafts:()=>api('/outreach/drafts'),...(can('reports.read')?{radar:()=>api('/retention/at-risk')}:{} )};
 const results=await Promise.all(Object.entries(requests).map(async([key,fetch])=>{try{return [key,{items:rows(await fetch())}];}catch(error){if(error.status===401)throw error;return [key,{items:[],error:error.message}];}}));
 const data=Object.fromEntries(results),donorName=id=>data.donors.items.find(d=>d.id===id)?.name||'Donor unavailable';
 const tasks=data.tasks.items.filter(t=>!boardScoped(user)||t.assignee_id===user.id);
 const queue=[];let overview=null;try{overview=await loadOverview(today,user.preferences?.timeZone);}catch(error){if(error.status===401)throw error;}
 const countNote=overview?`<p>${overview.counts.overdue} overdue · ${overview.counts.due_today} due today · ${overview.counts.pending_drafts} pending drafts${can('assignments.manage')?' · '+overview.counts.unassigned_donors+' donors without an owner':''}</p>`:'';
 for(const [bucket,title] of [['overdue','Overdue follow-ups'],['today','Due today'],['soon','Due in the next seven days']]){
  const matching=tasks.filter(t=>taskBucket(t,today)===bucket);
  if(matching.length)queue.push(panel(`${title} (${matching.length})`,`<ul class="work-queue">${matching.map(t=>`<li><div><strong>${esc(donorName(t.donor_id))}</strong><p>${esc(t.title)}</p><p>Due ${esc(displayDate(t.due_date))} · ${bucket==='overdue'?'Overdue':bucket==='today'?'Today':'Upcoming'}</p></div><div class="row-actions"><a class="button-link" href="#tasks?task=${encodeURIComponent(t.id)}">Open follow-up</a><a href="${profileUrl(t.donor_id)}">View donor</a></div></li>`).join('')}</ul>`));
 }
 const drafts=data.drafts.items.filter(d=>['draft','approved','handed_off'].includes(d.status));
 if(drafts.length)queue.push(panel(`Outreach awaiting action (${drafts.length})`,`<ul class="work-queue">${drafts.map(d=>`<li><div><strong>${esc(d.donorName||d.recipientName||'Board audience')}</strong><p>${esc(d.subject||'Message draft')}</p><span class="badge">${d.status==='draft'?'Awaiting review':d.status==='approved'?'Ready for handoff':'Awaiting human send record'}</span></div><a class="button-link" href="#outreach?view=drafts&draft=${encodeURIComponent(d.id)}">Review draft</a></li>`).join('')}</ul>`));
 const pending=can('imports.manage')?pendingImport():null;
 if(can('imports.manage'))try{const batches=await pagedRead('/imports/history');const previews=batches.filter(b=>b.status==='preview');if(previews.length)queue.push(panel(`Saved import previews (${previews.length})`,`<p>Review saved batches and validation results before uploading a file again.</p><a class="button-link" href="#imports">Open import history</a>`));}catch(error){if(error.status===401)throw error;queue.push(panel('Import review status unavailable','<p>Past import status could not be retrieved. No pending count has been inferred.</p><a href="#imports">Open imports to retry</a>'));}
 if(pending)queue.push(panel('Import needing review',`<p>${esc(pending.filename)} · ${esc(pending.label)}</p><a class="button-link" href="#imports">Resume import</a>`));
 const radar=data.radar?.items||[];
 if(radar.length)queue.push(panel(`Donors needing attention (${radar.length})`,`<ul class="work-queue">${radar.map(d=>`<li><div><strong>${esc(d.name)}</strong><p>Last recorded gift ${esc(displayDate(d.last_gift_date))}</p></div><a class="button-link" href="#outreach?view=attention">Review next step</a><a href="${profileUrl(d.donorId)}">View donor</a></li>`).join('')}</ul>`));
 root.innerHTML=countNote+`<p class="today-date">${esc(displayDate(today))} · ${esc(boardScoped(user)?'Your assigned work':user.name||'Team work')}</p>`+results.filter(([,value])=>value.error).map(([key,value])=>`<p class="error" role="alert">${esc(key)} could not be loaded. ${esc(value.error)} Reload to retry.</p>`).join('')+(queue.join('')||'<section class="panel"><h2>No work is due in the next seven days</h2><p>Review a donor relationship or schedule the next conversation.</p><a class="button-link" href="#donors">Review donors</a></section>');
 root.querySelector('.work-queue .button-link')?.classList.add('primary');
 if(can('reports.read')){
  const footer=document.createElement('section');footer.className='giving-strip';root.append(footer);
  try{const report=await api(`/reports/retention?from=${today.slice(0,4)}-01-01&to=${today}`);footer.innerHTML=`<h2>Giving this year</h2><p><strong>${money(report.giftTotal)}</strong> verified completed USD gifts · ${report.donorTotal} giving donors</p><a href="#reports">Open retention and giving reports</a>`;}catch(error){if(error.status===401)throw error;footer.innerHTML='<p>Giving totals unavailable. No amounts have been inferred.</p><a href="#reports">Retry in Reports</a>';}
 }
}

export async function renderDonorList(root,ctx){
 const {user,action,table,workflows}=ctx,can=p=>user.permissions.includes(p),staff=!boardScoped(user);
 const params=new URLSearchParams(location.hash.split('?')[1]||''),search=params.get('q')||'';
 root.innerHTML='<div class="toolbar donor-toolbar"><label>Search donors<input type="search" id="donor-search" placeholder="Name, email or company"></label><label>Sort donors<select id="donor-sort"><option value="name">Name</option><option value="giving">Verified USD giving</option><option value="owner">Relationship owner</option></select></label></div><div class="toolbar donor-admin-actions"></div><div id="donor-list" aria-live="polite"><p>Loading donors…</p></div>';
 if(can('donors.write')&&staff){const button=action('Add donor',()=>workflows.editDonor(),root.querySelector('.donor-toolbar'));button.className='primary';}
 if(can('assignments.manage')&&user.administrator)action('Assign donors without an active owner',async()=>{if(!window.confirm('Review and balance all donors without an active owner? Existing active ownership is preserved.'))return;const result=await api('/assignments/balance',{method:'POST',body:{}});ctx.notify(`${result.length} ownership records reviewed.`);await ctx.render();},root.querySelector('.donor-admin-actions'));
 if(can('donors.write')&&staff)action('Compare donor records',()=>{location.hash='donors?view=duplicates';},root.querySelector('.donor-admin-actions'));
 const day=localDay(new Date(),user.preferences?.timeZone);
 const [donors,tasks,drafts,retention]=await Promise.all([api('/donors'),loadFollowUps(null,user.preferences?.timeZone),api('/outreach/drafts'),can('reports.read')&&!boardScoped(user)?api(`/reports/retention?from=${day.slice(0,4)}-01-01&to=${day}`).catch(error=>{if(error.status===401)throw error;return null;}):Promise.resolve(null)]);
 const statuses=new Map();for(const [category,label] of [['new','New in recorded history'],['returning','Returning'],['reactivated','Reactivated'],['lapsed','Lapsed (provisional)']])for(const donor of retention?.categoryDonors?.[category]||[])statuses.set(donor.id,label);
 const statusNote=document.createElement('p');statusNote.className='muted';statusNote.textContent=retention?`Giving categories compare ${day.slice(0,4)} year to date with the matched prior-year period, using available imported history.`:'Giving categories are unavailable for this view. Open a profile to review recorded gifts.';root.querySelector('#donor-list').before(statusNote);
 const input=root.querySelector('#donor-search'),sort=root.querySelector('#donor-sort');input.value=search;sort.value=params.get('sort')||'name';
 const draw=()=>{
  if(!root.isConnected)return;
  const query=input.value.trim().toLowerCase(),list=rows(donors).filter(d=>[d.name,d.email,d.company].some(v=>String(v||'').toLowerCase().includes(query))).sort((a,b)=>sort.value==='giving'?Number(b.total_donated)-Number(a.total_donated):sort.value==='owner'?String(a.board_member_name||'').localeCompare(b.board_member_name||''):a.name.localeCompare(b.name));
  const state=new URLSearchParams();if(input.value)state.set('q',input.value);if(sort.value!=='name')state.set('sort',sort.value);const location=`#donors${state.size?'?'+state:''}`;history.replaceState(null,'',location);rememberDonorList(location);
  root.querySelector('#donor-list').innerHTML=table(['Donor','Verified USD gifts','Giving category','Owner','Next step','Actions'],list,d=>{
   const task=rows(tasks).find(t=>t.donor_id===d.id&&['open','in_progress'].includes(t.status)),draft=rows(drafts).find(t=>t.donorId===d.id&&['draft','approved','handed_off'].includes(t.status));
   return `<tr><td><a data-donor="${esc(d.id)}" href="${profileUrl(d.id)}">${esc(d.name)}</a><p>${esc(d.email||'Email not recorded')}</p><a href="${profileUrl(d.id)}">View last gift and history</a></td><td>${d.total_donated===null||d.total_donated===undefined?'Unavailable':money(d.total_donated)}</td><td><span class="badge">${esc(statuses.get(d.id)||(retention?'No category in this period':'Not available'))}</span></td><td>${esc(d.board_member_name||'Not assigned')}</td><td>${task?`<a href="#tasks?task=${encodeURIComponent(task.id)}">${esc(task.title)}</a>`:draft?`<a href="#outreach?view=drafts&draft=${encodeURIComponent(draft.id)}">Review ${esc(draft.subject||'draft')}</a>`:'No next action recorded'}</td><td><div class="row-actions">${[['outreach.write','Draft email','draft'],['tasks.manage','Schedule follow-up','followUp'],['donations.write','Record gift','recordGift'],['donors.write','Edit donor','editDonor']].filter(([p])=>can(p)).map(([,label,kind])=>`<button type="button" data-quick="${kind}" data-id="${esc(d.id)}" aria-label="${label} for ${esc(d.name)}">${label}</button>`).join('')}</div></td></tr>`;
  },query?'No donors match. Try another name, email or company.':'No donors are available to your account. Add a donor or ask a staff member about assignments.');
  root.querySelectorAll('[data-quick]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const donor=rows(donors).find(d=>d.id===button.dataset.id);await workflows[button.dataset.quick](button.dataset.quick==='editDonor'?donor.id:donor);}catch(error){ctx.notify(error.message);}finally{button.disabled=false;}});
 };
 input.oninput=draw;sort.onchange=draw;draw();
}
