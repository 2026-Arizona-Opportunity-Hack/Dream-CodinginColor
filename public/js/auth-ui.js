// The server decides every authentication transition. No credentials or factors use browser storage.
export function initializeAuthUI({api,esc,onAuthenticated,onSignedOut,onDialogOpen,onNotice=()=>{}}){
 const shell=document.querySelector('#app-shell'),screen=document.querySelector('#sign-in'),content=document.querySelector('#auth-content'),tabs=document.querySelector('#auth-tabs');
 const modal=document.querySelector('#modal'),modalForm=document.querySelector('#modal-form'),trigger=document.querySelector('#session'),dropdown=document.querySelector('#account-dropdown'),menu=document.querySelector('#account-menu');
 let account=null,version=0;
 const passwordField=(name,label,policy=false)=>`<label for="auth-${name}">${esc(label)}</label><div class="password-control"><input id="auth-${name}" name="${name}" data-password type="password" autocomplete="${name==='newPassword'?'new-password':'current-password'}" maxlength="128" ${policy?'minlength="10"':''} required><button type="button" data-toggle-password="auth-${name}" aria-pressed="false">Show password</button></div>${policy?'<p class="muted">Use 10–128 characters, including uppercase, lowercase, a number and a special character.</p>':''}`;
 const emailField='<label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="username" required>';
 const formHtml=fields=>`<form id="sign-in-form">${fields}<p id="sign-in-error" role="alert"></p><button class="primary" type="submit">Continue</button></form>`;
 const role=()=>account?.roleName||account?.roleId||'Not provided';
 const factorFields=()=>passwordField('currentPassword','Current password')+'<p>Use a fresh authenticator code or one unused recovery code. Accepted codes cannot be reused.</p><label>Authenticator code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"></label><label>Or recovery code<input name="recoveryCode" autocomplete="off" maxlength="80"></label>';
 const factorBody=values=>({currentPassword:values.currentPassword,...(values.code?{code:values.code}:{}),...(values.recoveryCode?{recoveryCode:values.recoveryCode}:{})});
 function closeMenu(focus=false){dropdown.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus&&account)trigger.focus({preventScroll:true});}
 function hideWorkspace(){account=null;onSignedOut();shell.hidden=true;closeMenu();if(modal.open)modal.close();document.querySelector('#main').replaceChildren();document.querySelector('#modal-fields').replaceChildren();for(const id of ['notice','modal-error','modal-title','account-name','account-email','account-role','account-state','account-error','session-name'])document.getElementById(id).textContent='';}
 function authView(title,html,allowTabs=false){hideWorkspace();screen.hidden=false;tabs.hidden=!allowTabs;document.querySelector('#session-status').hidden=true;document.title=`${title} · ColorLoop`;content.innerHTML=`<h1 id="sign-in-title">${esc(title)}</h1>${html}`;}
 async function submit(form,work){
  const button=form.querySelector('[type=submit]'),error=form.querySelector('[role=alert]');button.disabled=true;if(error)error.textContent='';
  try{await work(Object.fromEntries(new FormData(form)));}catch(cause){if(error&&form.isConnected)error.textContent=cause.message;}
  finally{for(const input of form.querySelectorAll('[data-password],input[name=code],input[name=recoveryCode]'))input.value='';button.disabled=false;}
 }
 function loggedOut(message=''){
  version++;authView('Welcome to ColorLoop',formHtml(emailField+passwordField('password','Password')),true);history.replaceState(null,'','#sign-in');
  document.querySelector('#sign-in-form button[type=submit]').textContent='Sign In';document.querySelector('#sign-in-error').textContent=message;
  const form=document.querySelector('#sign-in-form');form.onsubmit=event=>{event.preventDefault();submit(form,async values=>{await api('/auth/login',{method:'POST',body:values});await refresh({navigate:true});});};
  document.querySelector('#auth-email').focus();
 }
 function signup(){
  authView('Request an account',formHtml('<p>A CIC administrator must approve your request. Signup does not grant donor access or administrator permissions.</p><label>Full name<input name="name" autocomplete="name" maxlength="120" required></label>'+emailField+passwordField('password','Choose a password',true)),true);
  const form=document.querySelector('#sign-in-form');form.querySelector('[type=submit]').textContent='Request Account';form.onsubmit=event=>{event.preventDefault();submit(form,async values=>{const result=await api('/auth/signup',{method:'POST',body:values});loggedOut();const message=document.createElement('p');message.setAttribute('role','status');message.textContent=result.message;content.prepend(message);});};
 }
 function backToSignIn(){const button=document.createElement('button');button.type='button';button.textContent='Back to Sign In';button.onclick=async()=>{button.disabled=true;try{await api('/auth/logout',{method:'POST',body:{}});loggedOut();}catch(error){button.disabled=false;const message=content.querySelector('[role=alert]');if(message)message.textContent=error.message;}};content.append(button);}
 function recoveryView(codes,done){
  const html='<p>Save these recovery codes offline. Each works once and they will not be shown again.</p><ul class="recovery-codes">'+codes.map(code=>`<li data-recovery-code>${esc(code)}</li>`).join('')+'</ul>';
  if(account){dialog('Save recovery codes',html,async()=>{document.querySelector('#modal-fields').replaceChildren();modal.close();},'I saved my codes');}
  else{authView('Save recovery codes',html+'<button id="recovery-done" type="button">I saved my codes — Continue</button>');document.querySelector('#recovery-done').onclick=async()=>{content.replaceChildren();try{await done();}catch{loggedOut('Sign in again to continue.');}};}
 }
 function enrollmentView(){
  authView('Set up two-factor authentication',formHtml('<p>An authenticator is required before donor access. Confirm your password to generate a private QR code.</p>'+passwordField('currentPassword','Current password')));
  const form=document.querySelector('#sign-in-form');form.querySelector('[type=submit]').textContent='Create enrollment QR';form.onsubmit=event=>{event.preventDefault();submit(form,async values=>{
   const setup=await api('/auth/mfa/enroll',{method:'POST',body:values});
   authView('Verify your authenticator',formHtml(`<p>Scan this QR in Google Authenticator, Microsoft Authenticator, Authy or another TOTP app. Keep the QR private; it expires in five minutes.</p><img class="enrollment-qr" src="${esc(setup.qrDataUrl)}" alt="Private ColorLoop authenticator enrollment QR code"><label>Six-digit verification code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>`));
   const confirm=document.querySelector('#sign-in-form');confirm.querySelector('[type=submit]').textContent='Enable 2FA';confirm.onsubmit=event=>{event.preventDefault();submit(confirm,async values=>{const result=await api('/auth/mfa/confirm',{method:'POST',body:values});recoveryView(result.recoveryCodes,()=>refresh({navigate:true}));});};backToSignIn();
  });};backToSignIn();
 }
 function verificationView(recovery=false){
  authView('Verify your sign-in',formHtml(recovery?'<label>One-time recovery code<input name="recoveryCode" autocomplete="off" maxlength="80" required></label>':'<label>Six-digit authenticator code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>'));
  const form=document.querySelector('#sign-in-form');form.querySelector('[type=submit]').textContent='Verify';form.onsubmit=event=>{event.preventDefault();submit(form,async values=>{await api('/auth/mfa/verify',{method:'POST',body:values});await refresh({navigate:true});});};
  const alternative=document.createElement('button');alternative.type='button';alternative.textContent=recovery?'Use authenticator code':'Use a recovery code';alternative.onclick=()=>verificationView(!recovery);content.append(alternative);backToSignIn();
 }
 async function refresh({initial=false,navigate=false}={}){
  const revision=version;
  try{
   const current=await api('/auth/me');if(revision!==version)return;
   if(!current?.id)throw new Error('Account details unavailable.');
   if(current.authentication!=='authenticated'){if(current.authentication==='verification_required')verificationView();else enrollmentView();return;}
   account=current;screen.hidden=true;tabs.hidden=true;shell.hidden=false;document.querySelector('#session-status').hidden=true;
   for(const [id,value] of Object.entries({'session-name':account.name||account.email,'account-name':account.name,'account-email':account.email,'account-role':role(),'account-state':account.active?'Active account':'Inactive account'}))document.getElementById(id).textContent=value||'';
   trigger.setAttribute('aria-label',`Account for ${account.name||account.email}`);await onAuthenticated(account,{render:initial||navigate,navigate});
  }catch(error){if(revision===version&&(initial||navigate||error.status===401))loggedOut(error.status===401?'':'The sign-in service is unavailable. Check your connection.');}
 }
 function dialog(title,html,save,button='Save'){
  if(!account)return;closeMenu();onDialogOpen();document.querySelector('#modal-title').textContent=title;document.querySelector('#modal-fields').innerHTML=html+'<p class="account-form-error" role="alert"></p>';document.querySelector('#modal-error').textContent='';
  modalForm.querySelector('[type=submit]').textContent=button;modalForm.onsubmit=event=>{event.preventDefault();submit(modalForm,save||(async()=>modal.close()));};
  if(!modal.open)modal.showModal();modal.querySelector('input,select,textarea')?.focus();
 }
 function notify(message){onNotice(message);}
 async function profile(){
  const user=await api('/account/profile');if(!account)return;
  dialog('My Profile',`<label>Full name<input name="name" autocomplete="name" maxlength="120" value="${esc(user.name)}" required></label><dl class="profile-details"><dt>Email</dt><dd>${esc(user.email)}</dd><dt>Role</dt><dd>${esc(user.roleName||user.roleId)}</dd><dt>Status</dt><dd>${user.active?'Active':'Inactive'}</dd></dl><p>Email and role changes require an administrator.</p>`,async values=>{await api('/account/profile',{method:'PATCH',body:values});await refresh();modal.close();notify('Profile updated.');});
 }
 async function security(){
  const status=await api('/account/security');if(!account)return;
  const verified=status.lastVerifiedAt?new Date(status.lastVerifiedAt).toLocaleString('en-US',{timeZone:account.preferences?.timeZone||'America/Phoenix'}):'This session';
  dialog('Security',`<p>Authenticator 2FA: <strong>${status.enabled?'Enabled':'Disabled'}</strong>. Required before donor access.</p><p>${status.recoveryCodesRemaining} unused recovery codes. Verified: ${esc(verified)}.</p><div id="security-actions"></div>`,async()=>modal.close(),'Close');
  const actions=document.querySelector('#security-actions');
  for(const [label,kind] of [['Change password','password'],['Regenerate recovery codes','recovery'],['Disable / reset authenticator','reset']]){
   const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>{
    dialog(label,(kind==='reset'?'<p>This revokes all sessions and requires fresh authenticator enrollment before donor access.</p>':'')+factorFields()+(kind==='password'?passwordField('newPassword','New password',true):''),async values=>{
     const result=await api(kind==='password'?'/account/password':kind==='recovery'?'/account/mfa/recovery':'/account/mfa/reset',{method:'POST',body:{...factorBody(values),...(kind==='password'?{newPassword:values.newPassword}:{})}});
     if(result.recoveryCodes)recoveryView(result.recoveryCodes);
     else{modal.close();await refresh({navigate:kind==='reset'});if(kind==='password')notify('Password changed. Other sessions were revoked.');}
    },kind==='reset'?'Confirm reset':'Confirm');
   };actions.append(button);
  }
 }
 async function settings(){
  const prefs=await api('/account/preferences');if(!account)return;
  const pages=[['dashboard','Overview'],['donors','Donors'],['tasks','Follow-ups'],['outreach','Outreach'],...(account.permissions.includes('reports.read')?[['reports','Reports']]:[])];
  dialog('Account Settings',`<label>Preferred start page<select name="startPage">${pages.map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></label><label>Account security display time zone<select name="timeZone"><option value="America/Phoenix">America/Phoenix</option><option value="UTC">UTC</option></select></label><p>Gift dates retain their source calendar date.</p><div id="admin-account-actions"></div>`,async values=>{await api('/account/preferences',{method:'PATCH',body:values});await refresh();modal.close();notify('Account settings saved.');});
  modalForm.elements.startPage.value=prefs.startPage||'dashboard';modalForm.elements.timeZone.value=prefs.timeZone||'America/Phoenix';
  if(account.administrator){
   const parent=document.querySelector('#admin-account-actions');
   const review=document.createElement('button');review.type='button';review.textContent='Review account requests';review.onclick=()=>guard(reviewRequests);parent.append(review);
   const reset=document.createElement('button');reset.type='button';reset.textContent='Reset another account’s authenticator';reset.onclick=()=>guard(adminReset);parent.append(reset);
  }
 }
 async function reviewRequests(){
  const [requests,roles]=await Promise.all([api('/account-requests'),api('/roles')]);if(!account)return;
  if(!requests.length){dialog('Account requests','<p>No pending account requests.</p>',async()=>modal.close(),'Close');return;}
  dialog('Review account requests',`<label>Request<select name="id">${requests.map(r=>`<option value="${esc(r.id)}">${esc(r.name)} — ${esc(r.email)}</option>`).join('')}</select></label><label>Decision<select name="decision"><option value="approve">Approve</option><option value="reject">Reject</option></select></label><label>Approved role<select name="roleId">${roles.filter(r=>r.name!=='administrator'&&r.active!==false).map(r=>`<option value="${esc(r.name)}">${esc(r.label||r.name)}</option>`).join('')}</select></label><label>Board assignment eligibility<select name="boardMember"><option value="true">Active board member</option><option value="false">Staff account</option></select></label>`,async values=>{await api('/account-requests',{method:'POST',body:{...values,boardMember:values.boardMember==='true'}});await reviewRequests();},'Apply reviewed decision');
 }
 async function adminReset(){
  const users=await api('/users');if(!account)return;
  dialog('Administrator authenticator reset',`<p>Verify the account holder’s identity through CIC’s trusted process before resetting. This revokes their sessions and requires new enrollment.</p><label>Account<select name="userId">${users.filter(u=>u.id!==account.id).map(u=>`<option value="${esc(u.id)}">${esc(u.name)} — ${esc(u.email)}</option>`).join('')}</select></label><label>Identity verification / recovery reason<input name="reason" maxlength="1000" required></label>`+factorFields(),async values=>{await api('/account/mfa/admin-reset',{method:'POST',body:{...factorBody(values),userId:values.userId,reason:values.reason}});modal.close();notify('Authenticator reset. The account must sign in and enroll again.');},'Reset reviewed account');
 }
 async function guard(work){try{await work();}catch(error){if(account)document.querySelector('#account-error').textContent=error.message;}}
 trigger.onclick=()=>{if(!account)return;dropdown.hidden=!dropdown.hidden;trigger.setAttribute('aria-expanded',String(!dropdown.hidden));if(!dropdown.hidden)trigger.focus({preventScroll:true});};
 document.addEventListener('click',event=>{
  if(!menu.contains(event.target))closeMenu();
  const toggle=event.target.closest('[data-toggle-password]');if(toggle){const input=document.getElementById(toggle.dataset.togglePassword);const show=input.type==='password';input.type=show?'text':'password';toggle.setAttribute('aria-pressed',String(show));toggle.textContent=show?'Hide password':'Show password';}
 });
 menu.addEventListener('focusout',event=>{if(event.relatedTarget&&!menu.contains(event.relatedTarget))closeMenu();});
 menu.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!dropdown.hidden){event.preventDefault();closeMenu(true);}
  if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();dropdown.hidden=false;trigger.setAttribute('aria-expanded','true');const buttons=[...dropdown.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);buttons[index<0?(event.key==='ArrowDown'?0:buttons.length-1):(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}
 });
 document.querySelector('#my-profile').onclick=()=>guard(profile);document.querySelector('#account-security').onclick=()=>guard(security);document.querySelector('#account-settings').onclick=()=>guard(settings);
 document.querySelector('#sign-out').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await api('/auth/logout',{method:'POST',body:{}});loggedOut();}catch(error){if(account)document.querySelector('#account-error').textContent=error.message;}finally{button.disabled=false;}};
 document.querySelector('#auth-sign-in').onclick=()=>loggedOut();document.querySelector('#auth-sign-up').onclick=signup;
 window.addEventListener('colorloop:session-expired',()=>loggedOut());window.addEventListener('colorloop:mfa-required',()=>refresh());
 window.addEventListener('focus',()=>{if(account)refresh();});document.addEventListener('visibilitychange',()=>{if(account&&document.visibilityState==='visible')refresh();});
 window.addEventListener('pagehide',()=>{version++;hideWorkspace();});window.addEventListener('pageshow',event=>{if(event.persisted){document.querySelector('#session-status').hidden=false;refresh({initial:true});}});
 setInterval(()=>{if(account&&document.visibilityState==='visible')refresh();},60000);
 refresh({initial:true});return {refresh,showSignIn:loggedOut};
}
