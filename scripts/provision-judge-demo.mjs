import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool,neonConfig} from '@neondatabase/serverless';
import {createDatabase} from '../lib/db.js';
import {judgeDeploymentConfig} from '../lib/judge-deployment.js';
import {provisionJudgeDatabase} from '../lib/judge-provision.js';
import {provisioningDiagnostic} from '../lib/judge-diagnostics.js';
let database,stage='cli.confirmation';
try{
 if(process.env.DOTENV_CONFIG_PATH!=='/dev/null'||!process.argv.includes('--confirm-new-empty-database'))throw new Error();
 stage='cli.private-file';const privatePath=process.argv[2];if(resolve(privatePath).startsWith(resolve('.')+'/')||(await stat(privatePath)).mode&0o077)throw new Error();
 const input=JSON.parse(await readFile(privatePath));
 stage='cli.release-metadata';const {DEPLOYMENT}=await import(pathToFileURL(resolve('node_modules/.cache/colorloop-judge-release/lib/deployment-mode.js')).href);
 const env={COLORLOOP_ENVIRONMENT:'judge',JUDGE_DATABASE_URL:input.databaseUrl,JUDGE_DATABASE_HOST:input.databaseHost,JUDGE_ENVIRONMENT_ID:input.environmentId,MFA_ENCRYPTION_KEY:input.mfaEncryptionKey,APP_ORIGIN:input.appOrigin,EMAIL_DELIVERY_MODE:'disabled',EMAIL_CRON_ENABLED:'false',CIC_DONOR_AUTOMATION_APPROVED:'false'};
 stage='cli.configuration';const configuration=judgeDeploymentConfig(env,DEPLOYMENT.protectedMain);
 neonConfig.webSocketConstructor=globalThis.WebSocket;neonConfig.useSecureWebSocket=true;
 const url=new URL(configuration.databaseUrl);url.searchParams.set('sslmode','verify-full');
 stage='database.connection';database=createDatabase(new Pool({connectionString:url.href,max:1,connectionTimeoutMillis:10000}));
 const result=await provisionJudgeDatabase(database,configuration,{operator:input.operator,judges:input.judges,boards:input.boards});
 console.log(`Dedicated Judge Demo provisioned: ${result.donors} fictional donors, ${result.gifts} gifts, ${result.campaigns} campaigns. MFA enrollment is required. Credentials remain in the private file.`);
}catch(error){console.error(JSON.stringify(error.provisionDiagnostic||provisioningDiagnostic(error,stage)));process.exitCode=1;}
finally{try{await database?.close();}catch(error){console.error(JSON.stringify(provisioningDiagnostic(error,'database.close')));process.exitCode=1;}}
