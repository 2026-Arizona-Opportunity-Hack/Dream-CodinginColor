import {loadFollowUps} from './mentor-data.js';
import {api,esc,rows} from './api.js';
import {displayMoney,displayDate} from './ui.js';
import {donorListLocation,profileUrl,givingSummary,donorTimeline,outreachStatus} from './donor-view.js';
import {impactPreview,impactPreviewHtml} from './impact-preview.js';

export async function renderDonorProfile(root,id,tab,ctx){
 const {table,panel,action,user,workflows,advanced}=ctx;
 const donor=await api(`/donors/${encodeURIComponent(id)}`);
 const paths={gifts:`/donors/${encodeURIComponent(id)}/donations`,activities:`/activities?donorId=${encodeURIComponent(id)}&history=true`,drafts:`/outreach/drafts?donorId=${encodeURIComponent(id)}`,history:`/outreach/history?donorId=${encodeURIComponent(id)}`,tasks:`/tasks?donorId=${encodeURIComponent(id)}`,assignments:`/assignments?donorId=${encodeURIComponent(id)}`,campaigns:'/campaigns',fields:'/custom-fields'};
 if(!root.isConnected)return;
 const entries=await Promise.all(Object.entries(paths).map(async([key,path])=>{try{return [key,{data:rows(await (key==='tasks'?loadFollowUps(id,user.preferences?.timeZone):api(path)))}];}catch(error){if(error.status===401)throw error;return [key,{error:error.message,data:[]}];}}));
 if(!root.isConnected)return;
 const loaded=Object.fromEntries(entries),data=Object.fromEntries(entries.map(([key,result])=>[key,result.data]));
 const nameCampaign=id=>data.campaigns.find(c=>c.id===id)?.name||(id?'Campaign unavailable':'No campaign');
 const summary=loaded.gifts.error?null:givingSummary(data.gifts),owner=data.assignments.find(a=>a.active)?.boardMember?.name||donor.board_member_name||'Not assigned';
 const tabs={giving:'Giving',timeline:'Timeline',outreach:'Outreach',tasks:'Follow-ups',details:'Details'};if(!tabs[tab])tab='giving';
 document.title=`${donor.name} · ColorLoop`;
 root.innerHTML=`<a href="${esc(donorListLocation())}" class="back-link">Back to donors</a><div class="title-row"><div><h1>${esc(donor.name)}</h1><p>${esc(donor.email||'Email not recorded')}${donor.phone?' · '+esc(donor.phone):''}</p><p>Relationship owner: ${esc(owner)}</p></div></div><div class="consent-strip"><span class="badge">${donor.opted_out?'Opted out. Do not contact':donor.email_consent?'Email consent recorded':'Email consent not recorded'}</span><span class="badge">${donor.sms_consent?'Text consent recorded':'Text consent not recorded'}</span>${donor.archived_at?'<span class="badge">Archived donor</span>':''}</div><div class="toolbar profile-actions"></div><div class="giving-strip">${summary?`<p>Completed gifts: <strong>${esc(summary.totals.join(' · ')||'No completed gifts with known currency')}</strong></p><p>Last recorded gift: ${summary.lastGift?esc(displayDate(summary.lastGift.donated_at,user.preferences?.timeZone)):'No gifts recorded'}</p><p>${summary.unverified} gifts have missing or non-completed payment information.</p>`:'<p>Giving summary unavailable. Reload to retry.</p>'}</div><nav class="section-nav" aria-label="Donor sections">${Object.entries(tabs).map(([key,label])=>`<a href="${profileUrl(id,key)}" ${key===tab?'aria-current="page"':''}>${label}</a>`).join('')}</nav><div id="donor-section"></div>`;
 const toolbar=root.querySelector('.profile-actions');
 for(const [permission,label,callback] of [['outreach.write','Draft email',()=>workflows.draft(donor)],['tasks.manage','Schedule follow-up',()=>workflows.followUp(donor)],['donations.write','Record gift',()=>workflows.recordGift(donor)],['activities.write','Log a call / note',()=>workflows.note(donor)]])if(workflows.can(permission)&&!donor.archived_at)action(label,callback,toolbar);
 const preferred=donor.opted_out?[...toolbar.querySelectorAll('button')].find(b=>b.textContent==='Log a call / note'):toolbar.querySelector('button');preferred?.classList.add('primary');
 const section=root.querySelector('#donor-section');
 const missing=keys=>keys.filter(key=>loaded[key].error).map(key=>`<p class="error" role="alert">${esc(key)} unavailable. ${esc(loaded[key].error)} Reload this page to retry.</p>`).join('');
 const date=value=>`<time datetime="${esc(value||'')}">${esc(displayDate(value,user.preferences?.timeZone))}</time>`;
 if(tab==='giving'){
  section.innerHTML=missing(['gifts','campaigns'])+panel('Complete gift history',loaded.gifts.error?'<p>No totals have been inferred from missing data.</p>':table(['Date','Source','Amount','Campaign / program','Payment status'],data.gifts,g=>`<tr><td>${date(g.donated_at)}</td><td>${esc(g.source)}</td><td>${esc(displayMoney(g.amount,g.currency))}</td><td>${esc(nameCampaign(g.campaign_id))}${g.program?' · '+esc(g.program):''}</td><td><span class="badge">${g.status==='completed'&&g.currency?'Completed · '+esc(g.currency):esc(g.status||'Unknown')}</span></td></tr>`,'No gifts have been recorded for this donor. Use Record gift to add one.'));
 }else if(tab==='timeline'){
  const timeline=donorTimeline(data,nameCampaign,actorId=>actorId===user.id?user.name:data.assignments.find(a=>a.boardMember?.id===actorId)?.boardMember?.name);
  section.innerHTML=missing(['gifts','activities','drafts','history','tasks'])+'<h2>Activity timeline</h2><p class="muted">Recorded activity and current follow-up states. Task edit history and import audit events are not provided by the current API.</p><label>Activity type<select id="timeline-filter"><option value="all">All activity</option><option value="giving">Gifts and imported gifts</option><option value="notes">Notes and interactions</option><option value="outreach">Outreach and approvals</option><option value="tasks">Follow-ups</option></select></label><ol class="timeline"></ol>';
  const draw=()=>{const filter=section.querySelector('select').value,events=timeline.filter(e=>filter==='all'||e.category===filter);section.querySelector('ol').innerHTML=events.length?events.map(e=>`<li><div>${date(e.date)} <span class="badge">${esc(e.label)}</span></div><p>${esc(e.content)}</p><small>${esc(e.actor||'Actor name unavailable')}</small></li>`).join(''):'<li>No recorded activity in this category.</li>';};section.querySelector('select').onchange=draw;draw();
 }else if(tab==='outreach'){
  section.innerHTML=missing(['drafts','history'])+panel('Drafts and approvals',table(['Purpose / subject','Linked gift','Status','Next action'],data.drafts,d=>`<tr><td>${esc(d.subject||d.templateId||'Message draft')}</td><td>${d.gift?esc(displayMoney(d.gift.amountCents/100,d.gift.currency)):'No linked gift'}</td><td><span class="badge">${esc(outreachStatus(d))}</span></td><td><a href="#outreach?view=drafts&draft=${encodeURIComponent(d.id)}">Review message</a></td></tr>`,'No outreach drafts for this donor. Use Draft email to prepare one.'))+panel('Communication history',table(['Date','Status','Reference'],data.history,h=>`<tr><td>${date(h.at)}</td><td>${esc(outreachStatus(h))}</td><td>${esc(h.reference||h.manualReference||'Not provided')}</td></tr>`,'No communication status events recorded. A draft is not a sent message.'));
 }else if(tab==='tasks'){
  section.innerHTML=missing(['tasks'])+panel('Upcoming and past follow-ups',table(['Next action','Due','Status',''],data.tasks,t=>`<tr><td>${esc(t.title)}</td><td>${date(t.due_date)}</td><td><span class="badge">${esc(t.status.replaceAll('_',' '))}</span></td><td><a href="#tasks?task=${encodeURIComponent(t.id)}">Open follow-up</a></td></tr>`,'No follow-ups recorded. Use Schedule follow-up to set the next action.'));
 }else{
  section.innerHTML=missing(['fields'])+panel('Donor details',`<dl class="profile-details">${[['Name',donor.name],['Type',donor.donor_type],['Email',donor.email],['Secondary email',donor.secondary_email],['Phone',donor.phone],['Company / employer',donor.company],['Organization',donor.organization_name],['Human contact person',donor.contact_person],['Relationship owner',owner],...data.fields.filter(f=>!f.hidden&&f.active!==false).map(f=>[f.label,donor.custom_fields?.[f.id]])].map(([label,value])=>`<dt>${esc(label)}</dt><dd>${esc(value===false?'No':value===true?'Yes':value??'Not recorded')}</dd>`).join('')}</dl><div id="edit-donor-actions"></div>`);
  if(workflows.can('donors.write'))action('Edit donor details',()=>workflows.editDonor(id),section.querySelector('#edit-donor-actions'));
 }
 const extra=document.createElement('div');extra.className='toolbar';section.append(extra);advanced?.(donor,data.gifts,extra,tab);
 if(tab==='giving'&&user.permissions.includes('reports.read')){
  const preview=document.createElement('div');section.append(preview);
  action('Preview donor impact (internal)',async()=>{
   try{
    const packet=await api(`/reports/funder?donorId=${encodeURIComponent(id)}&fullHistory=true`);
    if(!preview.isConnected)return;
    preview.innerHTML=impactPreviewHtml(impactPreview(packet));
    preview.querySelector('h2').tabIndex=-1;preview.querySelector('h2').focus();
   }catch(error){if(preview.isConnected){preview.replaceChildren();const message=document.createElement('p');message.setAttribute('role','alert');message.textContent=error.message;preview.append(message);}}
  },extra);
 }
}
