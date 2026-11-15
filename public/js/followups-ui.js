import {loadFollowUps} from './mentor-data.js';
import {api,esc,rows} from './api.js';
import {displayDate} from './ui.js';
import {profileUrl,taskBucket,localDay} from './donor-view.js';
export async function renderFollowUps(root,ctx){
 const {user,form,field,select,action,panel,table,notify,workflows}=ctx,can=p=>user.permissions.includes(p);
 const [tasks,members,donors]=await Promise.all([loadFollowUps(null,user.preferences?.timeZone),api('/board-members'),api('/donors')]);
 const assignees=[[user.id,`Me · ${user.name||user.email}`],...rows(members).filter(m=>m.active!==false&&m.id!==user.id).map(m=>[m.id,m.name])];
 const owner=id=>id===user.id?user.name:rows(members).find(m=>m.id===id)?.name||(id?'Owner unavailable':'Not assigned');
 const donorName=id=>rows(donors).find(d=>d.id===id)?.name||'Donor unavailable';
 root.innerHTML='<div class="toolbar" id="follow-up-actions"></div><div id="follow-up-groups"></div>';
 if(can('tasks.manage')){const button=action('Create follow-up',()=>workflows.followUp(),root.querySelector('#follow-up-actions'));button.className='primary';}
 const today=localDay(new Date(),user.preferences?.timeZone);
 const update=task=>{
  form(`Update follow-up`,field('due_date','Deadline','date',task.due_date?.slice(0,10))+select('assignee_id','Reassign to',assignees.some(([id])=>id===task.assignee_id)?assignees:[...assignees,[task.assignee_id,'Current owner (name unavailable)']])+select('status','Status',[['open','Open'],['in_progress','In progress'],['completed','Completed'],['cancelled','Cancelled']])+(can('activities.write')?'<label>What happened? Add a note<textarea name="note"></textarea></label>':'')+`<p>For ${esc(donorName(task.donor_id))}: ${esc(task.title)}</p>`,async values=>{
   const {note,...body}=values;
   // Task + note are separate supported operations. Keep a saved note from repeating on retry.
   if(note){await api('/activities',{method:'POST',body:{donor_id:task.donor_id,note}});document.querySelector('#modal-form').elements.namedItem('note').value='';}
   try{await api(`/tasks/${encodeURIComponent(task.id)}`,{method:'PATCH',body});}catch(error){if(note)error.message=`The note was saved, but the follow-up was not updated. ${error.message}`;throw error;}
  },'Save follow-up');
  const element=document.querySelector('#modal-form');element.elements.namedItem('assignee_id').value=task.assignee_id;element.elements.namedItem('status').value=task.status;
 };
 const groups=root.querySelector('#follow-up-groups');
 for(const [bucket,label] of [['overdue','Overdue'],['today','Today'],['soon','Next seven days'],['later','Later'],['undated','Date not recorded'],['closed','Completed and cancelled']]){
  const list=rows(tasks).filter(t=>taskBucket(t,today)===bucket);
  if(list.length)groups.insertAdjacentHTML('beforeend',panel(`${label} (${list.length})`,table(['Donor','Next action','Deadline','Assigned to','Status','Actions'],list,t=>`<tr><td><a href="${profileUrl(t.donor_id)}">${esc(donorName(t.donor_id))}</a></td><td>${esc(t.title)}</td><td>${esc(displayDate(t.due_date))}</td><td>${esc(t.assignee_name||owner(t.assignee_id))}</td><td><span class="badge">${bucket==='overdue'?'Overdue':esc(t.status.replaceAll('_',' '))}</span></td><td>${can('tasks.manage')?`<button type="button" data-task="${esc(t.id)}" aria-label="Update ${esc(t.title)} for ${esc(donorName(t.donor_id))}">Update</button>`:'Read only'}</td></tr>`)));
 }
 if(!rows(tasks).length)groups.innerHTML='<section class="panel"><h2>No follow-ups yet</h2><p>Schedule the next conversation with a donor. Completed work will stay in their profile.</p><a href="#donors">Choose a donor</a></section>';
 root.querySelectorAll('[data-task]').forEach(button=>button.onclick=()=>update(rows(tasks).find(t=>t.id===button.dataset.task)));
 const selected=new URLSearchParams(location.hash.split('?')[1]||'').get('task');
 if(selected&&can('tasks.manage')){const task=rows(tasks).find(t=>t.id===selected);if(task)update(task);else notify('This follow-up is unavailable to your account.');}
 if(can('tasks.manage')&&can('outreach.write'))action('Generate overdue reminder drafts',async()=>{await api('/tasks/reminders',{method:'POST',body:{kind:'overdue'}});notify('Reminder drafts prepared for review. No messages sent.');},root);
}
