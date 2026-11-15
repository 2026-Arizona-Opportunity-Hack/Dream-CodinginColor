import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {judgeDeploymentConfig} from '../lib/judge-deployment.js';
try{
 if(process.env.DOTENV_CONFIG_PATH!=='/dev/null'||!process.argv.includes('--confirm-judge-project'))throw new Error();
 const path=process.argv[2];if(resolve(path).startsWith(resolve('.')+'/')||(await stat(path)).mode&0o077)throw new Error();
 const input=JSON.parse(await readFile(path)),release=resolve('node_modules/.cache/colorloop-judge-release');
 const link=JSON.parse(await readFile(resolve(release,'.vercel/project.json')));
 const {DEPLOYMENT}=await import(pathToFileURL(resolve(release,'lib/deployment-mode.js')).href);
 if(!DEPLOYMENT.judge||!input.projectId||link.projectId!==input.projectId||link.projectId===DEPLOYMENT.protectedMain.projectId)throw new Error();
 const values={COLORLOOP_ENVIRONMENT:'judge',JUDGE_DATABASE_URL:input.databaseUrl,JUDGE_DATABASE_HOST:input.databaseHost,JUDGE_ENVIRONMENT_ID:input.environmentId,MFA_ENCRYPTION_KEY:input.mfaEncryptionKey,APP_ORIGIN:input.appOrigin,JUDGE_PROJECT_ID:link.projectId,EMAIL_DELIVERY_MODE:'disabled',EMAIL_CRON_ENABLED:'false',CIC_DONOR_AUTOMATION_APPROVED:'false'};
 judgeDeploymentConfig(values,DEPLOYMENT.protectedMain);
 const env={...process.env,VERCEL_PROJECT_ID:link.projectId,VERCEL_ORG_ID:link.orgId};
 for(const [name,value]of Object.entries(values)){
  const result=spawnSync(process.env.VERCEL_CLI||'vercel',['env','add',name,'production','--sensitive','--force','--cwd',release],{input:value,env,stdio:['pipe','pipe','pipe']});
  if(result.status!==0)throw new Error();
  console.log(`Added ${name} to the linked Judge Demo project; value hidden.`);
 }
 console.log('Judge production variables configured. No deployment performed. Enable Vercel system environment variables for runtime project-ID verification.');
}catch{console.error('Judge environment setup refused or failed. Verify the dedicated project link, private file, CLI login and absent conflicting variables. No secret values or CLI diagnostics are printed.');process.exitCode=1;}
