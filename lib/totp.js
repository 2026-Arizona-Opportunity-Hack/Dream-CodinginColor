import {createCipheriv,createDecipheriv,randomBytes,timingSafeEqual} from 'node:crypto';
import {TOTP,Secret} from 'otpauth';
import QRCode from 'qrcode';
import {digest} from './permissions.js';
import {fail} from './retention-http.js';

function encryptionKey(){
 const encoded=process.env.MFA_ENCRYPTION_KEY;
 if(typeof encoded!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(encoded))fail(503,'MFA_UNCONFIGURED','Two-factor authentication requires a configured server encryption key.');
 const key=Buffer.from(encoded,'base64');if(key.length!==32)fail(503,'MFA_UNCONFIGURED','The server encryption key is invalid.');return key;
}
export function encryptTotp(secret,userId){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);
 cipher.setAAD(Buffer.from(`colorloop:totp:v1:${userId}`));
 const encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
 return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),encrypted.toString('base64')].join('.');
}
export function decryptTotp(envelope,userId){
 const key=encryptionKey();
 try{
  const [version,iv,tag,ciphertext,...extra]=String(envelope).split('.');if(version!=='v1'||extra.length)throw new Error();
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));decipher.setAAD(Buffer.from(`colorloop:totp:v1:${userId}`));decipher.setAuthTag(Buffer.from(tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext,'base64')),decipher.final()]).toString('utf8');
 }catch{fail(503,'MFA_UNAVAILABLE','Authenticator data cannot be opened. Contact the account administrator.');}
}
export function authenticator(secret,email){return new TOTP({issuer:'Coding in Color · ColorLoop',label:email,algorithm:'SHA1',digits:6,period:30,secret:Secret.fromBase32(secret)});}
export async function enrollment(user,now){
 const secret=new Secret({size:20}).base32;
 const qr=await QRCode.toDataURL(authenticator(secret,user.email).toString(),{errorCorrectionLevel:'M',margin:4,width:280});
 return {ciphertext:encryptTotp(secret,user.id),expiresAt:new Date(+now+5*60000).toISOString(),qr};
}
export function consumeTotp(user,code,now,{pending=false}={}){
 if(typeof code!=='string'||!/^\d{6}$/.test(code))fail(422,'INVALID_FACTOR','The verification code is invalid or has already been used.');
 const otp=authenticator(decryptTotp(pending?user.totpPendingCiphertext:user.totpSecretCiphertext,user.id),user.email);
 const delta=otp.validate({token:code,timestamp:+now,window:1});
 const step=Math.floor(+now/30000)+(delta??0);
 if(delta===null||step<=Number(user.totpLastStep??-1))fail(422,'INVALID_FACTOR','The verification code is invalid or has already been used.');
 user.totpLastStep=step;
}
const recoveryHash=(userId,code)=>digest(`colorloop:recovery:${userId}:${code.replaceAll('-','').toLowerCase()}`);
export function recoveryCodes(user){
 const codes=Array.from({length:10},()=>randomBytes(16).toString('hex').match(/.{1,4}/g).join('-'));
 user.recoveryHashes=codes.map(code=>recoveryHash(user.id,code));return codes;
}
export function consumeFactor(user,input,now){
 if(input.recoveryCode!==undefined){
  if(typeof input.recoveryCode!=='string'||!/^(?:[0-9a-fA-F]{4}-){7}[0-9a-fA-F]{4}$/.test(input.recoveryCode))fail(422,'INVALID_FACTOR','The recovery code is invalid or has already been used.');
  const hash=Buffer.from(recoveryHash(user.id,input.recoveryCode));
  const index=(user.recoveryHashes||[]).findIndex(value=>{const expected=Buffer.from(value);return expected.length===hash.length&&timingSafeEqual(expected,hash);});
  if(index<0)fail(422,'INVALID_FACTOR','The recovery code is invalid or has already been used.');user.recoveryHashes.splice(index,1);
 }else consumeTotp(user,input.code,now);
}
