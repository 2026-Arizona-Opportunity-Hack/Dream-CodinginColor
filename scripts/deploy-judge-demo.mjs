import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {judgeDeploymentConfig} from '../lib/judge-deployment.js';
try{
 if(process.env.DOTENV_CONFIG_PATH!=='/dev/null')throw new Error();
 const checkOnly=process.argv.includes('--check-only');if(!checkOnly&&!process.argv.includes('--confirm-deploy-judge-only'))throw new Error();
 const path=process.argv[2];if(resolve(path).startsWith(resolve('.')+'/')||(await stat(path)).mode&0o077)throw new Error();
 const input=JSON.parse(await readFile(path)),release=resolve('node_modules/.cache/colorloop-judge-release');
 const link=JSON.parse(await readFile(resolve(release,'.vercel/project.json'))),{DEPLOYMENT}=await import(pathToFileURL(resolve(release,'lib/deployment-mode.js')).href);
 if(!DEPLOYMENT.judge||link.projectId!==input.projectId||link.projectId===DEPLOYMENT.protectedMain.projectId)throw new Error();
 judgeDeploymentConfig({COLORLOOP_ENVIRONMENT:'judge',JUDGE_DATABASE_URL:input.databaseUrl,JUDGE_DATABASE_HOST:input.databaseHost,JUDGE_ENVIRONMENT_ID:input.environmentId,MFA_ENCRYPTION_KEY:input.mfaEncryptionKey,APP_ORIGIN:input.appOrigin,EMAIL_DELIVERY_MODE:'disabled',EMAIL_CRON_ENABLED:'false',CIC_DONOR_AUTOMATION_APPROVED:'false'},DEPLOYMENT.protectedMain);
 if(checkOnly)console.log('Judge release/project/configuration checks passed. No deployment performed.');
 else{
  const env={...process.env,VERCEL_PROJECT_ID:link.projectId,VERCEL_ORG_ID:link.orgId};
  const result=spawnSync(process.env.VERCEL_CLI||'vercel',['deploy','--prod','--cwd',release],{env,stdio:'inherit'});if(result.status!==0)throw new Error();
 }
}catch{console.error('Judge deployment refused or failed. Verify the dedicated release link, private configuration and explicit judge-only approval. No credentials are printed.');process.exitCode=1;}
