import {createHash} from 'node:crypto';
import {DEPLOYMENT} from './deployment-mode.js';
import {DataError} from './data-validation.js';
export const fingerprint=value=>createHash('sha256').update(value).digest('hex');
export const normalizedDatabaseHost=host=>host.toLowerCase().replace(/-pooler(?=\.)/,'');
export const isJudgeDeployment=(env=process.env)=>DEPLOYMENT.judge||env.COLORLOOP_ENVIRONMENT==='judge';
const unavailable=()=>new DataError('JUDGE_DEMO_UNAVAILABLE','Judge Demo is unavailable. Ask the demo operator to check its dedicated configuration.',503);
export function judgeDeploymentConfig(env=process.env,protectedMain=DEPLOYMENT.protectedMain){
 if(!isJudgeDeployment(env))return null;
 try{
  if(env.COLORLOOP_ENVIRONMENT!=='judge'||!protectedMain?.databaseHostHash||!protectedMain?.mfaKeyHash)throw unavailable();
  if(env.DATABASE_URL||env.RESEND_API_KEY||env.CRON_SECRET||env.AUTOMATION_USER_ID||env.COLORLOOP_STORE||env.COLORLOOP_DEMO==='true')throw unavailable();
  if(env.EMAIL_DELIVERY_MODE!=='disabled'||env.EMAIL_CRON_ENABLED!=='false'||env.CIC_DONOR_AUTOMATION_APPROVED!=='false')throw unavailable();
  const url=new URL(env.JUDGE_DATABASE_URL),origin=new URL(env.APP_ORIGIN);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.username||!url.password||url.searchParams.get('sslmode')==='disable')throw unavailable();
  if(!env.JUDGE_DATABASE_HOST||url.hostname.toLowerCase()!==env.JUDGE_DATABASE_HOST.toLowerCase()||fingerprint(normalizedDatabaseHost(url.hostname))===protectedMain.databaseHostHash)throw unavailable();
  if(origin.protocol!=='https:'||origin.origin!==env.APP_ORIGIN||origin.origin===protectedMain.origin)throw unavailable();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(env.JUDGE_ENVIRONMENT_ID||''))throw unavailable();
  const key=env.MFA_ENCRYPTION_KEY;if(!/^[A-Za-z0-9+/]{43}=$/.test(key||''))throw unavailable();
  const keyBytes=Buffer.from(key,'base64');if(keyBytes.length!==32||keyBytes.toString('base64')!==key||fingerprint(keyBytes)===protectedMain.mfaKeyHash)throw unavailable();
  if(env.VERCEL&&(!env.JUDGE_PROJECT_ID||env.VERCEL_PROJECT_ID!==env.JUDGE_PROJECT_ID||env.VERCEL_PROJECT_ID===protectedMain.projectId))throw unavailable();
  return {databaseUrl:url.href,environmentId:env.JUDGE_ENVIRONMENT_ID,mfaFingerprint:fingerprint(keyBytes),origin:origin.origin};
 }catch{throw unavailable();}
}
export async function assertJudgeDatabase(query,configuration){
 try{
  const rows=(await query('SELECT environment_id::text,mfa_key_sha256 FROM colorloop_judge_environment WHERE singleton')).rows;
  if(rows.length!==1||rows[0].environment_id!==configuration.environmentId||rows[0].mfa_key_sha256!==configuration.mfaFingerprint)throw unavailable();
 }catch{throw unavailable();}
}
export function guardJudgeDatabase(database,configuration){
 const transaction=work=>database.transaction(async query=>{
  let verified=false;
  return work(async(sql,params)=>{
   // The SQL store declares its read-only snapshot before its first SELECT.
   if(!verified&&sql==='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')return query(sql,params);
   if(!verified){await assertJudgeDatabase(query,configuration);verified=true;}
   return query(sql,params);
  });
 });
 return {query:(sql,params)=>transaction(q=>q(sql,params)),transaction,close:()=>database.close()};
}
