import {boardScoped} from './donor-view.js';
import {renderFollowUps} from './followups-ui.js';
import {renderOutreach} from './outreach-ui.js';
import {renderDonorProfile} from './donor-profile.js';
import {donorWorkflows} from './donor-workflows.js';
import {renderToday,renderDonorList} from './mentor-screens.js';
import {renderDuplicateReview} from './duplicate-review.js';
import {rememberDonorList,parseRoute,profileUrl,localDay,taskBucket,outreachStatus} from './donor-view.js';
import {mountDonorSelector,displayDate,displayMoney,timeOrder} from './ui.js';
import {initializeAuthUI} from './auth-ui.js';
import {renderImports,pendingImportReview,resetImportReview} from './imports.js';
import {accountRoleOptions,administratorGrant} from './account-forms.js';
import { api, esc, money, rows } from './api.js';
const main = document.querySelector('main'), modal = document.querySelector('#modal');
const screens = {dashboard:'Today',donors:'Donors',outreach:'Outreach',tasks:'Follow-ups',reports:'Reports',imports:'Imports',settings:'Settings'};
let user = null, generation = 0, dialogOpener = null;
modal.addEventListener('close', () => {
  if (modal.open) return;
  if(!user){document.querySelector('#sign-in input')?.focus();return;}
  (dialogOpener?.isConnected ? dialogOpener : main).focus();
});
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  main.focus();
  main.scrollIntoView({ block: 'start' });
});
let noticeTimer;
const clearNotice=()=>{clearTimeout(noticeTimer);document.querySelector('#notice').replaceChildren();};
const notify=text=>{clearNotice();if(!user)return;const notice=document.querySelector('#notice'),message=document.createElement('span'),dismiss=document.createElement('button');message.textContent=text;dismiss.type='button';dismiss.textContent='Dismiss';dismiss.onclick=clearNotice;notice.append(message,dismiss);const expire=()=>{if(notice.contains(document.activeElement)){noticeTimer=setTimeout(expire,1000);return;}clearNotice();};noticeTimer=setTimeout(expire,8000);};
const readableTime=value=>`<time datetime="${esc(value)}">${esc(displayDate(value,user?.preferences?.timeZone))}</time>`;
const field = (name, label, type='text', value='') => `<label>${esc(label)}<input name="${name}" type="${type}" ${type==='number'?`min="${name==='amount'?'0.01':'1'}" step="${name==='amount'?'0.01':'1'}"`:''} value="${esc(value)}" ${type==='checkbox'?'':'required'}></label>`;
const optional = (...args) => field(...args).replace(' required','');
const donorFields = (d={}) => select('donor_type','Donor type',[['person','Person'],['organization','Organization']])+field('name','Display name','text',d.name||'')+optional('first_name','First name','text',d.first_name||'')+optional('last_name','Last name','text',d.last_name||'')+optional('email','Email','email',d.email||'')+optional('secondary_email','Secondary email','email',d.secondary_email||'')+optional('phone','Phone number','tel',d.phone||'')+optional('company','Company / employer','text',d.company||'')+optional('organization_name','Organization name','text',d.organization_name||'')+optional('contact_person','Human contact person','text',d.contact_person||'');
const select = (name,label,options) => `<label>${esc(label)}<select name="${name}">${options.map(([value,text])=>`<option value="${esc(value)}">${esc(text)}</option>`).join('')}</select></label>`;
function form(title, fields, save, submit='Save', refresh=true) {
  if(!user)return;
  if (!modal.open) dialogOpener = document.activeElement;
  document.querySelector('#modal-title').textContent = title;
  document.querySelector('#modal-fields').innerHTML = fields;
  document.querySelector('#modal-error').textContent = '';
  const element = document.querySelector('#modal-form');
  element.querySelector('[type=submit]').textContent = submit;
  element.onsubmit = async event => { event.preventDefault(); const actionRoute=location.hash; const button=element.querySelector('[type=submit]'); if(button.disabled)return; button.disabled=true; try { const result=await save(Object.fromEntries(new FormData(element)),element); if(result===false)return; modal.close(); if(refresh)await render(); if(user&&location.hash===actionRoute)notify(refresh?`${title} saved.`:'Report prepared.'); } catch(error) { document.querySelector('#modal-error').textContent=error.message; } finally { button.disabled=false; } };
  if (!modal.open) modal.showModal();
  modal.querySelector('input, select, textarea')?.focus();
}
document.querySelector('#close-modal').onclick = () => modal.close();
function table(headings,data,row,empty='No records found for this view.') {
 if(!data.length)return `<p class="empty">${esc(empty)}</p>`;
 const body=data.map(item=>{let column=0;return row(item).replace(/<tr>/g,'<tr role="row">').replace(/<td>/g,()=>`<td role="cell" data-label="${esc(headings[column++]||'Actions')}">`);}).join('');
 return `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(headings.filter(Boolean).join(', '))} table"><table role="table"><thead role="rowgroup"><tr role="row">${headings.map(h=>`<th scope="col" role="columnheader">${esc(h||'Actions')}</th>`).join('')}</tr></thead><tbody role="rowgroup">${body}</tbody></table></div>`;
}
function action(label, fn, parent=main) { const button=document.createElement('button'); button.type='button'; button.textContent=label; button.onclick=async()=>{button.disabled=true;try{await fn();}catch(error){notify(error.message);}finally{button.disabled=false;}}; parent.append(button);return button; }
function panel(title,content) { return `<section class="panel"><h2>${esc(title)}</h2>${content}</section>`; }
function cards(entries) { return `<div class="cards">${entries.map(([label,value])=>`<div class="card"><p>${esc(label)}</p><strong>${esc(value)}</strong></div>`).join('')}</div>`; }
const screenPermission={dashboard:'donors.read',donors:'donors.read',outreach:'donors.read',tasks:'donors.read',reports:'reports.read',imports:'imports.manage',settings:'settings.manage'};
function renderNavigation(current){
 const board=boardScoped(user),allowed=Object.entries(screens).filter(([id])=>user.permissions.includes(screenPermission[id])&&(!board||['donors','tasks','outreach'].includes(id)));if(board)allowed.sort(([a],[b])=>['donors','tasks','outreach'].indexOf(a)-['donors','tasks','outreach'].indexOf(b));
 const label=(id,title)=>board?({donors:'My donors',tasks:'My follow-ups',outreach:'My drafts'})[id]:title;
 const link=([id,title])=>`<a href="#${id}" ${current===id?'aria-current="page"':''}>${label(id,title)}</a>`;
 document.querySelector('aside nav').innerHTML=allowed.map(link).join('');
 let mobile=document.querySelector('#mobile-navigation');if(!mobile){mobile=document.createElement('div');mobile.id='mobile-navigation';document.querySelector('.workspace').append(mobile);}
 const primary=allowed.filter(([id])=>(board?['donors','tasks','outreach']:['dashboard','donors','outreach']).includes(id)),more=allowed.filter(([id])=>!primary.some(([key])=>key===id));
 mobile.innerHTML=`<nav aria-label="Mobile navigation">${primary.map(link).join('')}${more.length?'<button type="button" id="more-navigation" aria-expanded="false" aria-controls="mobile-more">More</button>':''}</nav>${more.length?`<nav id="mobile-more" aria-label="More pages" hidden>${more.map(link).join('')}</nav>`:''}`;
 const trigger=mobile.querySelector('button');if(trigger){trigger.onclick=()=>{const menu=mobile.querySelector('#mobile-more');menu.hidden=!menu.hidden;trigger.setAttribute('aria-expanded',String(!menu.hidden));};mobile.onkeydown=event=>{if(event.key==='Escape'){mobile.querySelector('#mobile-more').hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus();}};}
 document.querySelector('#session').dataset.initials=(user.name||'Account').split(/\s+/).filter(Boolean).map(p=>p[0]).slice(0,2).join('').toUpperCase();
}

async function filters() { const year=new Date().getUTCFullYear(),members=user?.permissions?.includes('donors.read')?rows(await api('/board-members')).filter(m=>m.active!==false):[];return `<form id="filters" class="toolbar">${field('from','From','date',`${year}-01-01`)}${field('to','Through','date',new Date().toISOString().slice(0,10))}<label>Program<input name="program" placeholder="All programs"></label>${select('boardMember','Board member',boardScoped(user)?[[user.id,user.name||'Me']]:[['','All members'],...members.map(m=>[m.id,m.name])])}<button class="primary">Apply filters</button></form><div id="results" aria-live="polite"></div>`; }
const memberLabel=(id,root)=>id?[...root.querySelectorAll('select[name=boardMember] option')].find(o=>o.value===id)?.textContent||'Previous board member':'Unassigned board member';
const workflowContext=()=>({user,form,field,optional,select,donorFields,notify});
const workflows=()=>donorWorkflows(workflowContext());
const screenContext=()=>({user,form,field,optional,select,donorFields,notify,render,table,panel,action,workflows:workflows(),pendingImport:pendingImportReview});
async function dashboard(root){return renderToday(root,screenContext());}
async function donors(root){return parseRoute(location.hash).params.get('view')==='duplicates'?renderDuplicateReview(root,screenContext()):renderDonorList(root,screenContext());}
function showDonor(id){location.hash=profileUrl(id);return Promise.resolve();}
function profileAdministration(donor,gifts,parent,tab){
 const id=donor.id,path=`/donors/${encodeURIComponent(id)}`;
  if(tab==='details'&&!boardScoped(user)&&user?.permissions?.includes('assignments.manage'))action('Assign board member',async()=>{const members=rows(await api('/board-members')).filter(m=>m.active);modal.close();form('Assign donor',select('assigneeId','Board member',members.map(m=>[m.id,m.name])),body=>api('/assignments',{method:'POST',body:{donorId:id,...body}}));},parent);
  if(tab==='giving')if(user?.permissions?.includes('reports.read'))action('Export funder packet',()=>exportFunder(id),parent);
  if(tab==='giving')if(!boardScoped(user)&&user?.permissions?.includes('settings.manage'))action('Record verified outcome',()=>{modal.close();form('Record verified funded outcome',field('description','Verified outcome')+field('evidence_reference','Evidence reference')+field('verified_at','Verified on','date')+field('period_start','Period start','date')+field('period_end','Period end','date')+optional('program','Program'),body=>api('/outcomes',{method:'POST',body:{...body,donor_id:id}}));},parent);
  if(tab==='giving')if(user?.permissions?.includes('donations.write')&&gifts.some(g=>!g.currency||!g.status||g.status==='pending'))action('Review gift payment information',()=>{modal.close();const reviewable=gifts.filter(g=>!g.currency||!g.status||g.status==='pending');form('Verify gift payment information',select('id','Gift',reviewable.map(g=>[g.id,`${g.donated_at} · ${g.amount} · ${g.currency||'Unknown currency'} · ${g.status||'Unknown status'}`]))+field('currency','Verified currency code')+select('status','Verified status',[['','Choose status'],['completed','Completed'],['pending','Pending'],['refunded','Refunded'],['voided','Voided']])+field('reason','Source evidence / reason'),({id,...body})=>api(`/donations/${encodeURIComponent(id)}`,{method:'PATCH',body}));},parent);
  if(tab==='details'&&user?.permissions?.includes('donors.write'))action('Archive donor',()=>{modal.close();form('Archive donor',`<p>Archive ${esc(donor.name)}? Their history is preserved.</p>`,()=>api(path,{method:'PATCH',body:{archived:true}}),'Archive donor');},parent);
}
async function imports(root) { return renderImports(root,{api,esc,canCreateCampaign:user?.permissions?.includes('settings.manage')}); }
async function tasks(root){return renderFollowUps(root,screenContext());}
async function outreach(root){return renderOutreach(root,screenContext());}
async function exportFunder(id){location.hash=`reports?funder=${encodeURIComponent(id)}`;}
async function funderPacket(root,id){
 const params=parseRoute(location.hash).params;
 root.innerHTML=`<a href="${profileUrl(id)}">Back to donor</a><h2>Funder packet</h2><form id="packet-period"><label>Giving history<select name="scope"><option value="full">Full verified history</option><option value="period">Selected period</option></select></label><div class="toolbar" id="packet-dates" hidden>${field('from','From','date',`${new Date().getUTCFullYear()}-01-01`)}${field('to','Through','date',localDay())}</div><button>Preview packet</button></form><div id="packet-preview" aria-live="polite"></div>`;
 const element=root.querySelector('form'),target=root.querySelector('#packet-preview');
 element.elements.scope.onchange=()=>{root.querySelector('#packet-dates').hidden=element.elements.scope.value!=='period';};
 element.elements.scope.value=params.get('scope')==='period'?'period':'full';for(const key of ['from','to'])if(params.has(key))element.elements.namedItem(key).value=params.get(key);element.elements.scope.onchange();
 const load=async()=>{
  const query=new URLSearchParams({donorId:id});if(element.elements.scope.value==='full')query.set('fullHistory','true');else{query.set('from',element.elements.from.value);query.set('to',element.elements.to.value);}
  const report=await api(`/reports/funder?${query}`);
  if(!root.isConnected)return;const state=new URLSearchParams({funder:id,scope:element.elements.scope.value});if(element.elements.scope.value==='period'){state.set('from',element.elements.from.value);state.set('to',element.elements.to.value);}history.replaceState(null,'',`#reports?${state}`);
  target.innerHTML=panel('Funder gift history',`<h2>${esc(report.name)}</h2><p>${esc(displayDate(report.from))} through ${esc(displayDate(report.to))}</p><p>Verified completed USD gifts only. Other currencies and unknown payment information are not included.</p>`+table(['Date','Program','Gift'],report.gifts,g=>`<tr><td>${readableTime(g.donated_at)}</td><td>${esc(g.program||'Not recorded')}</td><td>${money(g.amount)}</td></tr>`,'No verified completed USD gifts in this period. Review the donor profile for unknown or excluded payment information.'))+panel('Verified funded outcomes',`<p>Staff-recorded outcome evidence. Donations alone do not establish nonprofit impact.</p>`+(report.outcomes.length?report.outcomes.map(o=>`<section><h3>${esc(o.description||'Description not provided')}</h3><p>Verification recorded: ${esc(displayDate(o.verified_at))}</p><p>Evidence: ${esc(o.evidence_reference||'Evidence missing')}</p></section>`).join(''):'<p>No verified outcome evidence recorded for this selection. Unverified or missing outcomes are not inferred.</p>'));
  action('Print funder report / Save as PDF',()=>window.print(),target);
 };
 element.onsubmit=event=>{event.preventDefault();load().catch(error=>notify(error.message));};await load();
}
async function reports(root) {
 const funder=parseRoute(location.hash).params.get('funder');if(funder)return funderPacket(root,funder);
 root.innerHTML+=`<details class="report-filters" ${matchMedia('(min-width:651px)').matches?'open':''}><summary>Filter report</summary>${await filters()}</details><div id="report-results"></div>`;
 const target=root.querySelector('#report-results');root.querySelector('#results').remove();
 const load=async()=>{
  const query=new URLSearchParams(new FormData(root.querySelector('#filters'))),r=await api(`/reports/retention?${query}`);
  const metric=(label,value,note)=>`<div class="card"><p>${label}</p><strong>${value}</strong><p>${note}</p></div>`;
  target.innerHTML=`<div class="cards">${metric('Verified USD giving',money(r.giftTotal),`${r.giftCount} completed gifts`)}${metric('Giving donors',r.donorTotal,'In the selected period')}${metric('Donor retention',r.retentionRate===null?'N/A':`${(100*r.retentionRate).toFixed(1)}%`,r.retentionRate===null?'No donors gave in the comparison period, so a rate is not available.':`${r.returning} of ${r.priorDonorTotal} comparison donors gave again.`)}${metric('Churn',r.churnRate===null?'N/A':`${(100*r.churnRate).toFixed(1)}%`,r.churnRate===null?'No donors in the comparison period, so a rate is not available.':'Prior-period donors without a gift in this period. Provisional for incomplete years.')}</div>`+panel('Year-over-year giving',`<p>${esc(displayDate(r.from))} through ${esc(displayDate(r.to))}, compared with ${esc(displayDate(r.previousFrom))} through ${esc(displayDate(r.previousTo))}.</p><p>${r.priorDonorTotal?`${r.returning} of ${r.priorDonorTotal} comparison donors gave again; ${r.lapsed} have no recorded gift in this period.`:'No donors gave in the comparison period, so retention and churn cannot be computed.'} ${r.new} new donors and ${r.reactivated} reactivated donors are identified in the available imported history.</p><p class="report-note">Missing history is not inferred. Current-year lapses remain provisional. Unassigned means no program or relationship owner is recorded.</p>`+table(['New','Returning','Reactivated','Increased','Decreased','Unchanged','Lapsed'],[r],x=>`<tr>${[x.new,x.returning,x.reactivated,x.increased,x.decreased,x.unchanged,x.lapsed].map(value=>`<td>${value}</td>`).join('')}</tr>`))+panel('Giving by program',table(['Program','Total'],r.byProgram,x=>`<tr><td>${esc(x.name||'Unassigned program')}</td><td>${money(x.total)}</td></tr>`,'No verified gifts to group by program.'))+panel('Giving by board member',table(['Board member','Total'],r.byBoardMember,x=>`<tr><td>${esc(memberLabel(x.name,root))}</td><td>${money(x.total)}</td></tr>`,'No verified gifts to group by board member.'));
  if(r.categoryDonors)target.insertAdjacentHTML('beforeend',panel('Donors behind the retention categories',Object.entries(r.categoryDonors).map(([category,donors])=>`<details><summary>${esc(category)} (${donors.length})</summary>${donors.map(d=>`<p><a href="${profileUrl(d.id)}">${esc(d.name)}</a></p>`).join('')||'<p>No donors in this category.</p>'}</details>`).join('')));
  action('Print report / Save as PDF',()=>window.print(),target);
  const packet=document.createElement('section');packet.className='panel';packet.innerHTML='<h2>Funder packet</h2><p>Select a donor to preview verified gifts and staff-recorded outcome evidence, then print or save as PDF.</p>';target.append(packet);
  action('Funder gift history and outcomes',async()=>{const donors=rows(await api('/donors'));form('Funder export','',values=>exportFunder(values.donor_id),'Preview funder packet',false);mountDonorSelector(document.querySelector('#modal-fields'),donors);},packet);
  if(!r.giftCount){const message=document.createElement('p');message.textContent='No verified completed USD gifts in this period. Check the date range or review unknown payment information in donor profiles.';target.prepend(message);const link=document.createElement('a');link.href='#donors';link.textContent='Review donor giving';target.prepend(link);}
 };
 root.querySelector('#filters').onsubmit=e=>{e.preventDefault();load().catch(error=>notify(error.message));};await load();
}
async function settings(root) {
  const [fields,campaigns,members,roles,config]=await Promise.all([api('/custom-fields'),api('/campaigns'),api('/board-members'),user.administrator&&user.permissions.includes('roles.manage')?api('/roles'):Promise.resolve([]),user.permissions.includes('reports.read')?api('/retention/settings'):Promise.resolve({})]);
  root.innerHTML+=panel('Custom donor fields',table(['Label','Type','Visibility',''],rows(fields),f=>`<tr><td>${esc(f.label)}</td><td>${esc(f.type)}</td><td>${f.hidden?'Hidden':f.active===false?'Inactive':'Visible'}</td><td><button aria-label="Edit field: ${esc(f.label)}" data-field="${esc(f.id)}">Edit</button></td></tr>`,'No custom donor fields yet. Use Create custom field to add one.'))+panel('Campaigns',table(['Campaign','Status'],rows(campaigns),c=>`<tr><td>${esc(c.name)}</td><td>${c.archived?'Archived':'Active'}</td></tr>`,'No campaigns yet. Use Manage campaign or approve one during import.'))+panel('Board members and server permissions',table(['Member','Role','Permissions'],rows(members),m=>`<tr><td>${esc(m.name)}</td><td>${esc(m.role)}</td><td>${esc((rows(roles).find(r=>r.name===m.role)?.permissions||[]).join(', '))}</td></tr>`,'No board members have been added. Use Manage board member to add an eligible account.'));
  const settingsGroups={};const current=parseRoute(location.hash).params.get('section')||'team';const nav=document.createElement('nav');nav.className='section-nav';nav.setAttribute('aria-label','Settings sections');nav.innerHTML=[['team','Team and roles'],['fields','Fields and campaigns'],['outreach','Outreach settings']].map(([key,label])=>`<a href="#settings?section=${key}" ${key===current?'aria-current="page"':''}>${label}</a>`).join('');root.prepend(nav);for(const key of ['team','fields','outreach']){const group=document.createElement('section');group.dataset.settingsGroup=key;group.hidden=key!==current;settingsGroups[key]=group;root.append(group);}const panels=[...root.querySelectorAll(':scope>.panel')];if(panels[0])settingsGroups.fields.append(panels[0]);if(panels[1])settingsGroups.fields.append(panels[1]);if(panels[2])settingsGroups.team.append(panels[2]);
  const settingsAction=(label,work)=>{const group=/field|campaign/i.test(label)?'fields':/template|lapse/i.test(label)?'outreach':'team';const permission=/user account|board member/i.test(label)?'users.manage':/role/i.test(label)?'roles.manage':'settings.manage';if(user.permissions.includes(permission)&&(!/user account|board member|role|template|lapse/i.test(label)||user.administrator))return action(label,work,settingsGroups[group]);};
  const fieldForm=f=>form(f?'Edit donor field':'Create donor field',field('label','Field label','text',f?.label||'')+select('type','Type',['text','number','date','checkbox','dropdown'].map(t=>[t,t]))+'<label>Dropdown choices (one per line)<textarea name="options">'+esc((f?.options||[]).join('\n'))+'</textarea></label>'+select('state','Visibility',[['visible','Visible'],['hidden','Hidden'],['inactive','Inactive']]),body=>{const {state,options,...rest}=body;return api(`/custom-fields${f?'/'+encodeURIComponent(f.id):''}`,{method:f?'PATCH':'POST',body:{...rest,options:options.split('\n').filter(Boolean),hidden:state==='hidden',active:state!=='inactive'}});});
  settingsAction('Create custom field',()=>fieldForm());root.querySelectorAll('[data-field]').forEach(b=>b.onclick=()=>{const f=rows(fields).find(f=>String(f.id)===b.dataset.field);fieldForm(f);const form=document.querySelector('#modal-form');form.elements.type.value=f.type;form.elements.type.disabled=true;form.elements.state.value=f.active===false?'inactive':f.hidden?'hidden':'visible';});
  settingsAction('Manage campaign',()=>form('Campaign',select('id','Existing campaign (or create)',[['','Create new'],...rows(campaigns).map(c=>[c.id,c.name])])+field('name','Campaign name')+select('archived','Status',[['false','Active'],['true','Archived']]),({id,archived,...body})=>api(`/campaigns${id?'/'+encodeURIComponent(id):''}`,{method:id?'PATCH':'POST',body:{...body,archived:archived==='true'}})));
  settingsAction('Manage board member',()=>form('Board member',select('id','Existing member (or create)',[['','Create new'],...rows(members).filter(m=>m.active!==false).map(m=>[m.id,m.name])])+field('name','Name')+field('email','Email','email')+field('password','New password (10–128 characters; upper/lowercase, number, special)','password')+select('active','Account status',[['true','Active'],['false','Inactive']])+select('role','Role',accountRoleOptions(rows(roles).filter(r=>r.active!==false),true)),({id,active,...body})=>api(`/board-members${id?'/'+encodeURIComponent(id):''}`,{method:id?'PATCH':'POST',body:{...administratorGrant(body,'role',message=>window.confirm(message)),active:active==='true'}})));
  settingsAction('Create role',()=>form('New role',field('name','Role name')+'<label>Permission identifiers, one per line<textarea name="permissions"></textarea></label>',({name,permissions})=>api('/roles',{method:'POST',body:{name,permissions:permissions.split('\n').map(v=>v.trim()).filter(Boolean)}})));
  settingsAction('Edit role permissions',()=>form('Role permissions',select('role','Role',rows(roles).map(r=>[r.name,r.name]))+'<label>Permission identifiers (one per line)<textarea name="permissions" required></textarea></label><p>Changes require server authorization and apply to every member with this role.</p>',({role,permissions})=>api(`/roles/${encodeURIComponent(role)}`,{method:'PATCH',body:{permissions:permissions.split('\n').map(p=>p.trim()).filter(Boolean)}})));
  settingsAction('Retire and reassign role',()=>form('Retire role',select('id','Role to retire',roles.filter(r=>r.active!==false&&r.name!=='administrator'&&r.name!==user.roleId).map(r=>[r.name,r.label||r.name]))+select('replacementRoleId','Move accounts to',roles.filter(r=>r.active!==false).map(r=>[r.name,r.label||r.name])),body=>api('/roles/retire',{method:'POST',body:administratorGrant(body,'replacementRoleId',message=>window.confirm(message))})));
  settingsAction('Edit lapse threshold',()=>form('Lapsed-donor Radar',field('inactivityMonths','Inactivity threshold in months','number',config.inactivityMonths),body=>api('/retention/settings',{method:'PATCH',body:{inactivityMonths:Number(body.inactivityMonths)}})));
  if(user.administrator&&user.permissions.includes('settings.manage')){
   action('Email automation policy',async()=>{
    const status=await api('/email/settings'),policy=status.policy,config=status.configuration;
    form('Email automation policy',`${status.storageReady?'':'<p class="error">Reviewed database migration 010 is required before saving this policy.</p>'}<p>Delivery mode: ${esc(config.mode)}. Provider credentials/sender ${config.configured?'configured':'not configured'}. Verified test inbox allowlist ${config.testInboxesConfigured?'configured':'not configured'}. Live CIC approval ${config.cicApproved?'recorded':'not recorded'}.</p><p>Scheduled provider sending: ${config.cronEnabled?'enabled by server configuration':'off; server opt-in is required'}. Saving this policy does not enable the scheduler.</p><p>Donor emails still require individual approval of the exact message revision and valid consent. Manual handoff remains available.</p><p>Enabling board reminders approves this fixed internal template: donor name, assigned next action, Phoenix due date, approaching/due/overdue status, and the ColorLoop task link. Editing a prepared reminder requires a new individual approval.</p>`+select('donorEnabled','Automatic approved donor emails',[['false','Disabled'],['true','Enabled (requires delivery configuration)']])+select('boardEnabled','Automatic internal board reminders',[['false','Disabled'],['true','Enable the reviewed internal template']])+'<label>Approval decision and CIC reference<textarea name="reason" minlength="10" maxlength="1000" required></textarea></label><label><span><input type="checkbox" name="confirmed" required> I reviewed and approve this sending policy. Live donor activation also requires CIC approval.</span></label>',values=>api('/email/settings',{method:'POST',body:{donorEnabled:values.donorEnabled==='true',boardEnabled:values.boardEnabled==='true',reason:values.reason,confirmed:values.confirmed==='on'}}),'Save reviewed policy');
    const element=document.querySelector('#modal-form');for(const key of ['donorEnabled','boardEnabled'])element.elements.namedItem(key).value=String(policy[key]);
   },settingsGroups.outreach);
   const emailResult=document.createElement('p');emailResult.setAttribute('role','status');
   action('Send ONE TEST board reminder',()=>{
    const idempotencyKey=crypto.randomUUID();
    form('ONE TEST board reminder','<p>Admin-only delivery test. No donor or follow-up record is created. Normal reminders still use the assigned board account email. Requires test mode and an explicitly allowlisted inbox.</p>'+field('recipient','Verified test inbox (explicit recipient)','email')+'<label><span><input type="checkbox" name="confirmed" required> I approve ONE real TEST email to this inbox. Do not enable automation.</span></label><p role="status" id="test-reminder-result"></p>',async values=>{
     const result=await api('/email/test-reminder',{method:'POST',body:{recipient:values.recipient,confirmed:values.confirmed==='on',idempotencyKey}});
     document.querySelector('#test-reminder-result').textContent=result.status==='queued'?`TEST accepted by provider for ${result.recipient}. Delivery is pending. Repeating this request will not send again.`:`TEST ${result.status}. Review the test history before trying another request. No automatic retry will occur.`;return false;
    },'Send ONE TEST email',false);
   },settingsGroups.outreach);
   action('View TEST reminder history',async()=>{const tests=await api('/email/test-reminder');emailResult.textContent=tests.length?tests.map(t=>`TEST · ${t.recipient} · ${t.status}${t.providerId?` · receipt ${t.providerId}`:''}`).join(' | '):'No TEST reminders have been attempted.';},settingsGroups.outreach);
   action('Process approved email queue',async()=>{if(!window.confirm('Process eligible approved email with the configured provider? This can send real email to permitted recipients when delivery is enabled.'))return;emailResult.setAttribute('role','status');emailResult.textContent='Processing eligible approved email…';try{const result=await api('/email/run',{method:'POST',body:{confirmed:true}});emailResult.textContent=result.enabled?`${result.queued} emails accepted by provider; ${result.failed} failed attempts; ${result.blocked} blocked. Acceptance is not delivery. Review Outreach history for provider evidence.`:'Email delivery is disabled. No emails were sent.';}catch(error){emailResult.setAttribute('role','alert');emailResult.textContent=error.message;}},settingsGroups.outreach);settingsGroups.outreach.append(emailResult);
  }
  settingsAction('Edit message template',async()=>{const templates=rows(await api('/outreach/templates'));form('Message template',select('id','Template',templates.map(t=>[t.id,t.name]))+field('name','Template name')+select('channel','Channel',[['email','Email'],['sms','Text message']])+select('requiresDonation','Verified donation required',[['true','Yes'],['false','No']])+field('subject','Subject')+'<label>Message<textarea name="body" required></textarea></label>',({requiresDonation,...body})=>api('/outreach/templates',{method:'POST',body:{...body,requiresDonation:requiresDonation==='true'}}));const element=document.querySelector('#modal-form');const fill=()=>{const t=templates.find(t=>t.id===element.elements.namedItem('id').value);for(const key of ['name','channel','subject','body','requiresDonation'])element.elements.namedItem(key).value=String(t[key]);element.elements.namedItem('subject').required=t.channel==='email';};element.elements.namedItem('id').onchange=fill;fill();});
  settingsAction('Manage user account',async()=>{const users=rows(await api('/users'));form('User account',select('id','Existing user or create',[['','Create new'],...users.map(u=>[u.id,u.name])])+field('name','Name')+field('email','Email','email')+field('password','New password (10–128 characters; upper/lowercase, number, special)','password')+select('roleId','Role',accountRoleOptions(rows(roles).filter(r=>r.active!==false)))+select('active','Status',[['true','Active'],['false','Inactive']])+select('boardMember','Board member',[['false','No'],['true','Yes']]),({id,active,boardMember,...body})=>api('/users',{method:id?'PATCH':'POST',body:{...administratorGrant(body,'roleId',message=>window.confirm(message)),...(id?{id}:{}),active:active==='true',boardMember:boardMember==='true'}}));const formElement=document.querySelector('#modal-form');const fillAccount=()=>{const account=users.find(u=>u.id===formElement.elements.namedItem('id').value);formElement.elements.namedItem('password').required=!account;for(const key of ['name','email','roleId','active','boardMember'])formElement.elements.namedItem(key).value=account?String(account[key]):({active:'true',boardMember:'false'}[key]||'');formElement.elements.namedItem('password').value='';};formElement.elements.namedItem('id').onchange=fillAccount;fillAccount();});
}
const handlers={dashboard,donors,imports,tasks,outreach,reports,settings};
async function render() {
 if(!user)return;clearNotice();
 const token=++generation,route=parseRoute(location.hash);let id=route.screen in screens?route.screen:'dashboard';
 if(boardScoped(user)&&id==='dashboard')id='tasks';
 renderNavigation(id);document.title=`${screens[id]} · ColorLoop`;
 const allowed=user.permissions.includes(screenPermission[id])&&(!boardScoped(user)||['donors','tasks','outreach','reports'].includes(id));
 main.innerHTML='';
 if(!allowed){main.innerHTML='<h1>Page unavailable</h1><p>Your account does not have access to this page. Choose an available page from navigation.</p>';return;}
 const root=document.createElement('div');
 if(!(id==='donors'&&route.donorId))main.innerHTML=`<div class="title-row"><h1>${screens[id]}</h1>${boardScoped(user)?'<span class="badge">Your assigned donors and work</span>':''}</div>`;
 main.append(root);root.innerHTML='<p class="loading" role="status">Loading…</p>';
 try{
  if(id==='donors'&&route.donorId){const staging=document.createElement('div');root.replaceChildren(staging);await renderDonorProfile(staging,route.donorId,route.params.get('tab'),{...screenContext(),advanced:profileAdministration});}
  else{if(['imports','reports','settings'].includes(id))root.innerHTML='';await handlers[id](root);}
 }catch(error){if(error.status===401){if(user)authUI.showSignIn();return;}if(token===generation&&user){root.querySelector('.loading')?.remove();const message=document.createElement('p');message.className='error';message.setAttribute('role','alert');message.textContent=`Unable to load this page. ${error.message}`;root.append(message);action('Try again',render,root);}}
}
window.addEventListener('hashchange', () => { render(); main.focus(); });
const authUI=initializeAuthUI({api,esc,onNotice:notify,onDialogOpen:()=>{dialogOpener=document.querySelector('#session');},onSignedOut:()=>{clearNotice();resetImportReview();rememberDonorList('#donors');user=null;generation++;},onAuthenticated:async(account,{render:shouldRender,navigate})=>{
  user=account;if(navigate)history.replaceState(null,'',`#${account.preferences?.startPage||'dashboard'}`);
  if(shouldRender){const focused=document.activeElement;await render();if(user&&navigate&&document.activeElement===focused)main.focus({preventScroll:true});}
}});
