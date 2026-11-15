import {boardScoped} from './donor-view.js';
import {api,esc,rows} from './api.js';
import {displayDate} from './ui.js';
import {profileUrl} from './donor-view.js';

// A local comparison never authorizes a merge. Only a live server preview does.
export async function renderDuplicateReview(root,ctx){
 if(!ctx.user.permissions.includes('donors.write')||boardScoped(ctx.user))throw new Error('Duplicate review requires staff donor-edit permission.');
 const [donors,candidates,members]=await Promise.all([api('/donors'),api('/merges/candidates'),api('/board-members')]);
 root.innerHTML='<a href="#donors">Back to donors</a><h2>Compare donor records</h2><p>No records are merged automatically. Independently verify the identity before merging. Matching names alone are not proof.</p><p class="muted">'+rows(candidates).length+' donors appear in suggested duplicate pairs. You can also search other records.</p><form id="duplicate-selection"><div class="compare-grid">'+['target','source'].map((kind)=>`<fieldset><legend>${kind==='target'?'Retain this donor':'Archive this donor'}</legend><label>Search by name or email<input type="search" id="${kind}-search"></label><label>Donor<select required name="${kind}Id" id="${kind}-donor"><option value="">Choose a donor</option></select></label></fieldset>`).join('')+'</div><label>Identity evidence and merge reason<textarea name="reason" minlength="3" maxlength="500" required></textarea></label><button type="submit">Get server merge preview</button><p role="alert" id="duplicate-error"></p></form><div id="duplicate-preview"></div>';
 const form=root.querySelector('form'),preview=root.querySelector('#duplicate-preview');let reviewed=null;
 const invalidate=()=>{reviewed=null;preview.replaceChildren();};
 for(const kind of ['target','source']){
  const search=root.querySelector(`#${kind}-search`),select=root.querySelector(`#${kind}-donor`);
  const fill=()=>{const selected=select.value,query=search.value.toLowerCase(),list=rows(donors).filter(d=>[d.name,d.email].some(v=>String(v||'').toLowerCase().includes(query)));select.replaceChildren(new Option('Choose a donor',''),...list.map(d=>new Option(`${d.name} · ${d.email||'No email'}`,d.id)));if(list.some(d=>d.id===selected))select.value=selected;invalidate();};search.oninput=fill;select.onchange=invalidate;fill();
 }
 form.elements.reason.oninput=invalidate;
 const identities=()=>({sourceId:form.elements.sourceId.value,targetId:form.elements.targetId.value,reason:form.elements.reason.value.trim()});
 form.onsubmit=async event=>{
  event.preventDefault();const button=form.querySelector('button'),error=root.querySelector('#duplicate-error');if(button.disabled)return;button.disabled=true;error.textContent='';invalidate();
  try{
   const values=identities();if(values.sourceId===values.targetId)throw new Error('Choose two different donor records.');
   const result=await api('/merges/preview',{method:'POST',body:values});
   if(!result.preview_id||!result.canonical||!result.source||!Array.isArray(result.blockers)||!Array.isArray(result.warnings)||!Number.isFinite(Date.parse(result.expires_at)))throw new Error('The server did not return a complete merge preview. Merging is disabled.');
   reviewed={values,previewId:result.preview_id,expires:result.expires_at};
   const column=(donor,label)=>`<section class="panel"><h3>${label}</h3><h2>${esc(donor.display_name)}</h2><dl class="profile-details">${[['Email',donor.normalized_email],['Secondary email',donor.secondary_email],['Phone',donor.phone],['Company',donor.company],['Relationship owner',rows(members).find(m=>m.id===donor.assigned_board_member_id)?.name||(donor.assigned_board_member_id?'Owner name unavailable':'Not assigned')],['Email consent',donor.email_consent?'Recorded':'Not recorded'],['Text consent',donor.sms_consent?'Recorded':'Not recorded'],['Opt-out',donor.opted_out?'Opted out':'No opt-out recorded'],...Object.entries(donor.custom_data||{}).map(([key,value])=>[key.replaceAll('_',' '),typeof value==='object'?'Structured value. Review the donor profile.':value])].map(([name,value])=>`<dt>${esc(name)}</dt><dd>${esc(value===true?'Yes':value===false?'No':value??'Not recorded')}</dd>`).join('')}</dl><a href="${profileUrl(donor.id)}">Open full profile</a></section>`;
   const labels={donors:'Source identity',donations:'Gifts',activities:'Notes and interactions',activity_history:'Interaction revisions',tasks:'Follow-ups',outreach_messages:'Outreach messages',outreach_revisions:'Draft revisions',outreach_approval_history:'Approval events',outreach_delivery_history:'Delivery and handoff events',board_assignments:'Ownership records',retention_events:'Retention events',verified_funder_outcomes:'Verified outcomes',import_rows:'Import row references',donor_aliases:'Aliases',donor_merge_history:'Previous merge records'};
   preview.innerHTML=`<div class="compare-grid">${column(result.canonical,'Retained record')}${column(result.source,'Record to archive')}</div><section class="panel"><h3 tabindex="-1">Affected source records</h3><dl class="profile-details">${Object.entries(result.affected||{}).map(([key,count])=>`<dt>${esc(labels[key]||key.replaceAll('_',' '))}</dt><dd>${esc(count)}</dd>`).join('')}</dl><h3>Warnings</h3><ul>${result.warnings.map(message=>`<li>${esc(message)}</li>`).join('')}</ul><p>There is no undo action in ColorLoop. The source is archived, not deleted. Preview expires ${esc(displayDate(result.expires_at))}.</p>${result.blockers.length?'<h3>Resolve before merging</h3><ul>'+result.blockers.map(b=>`<li>${esc(b.message)}</li>`).join('')+'</ul>':''}<form id="merge-confirm"><label><span><input type="checkbox" name="reviewed" required> I reviewed the retained record, affected records and warnings.</span></label><label><span><input type="checkbox" name="identity_confirmed" required> I independently verified that these records belong to the same donor.</span></label><button type="submit" ${result.blockers.length?'disabled':''}>Confirm reviewed merge</button><p role="alert"></p></form></section>`;
   preview.querySelector('h3').focus();
   preview.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const confirmation=e.currentTarget,submit=confirmation.querySelector('button');if(submit.disabled)return;submit.disabled=true;
    try{
     if(!reviewed||JSON.stringify(identities())!==JSON.stringify(reviewed.values)||Date.parse(reviewed.expires)<=Date.now())throw new Error('The preview changed or expired. Get a new server preview and review it.');
     if(!confirmation.elements.reviewed.checked||!confirmation.elements.identity_confirmed.checked)throw new Error('Confirm both the review and independent identity verification.');
     const merged=await api('/merges',{method:'POST',body:{...reviewed.values,preview_id:reviewed.previewId,confirmed:true,identity_confirmed:true}});
     preview.innerHTML=`<section class="panel" tabindex="-1"><h2>Merge recorded</h2><p>${esc(merged.donations_moved)} gift records and ${esc(merged.outcomes_moved??'an unreported number of')} verified outcome records moved. The source donor was archived.</p><p>${esc(merged.drafts_requiring_review??'An unreported number of')} moved outreach drafts require fresh review.</p><a class="button-link" href="${profileUrl(merged.canonical_donor_id)}">Open retained donor</a></section>`;preview.querySelector('section').focus();form.hidden=true;
    }catch(cause){confirmation.querySelector('[role=alert]').textContent=`${cause.message} Get a new server preview before trying again.`;reviewed=null;submit.disabled=true;}
   };
  }catch(cause){error.textContent=[404,405].includes(cause.status)?'Server merge preview is unavailable. Merging is disabled in this version.':cause.message;}finally{button.disabled=false;}
 };
}
