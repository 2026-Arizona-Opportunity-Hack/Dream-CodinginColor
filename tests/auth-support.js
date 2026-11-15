// Genuine factors for synthetic tests. This helper never bypasses the production MFA gate.
import {login} from '../lib/auth.js';
import {startEnrollment,completeEnrollment,verifySecondFactor} from '../lib/account-security.js';
import {authenticator,decryptTotp} from '../lib/totp.js';
process.env.MFA_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
export function testCode(user,now,{pending=false}={}){
 const secret=decryptTotp(pending?user.totpPendingCiphertext:user.totpSecretCiphertext,user.id);
 const step=Math.max(Math.floor(+now/30000),Number(user.totpLastStep??-1)+1);
 if(step>Math.floor(+now/30000)+1)throw new Error('Advance the synthetic test clock before using another TOTP code.');
 return authenticator(secret,user.email).generate({timestamp:step*30000});
}
export async function signIn(store,input,ip,now){
 const partial=await login(store,input,ip,now);
 const req={headers:{cookie:`__Host-colorloop=${partial.token}`,'x-csrf-token':partial.csrfToken}};
 if(partial.authentication==='enrollment_required'){
  await startEnrollment(store,req,{currentPassword:input.password},ip,now);
  const user=await store.read(s=>s.users.find(u=>u.id===partial.user.id));
  return completeEnrollment(store,req,{code:testCode(user,now,{pending:true})},ip,now);
 }
 const user=await store.read(s=>s.users.find(u=>u.id===partial.user.id));
 return verifySecondFactor(store,req,{code:testCode(user,now)},ip,now);
}
