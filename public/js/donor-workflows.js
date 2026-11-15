import {api,esc,rows} from './api.js';
import {mountDonorSelector,displayMoney,displayDate} from './ui.js';
import {profileUrl} from './donor-view.js';

// These forms reuse the existing API adapter and shared accessible dialog.
export function donorWorkflows(ctx){
 const {user,form,field,optional,select,donorFields,notify}=ctx;
 const can=p=>user.permissions.includes(p);
 const formElement=()=>document.querySelector('#modal-form');
 const requirePermission=p=>{if(!can(p))throw new Error('Your account cannot perform this action.');};
 async function editDonor(id){
  requirePermission('donors.write');const saveKey=`donor-${crypto.randomUUID()}`;const donor=id?await api(`/donors/${encodeURIComponent(id)}`):null;
  const owners=!id&&can('assignments.manage')?rows(await api('/board-members')).filter(m=>m.active!==false):[];
  const definitions=rows(await api('/custom-fields')).filter(f=>f.active!==false&&!f.hidden);
  const custom=definitions.map(f=>{const value=donor?.custom_fields?.[f.id]??'';if(f.type==='dropdown')return select(`custom:${f.id}`,f.label,[['','Not recorded'],...(f.options||[]).map(v=>[v,v])]);return `<label>${esc(f.label)}<input name="custom:${esc(f.id)}" type="${['checkbox','number','date'].includes(f.type)?f.type:'text'}" ${f.type==='number'?'step="any"':''} ${f.validation_rules?.required&&f.type!=='checkbox'?'required':''} ${f.type==='checkbox'?(value?'checked':''):`value="${esc(value)}"`}></label>`;}).join('');
  form(donor?'Edit donor':'Add donor',donorFields(donor||{})+select('email_consent','Email contact permission',[['false','No recorded consent'],['true','Verified consent']])+select('sms_consent','Text contact permission',[['false','No recorded consent'],['true','Verified consent']])+select('opted_out','Contact opt-out',[['false','No opt-out recorded'],['true','Opted out. Do not contact']])+custom+(donor?'':(can('assignments.manage')?select('owner_id','Relationship owner',[['','Balance ownership automatically'],...owners.map(m=>[m.id,m.name])]):'')+'<label>Introduction note<textarea name="notes" maxlength="4000"></textarea></label><div id="donor-duplicate-review"></div>'),async values=>{
   const custom_fields={};for(const f of definitions){const value=values[`custom:${f.id}`];custom_fields[f.id]=f.type==='checkbox'?value==='on':f.type==='number'&&value!==''?Number(value):value;delete values[`custom:${f.id}`];}
   for(const key of ['email_consent','sms_consent','opted_out'])values[key]=values[key]==='true';
   if(!id){values.idempotency_key=saveKey;if(values.allow_duplicate){if(!values.duplicate_reason||values.duplicate_reason.trim().length<3)throw new Error('Explain why this is a distinct donor.');values.allow_duplicate=true;}}
   let saved;
   try{saved=await api(`/donors${id?'/'+encodeURIComponent(id):''}`,{method:id?'PATCH':'POST',body:{...values,custom_fields}});}
   catch(error){if(!id&&error.code==='DUPLICATE_DONOR'){const target=formElement().querySelector('#donor-duplicate-review');target.innerHTML='<p class="error">Possible duplicate. Review existing donors before deliberately creating a distinct record.</p><label><span><input type="checkbox" name="allow_duplicate" required> I verified this is a distinct donor, not a duplicate.</span></label><label>Why this is a distinct donor<textarea name="duplicate_reason" minlength="3" maxlength="500" required></textarea></label>';}throw error;}

   if(!id)location.hash=profileUrl(saved.id,'details');
  },donor?'Save donor details':'Create donor');
  const element=formElement();element.elements.namedItem('donor_type').value=donor?.donor_type||'person';
  for(const key of ['email_consent','sms_consent','opted_out'])element.elements.namedItem(key).value=String(donor?.[key]===true);
  for(const f of definitions.filter(f=>f.type==='dropdown'))element.elements.namedItem(`custom:${f.id}`).value=donor?.custom_fields?.[f.id]||'';
 }
 async function followUp(donor){
  requirePermission('tasks.manage');
  const [donors,members]=await Promise.all([api('/donors'),api('/board-members')]);
  const assignees=[[user.id,`Me · ${user.name||user.email}`],...rows(members).filter(m=>m.active!==false&&m.id!==user.id).map(m=>[m.id,m.name])];
  form('New follow-up',field('title','Next action')+field('due_date','Deadline','date')+select('assignee_id','Assigned to',assignees),values=>api('/tasks',{method:'POST',body:values}),'Save follow-up');
  mountDonorSelector(document.querySelector('#modal-fields'),rows(donors));
  if(donor){const element=formElement();element.elements.namedItem('donor_id').value=donor.id;element.elements.namedItem('title').focus();}
 }
 async function draft(donor){
  requirePermission('outreach.write');const [donors,templates]=await Promise.all([api('/donors'),api('/outreach/templates')]);
  form('New outreach draft',select('templateId','Message template',rows(templates).map(t=>[t.id,t.name]))+'<p>No message is sent. Review and approval come next.</p>',async values=>{const saved=await api('/outreach/drafts',{method:'POST',body:values});location.hash=`outreach?view=drafts&draft=${encodeURIComponent(saved.id)}`;},'Prepare draft');
  mountDonorSelector(document.querySelector('#modal-fields'),rows(donors));
  if(donor){formElement().elements.namedItem('donor_id').value=donor.id;formElement().elements.namedItem('templateId').focus();}
 }
 async function recordGift(donor){
  requirePermission('donations.write');const campaigns=rows(await api('/campaigns')).filter(c=>!c.archived);
  const key=`manual-${crypto.randomUUID()}`;let reviewed=null;
  form('Record a gift',`<p>For ${esc(donor.name)}. Record only information supported by the payment record.</p><fieldset id="gift-inputs"><legend>Gift details</legend>`+field('amount','Gift amount','number')+optional('currency','Currency code (leave blank if unknown)','text','')+select('status','Payment status',[['','Unknown payment status'],['completed','Completed'],['pending','Pending'],['refunded','Refunded'],['voided','Voided']])+field('donated_at','Gift date','date')+select('source','Payment source',[['cash','Cash'],['check','Check'],['offline','Other offline gift'],['Manual','Other manual gift']])+optional('external_transaction_id','Transaction or check reference')+optional('program','Program')+select('campaign_id','Campaign',[['','No campaign'],...campaigns.map(c=>[c.id,c.name])])+'<label>Gift note<textarea name="notes" maxlength="4000"></textarea></label></fieldset><section id="gift-review" hidden aria-label="Review gift"></section>',async values=>{
   const element=formElement(),review=element.querySelector('#gift-review');
   if(!reviewed){
    if(!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(values.amount)||Number(values.amount)<=0)throw new Error('Enter a positive amount with no more than two decimal places.');
    if(values.currency&&!/^[A-Z]{3}$/.test(values.currency))throw new Error('Use a three-letter uppercase currency code.');
    reviewed={...values,currency:values.currency||null,status:values.status||null,idempotency_key:key};if(!values.external_transaction_id.trim())delete reviewed.external_transaction_id;
    review.innerHTML=`<h3>Review before saving</h3><dl class="profile-details"><dt>Donor</dt><dd>${esc(donor.name)}</dd><dt>Gift</dt><dd>${esc(displayMoney(values.amount,values.currency))}</dd><dt>Date</dt><dd>${esc(displayDate(values.donated_at))}</dd><dt>Source and status</dt><dd>${esc(values.source)} · ${esc(values.status||'Payment status unknown')}</dd><dt>Campaign</dt><dd>${esc(campaigns.find(c=>c.id===values.campaign_id)?.name||'No campaign')}</dd><dt>Reference</dt><dd>${esc(reviewed.external_transaction_id||'No transaction reference provided')}</dd></dl><p>Saving records a gift. It never sends a message.</p><button type="button" id="edit-gift-review">Edit gift details</button>`;
    element.querySelector('#gift-inputs').hidden=true;element.querySelector('#gift-inputs').disabled=true;review.hidden=false;
    const button=element.querySelector('[type=submit]');button.textContent='Save reviewed gift';
    element.querySelector('#edit-gift-review').onclick=()=>{reviewed=null;element.querySelector('#gift-inputs').hidden=false;element.querySelector('#gift-inputs').disabled=false;review.hidden=true;button.textContent='Review gift';element.elements.namedItem('amount').focus();};
    review.querySelector('button').focus();return false;
   }
   if(element.querySelector('[name=allow_duplicate]')){
    const confirmed=element.querySelector('[name=allow_duplicate]').checked,reason=element.querySelector('[name=duplicate_reason]').value.trim();
    if(!confirmed||reason.length<3)throw new Error('Verify this is a separate gift and explain the source evidence before saving.');
    reviewed={...reviewed,allow_duplicate:true,duplicate_reason:reason};
   }
   try{await api(`/donors/${encodeURIComponent(donor.id)}/donations`,{method:'POST',body:reviewed});}
   catch(error){if(error.code==='POSSIBLE_DUPLICATE_GIFT'&&!element.querySelector('[name=allow_duplicate]'))element.querySelector('#gift-review').insertAdjacentHTML('beforeend','<p class="error">A gift with this amount and date already exists. Review the donor history before recording a distinct gift.</p><label><span><input type="checkbox" name="allow_duplicate" required> I verified this is a separate gift.</span></label><label>Source evidence for the distinct gift<textarea name="duplicate_reason" minlength="3" maxlength="500" required></textarea></label>');throw error;}

  },'Review gift');
  formElement().elements.namedItem('currency').setAttribute('pattern','[A-Z]{3}');
 }
 async function note(donor){
  requirePermission('activities.write');form('Record a conversation',select('type','Interaction type',['note','call','meeting','email','text'].map(v=>[v,v]))+optional('program','Program (if known)')+'<label>Note<textarea name="note" required></textarea></label>',values=>api('/activities',{method:'POST',body:{...values,donor_id:donor.id}}),'Save interaction');
 }
 return {editDonor,followUp,draft,recordGift,note,can};
}
