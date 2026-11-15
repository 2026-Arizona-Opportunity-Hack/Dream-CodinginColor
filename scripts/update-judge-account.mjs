import {readFile,writeFile,lstat,rename,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Writable} from 'node:stream';
import {createInterface} from 'node:readline/promises';
import {Pool,neonConfig} from '@neondatabase/serverless';
import {createDatabase} from '../lib/db.js';
import {judgeDeploymentConfig} from '../lib/judge-deployment.js';
import {updateJudgeAccount,JUDGE_LOGIN_EMAIL} from '../lib/judge-account-update.js';
let database,terminal,committed=false,temp;
try{
 if(process.env.DOTENV_CONFIG_PATH!=='/dev/null'||process.argv.length!==6||process.argv[3]!=='--judge'||!process.argv.includes('--confirm-update')||!process.stdin.isTTY)throw new Error();
 const path=resolve(process.argv[2]),index=Number(process.argv[4])-1,info=await lstat(path);
 if(path.startsWith(resolve('.')+'/')||!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)||!Number.isInteger(index)||index<0)throw new Error();
 const original=await readFile(path,'utf8'),input=JSON.parse(original);
 const {DEPLOYMENT}=await import(pathToFileURL(resolve('node_modules/.cache/colorloop-judge-release/lib/deployment-mode.js')).href);
 if(!DEPLOYMENT.judge||!input.judges?.[index]||input.projectId===DEPLOYMENT.protectedMain.projectId)throw new Error();
 const configuration=judgeDeploymentConfig({COLORLOOP_ENVIRONMENT:'judge',JUDGE_DATABASE_URL:input.databaseUrl,JUDGE_DATABASE_HOST:input.databaseHost,JUDGE_ENVIRONMENT_ID:input.environmentId,MFA_ENCRYPTION_KEY:input.mfaEncryptionKey,APP_ORIGIN:input.appOrigin,EMAIL_DELIVERY_MODE:'disabled',EMAIL_CRON_ENABLED:'false',CIC_DONOR_AUTOMATION_APPROVED:'false'},DEPLOYMENT.protectedMain);
 // Readline owns raw terminal input; its output stream discards all echo.
 const muted=new Writable({write(_chunk,_encoding,done){done();}});
 terminal=createInterface({input:process.stdin,output:muted,terminal:true});
 process.stdout.write('New password (hidden): ');const password=await terminal.question('');
 process.stdout.write('\nConfirm password (hidden): ');const confirmation=await terminal.question('');process.stdout.write('\n');terminal.close();terminal=null;
 if(password!==confirmation)throw new Error();
 neonConfig.webSocketConstructor=globalThis.WebSocket;neonConfig.useSecureWebSocket=true;
 const url=new URL(configuration.databaseUrl);url.searchParams.set('sslmode','verify-full');database=createDatabase(new Pool({connectionString:url.href,max:1,connectionTimeoutMillis:10000}));
 await updateJudgeAccount(database,configuration,input,index,password);committed=true;
 if(await readFile(path,'utf8')!==original)throw new Error();
 input.judges[index]={...input.judges[index],email:JUDGE_LOGIN_EMAIL,password};
 temp=path+'.'+randomUUID();await writeFile(temp,JSON.stringify(input,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,path);temp=null;
 console.log('Judge account updated; its sessions were revoked and private entry synchronized. MFA and permissions were preserved.');
}catch{console.error(committed?'Database update committed, but private-file synchronization failed. Keep the password you entered and reconcile the selected private entry before retrying.':'Judge update refused or rolled back. Check confirmation, private file, dedicated identity, operator credentials, target role and password policy. No credentials are printed.');process.exitCode=1;}
finally{terminal?.close();if(temp)await unlink(temp).catch(()=>{});try{await database?.close();}catch{process.exitCode=1;}}
