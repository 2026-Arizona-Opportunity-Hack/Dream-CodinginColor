import {audit,newId} from './retention-store.js';
import {check,fail,record,text,find,id} from './retention-http.js';
import {digest,publicUser,sessionFrom} from './permissions.js';
import {verifyPassword,hashPassword,email,issueSession,assertAdministrator} from './auth.js';
import {enrollment,consumeTotp,consumeFactor,recoveryCodes} from './totp.js';

const authFor=(state,req,now)=>{const auth=sessionFrom(state,req,now);if(!auth)fail(401,'UNAUTHENTICATED','Please sign in.');return auth;};
const factorInput=input=>check((typeof input.code==='string')!==(typeof input.recoveryCode==='string'),'Provide one authenticator or recovery code.');
export async function reserveSecurityAttempt(store,account,ip,purpose,now,{limit=8,networkLimit=40,minutes=15}={}){
 if(!ip)fail(503,'CLIENT_IDENTITY_UNAVAILABLE','A trusted client address is required.');
 await store.transaction(state=>{
  state.securityAttempts=state.securityAttempts.filter(a=>+now-new Date(a.at)<60*60000);
  const recent=state.securityAttempts.filter(a=>a.purpose===purpose&&+now-new Date(a.at)<minutes*60000);
  const accountKey=digest(account),networkKey=digest(ip);
  if(recent.filter(a=>a.accountKey===accountKey).length>=limit||recent.filter(a=>a.networkKey===networkKey).length>=networkLimit)fail(429,'RATE_LIMITED','Too many verification attempts. Try again later.');
  state.securityAttempts.push({id:newId(),accountKey,networkKey,purpose,at:now.toISOString()});
 });
}
async function passwordReauth(store,req,input,ip,now){
 const auth=await store.read(state=>authFor(state,req,now));
 await reserveSecurityAttempt(store,auth.user.id,ip,'reauthenticate',now);
 if(!await verifyPassword(input.currentPassword,auth.user.passwordHash))fail(422,'REAUTHENTICATION_FAILED','The current password is incorrect.');
 return auth.user.passwordHash;
}
function unchanged(user,hash){if(user.passwordHash!==hash)fail(409,'ACCOUNT_CHANGED','The account changed. Sign in again.');}
function clearMfa(user){Object.assign(user,{totpEnabled:false,totpSecretCiphertext:null,totpPendingCiphertext:null,totpPendingExpiresAt:null,totpLastStep:-1,recoveryHashes:[],credentialVersion:(user.credentialVersion??0)+1});}
function replaceSession(state,user,now,verified){state.sessions=state.sessions.filter(s=>s.userId!==user.id);return issueSession(state,user,now,verified);}
export const securityStatus=user=>({enabled:user.totpEnabled===true,required:true,recoveryCodesRemaining:(user.recoveryHashes||[]).length});

export async function startEnrollment(store,req,input,ip,now){
 record(input,['currentPassword']);const hash=await passwordReauth(store,req,input,ip,now);
 const user=await store.read(s=>authFor(s,req,now).user);
 if(user.totpEnabled)fail(409,'ALREADY_ENROLLED','Use the secure reset flow before changing authenticators.');
 const setup=await enrollment(user,now);
 await store.transaction(state=>{
  const current=authFor(state,req,now);unchanged(current.user,hash);
  if(current.user.totpEnabled)fail(409,'ALREADY_ENROLLED','Authenticator is already enabled.');
  Object.assign(current.user,{totpPendingCiphertext:setup.ciphertext,totpPendingExpiresAt:setup.expiresAt});
  current.session.passwordVerifiedAt=now.toISOString();current.session.expiresAt=setup.expiresAt;
  audit(state,current.user.id,'security.enrollment-start',current.user.id,now);
 });
 // Enrollment QR necessarily carries the key; only this reauthenticated, no-store response exposes it.
 return {qrDataUrl:setup.qr,expiresAt:setup.expiresAt};
}
export async function completeEnrollment(store,req,input,ip,now){
 record(input,['code']);const account=await store.read(s=>authFor(s,req,now).user.id);
 await reserveSecurityAttempt(store,account,ip,'second-factor',now);
 return store.transaction(state=>{
  const {user,session}=authFor(state,req,now);
  if(user.totpEnabled||!user.totpPendingCiphertext||new Date(user.totpPendingExpiresAt)<=now||!session.passwordVerifiedAt||+now-new Date(session.passwordVerifiedAt)>5*60000)fail(409,'ENROLLMENT_EXPIRED','Start a new enrollment and verify it within five minutes.');
  consumeTotp(user,input.code,now,{pending:true});
  Object.assign(user,{totpEnabled:true,totpSecretCiphertext:user.totpPendingCiphertext,totpPendingCiphertext:null,totpPendingExpiresAt:null,credentialVersion:(user.credentialVersion??0)+1});
  const codes=recoveryCodes(user),result=replaceSession(state,user,now,true);
  audit(state,user.id,'security.enrolled',user.id,now);
  return {...result,recoveryCodes:codes};
 });
}
export async function verifySecondFactor(store,req,input,ip,now){
 record(input,['code','recoveryCode']);factorInput(input);
 const account=await store.read(s=>authFor(s,req,now).user.id);await reserveSecurityAttempt(store,account,ip,'second-factor',now);
 return store.transaction(state=>{
  const {user,session}=authFor(state,req,now);
  if(!user.totpEnabled)fail(403,'ENROLLMENT_REQUIRED','Enroll an authenticator before continuing.');
  if(session.mfaVerifiedAt)fail(409,'ALREADY_VERIFIED','This session is already verified.');
  consumeFactor(user,input,now);state.sessions=state.sessions.filter(s=>s.id!==session.id);
  const result=issueSession(state,user,now,true);audit(state,user.id,'auth.login',user.id,now,{factor:input.recoveryCode?'recovery':'totp'});return result;
 });
}
export async function changeSecurity(store,req,input,ip,now,action){
 const fields={password:['currentPassword','newPassword','code','recoveryCode'],recovery:['currentPassword','code','recoveryCode'],disable:['currentPassword','code','recoveryCode'],reset:['currentPassword','code','recoveryCode','userId','reason']};
 record(input,fields[action]);factorInput(input);const hash=await passwordReauth(store,req,input,ip,now);
 const nextHash=action==='password'?await hashPassword(input.newPassword):null;
 return store.transaction(state=>{
  const {user}=authFor(state,req,now);unchanged(user,hash);consumeFactor(user,input,now);
  if(action==='reset'){
   const role=find(state.roles,user.roleId,'Role');assertAdministrator({administrator:role.id==='administrator'});
   const target=find(state.users,id(input.userId),'User');check(target.id!==user.id,'Use the self-service authenticator reset for your own account.');
   const reason=text(input.reason,'Verified identity/recovery reason',1000);clearMfa(target);state.sessions=state.sessions.filter(s=>s.userId!==target.id);
   audit(state,user.id,'security.admin-reset',target.id,now,{reason});return {reset:true};
  }
  if(action==='recovery'){
   const codes=recoveryCodes(user);audit(state,user.id,'security.recovery-regenerated',user.id,now);return {recoveryCodes:codes};
  }
  if(action==='disable'){
   clearMfa(user);audit(state,user.id,'security.reset',user.id,now);return replaceSession(state,user,now,false);
  }
  user.passwordHash=nextHash;user.credentialVersion=(user.credentialVersion??0)+1;
  audit(state,user.id,'security.password-changed',user.id,now);return replaceSession(state,user,now,true);
 });
}
export async function updateOwnProfile(store,actor,input,now){
 record(input,['name']);const name=text(input.name,'Full name',120);
 return store.transaction(state=>{const user=find(state.users,actor.id,'User');user.name=name;audit(state,user.id,'account.profile-update',user.id,now);return publicUser(user);});
}
export async function updatePreferences(store,actor,input,now){
 record(input,['startPage','timeZone']);check(['dashboard','donors','tasks','outreach','reports'].includes(input.startPage),'Choose a supported start page.');
 if(input.startPage==='reports'&&!actor.permissions.includes('reports.read'))fail(403,'FORBIDDEN','Your role cannot use Reports as a start page.');
 check(['America/Phoenix','UTC'].includes(input.timeZone),'Choose a supported time zone.');
 return store.transaction(state=>{const user=find(state.users,actor.id,'User');user.preferences={startPage:input.startPage,timeZone:input.timeZone};audit(state,user.id,'account.preferences-update',user.id,now);return user.preferences;});
}
export async function requestAccount(store,input,ip,now){
 record(input,['name','email','password']);const name=text(input.name,'Full name',120),address=email(input.email);
 await reserveSecurityAttempt(store,address,ip,'signup',now,{limit:3,networkLimit:10,minutes:60});const hash=await hashPassword(input.password);
 await store.transaction(state=>{
  if(state.users.some(u=>u.email===address)||state.accountRequests.some(r=>r.email===address&&r.status==='pending'))return;
  state.accountRequests.push({id:newId(),name,email:address,passwordHash:hash,status:'pending',createdAt:now.toISOString()});
 });
 return {message:'If eligible, your account request will be reviewed by a CIC administrator. You cannot sign in until approved.'};
}
export async function reviewAccountRequest(store,actor,input,now){
 assertAdministrator(actor);record(input,['id','decision','roleId','boardMember']);check(['approve','reject'].includes(input.decision),'Choose approve or reject.');
 return store.transaction(state=>{
  const request=find(state.accountRequests,id(input.id),'Account request');check(request.status==='pending','This request has already been reviewed.');
  if(input.decision==='approve'){
   const role=find(state.roles,id(input.roleId),'Role');check(role.active!==false&&role.id!=='administrator','Public signup cannot grant administrator access.');
   check(!state.users.some(u=>u.email===request.email),'An account already exists.');
   if(input.boardMember!==undefined)check(typeof input.boardMember==='boolean','Invalid board membership.');
   const user={id:newId(),name:request.name,email:request.email,passwordHash:request.passwordHash,roleId:role.id,active:true,boardMember:input.boardMember??role.id==='board-member'};
   state.users.push(user);request.userId=user.id;
  }
  Object.assign(request,{status:input.decision==='approve'?'approved':'rejected',passwordHash:null,reviewedBy:actor.id,reviewedAt:now.toISOString()});
  audit(state,actor.id,`accounts.${request.status}`,request.id,now,{userId:request.userId||null,roleId:input.roleId||null});return {id:request.id,status:request.status};
 });
}
