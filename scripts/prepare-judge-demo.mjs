import {readFile,writeFile,mkdir,copyFile,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {parse} from 'dotenv';
import {fingerprint,normalizedDatabaseHost} from '../lib/judge-deployment.js';
import {STATIC_FILES} from './build-static.js';
async function prepare(){
const output=resolve('node_modules/.cache/colorloop-judge-release');
const main=parse(await readFile('.env'));
if(!main.DATABASE_URL||!main.MFA_ENCRYPTION_KEY)throw new Error('Protected main database and MFA metadata are required; values will not be printed.');
const protectedMain={databaseHostHash:fingerprint(normalizedDatabaseHost(new URL(main.DATABASE_URL).hostname)),mfaKeyHash:fingerprint(Buffer.from(main.MFA_ENCRYPTION_KEY,'base64')),origin:'https://colorloop-nu.vercel.app',projectId:JSON.parse(await readFile('.vercel/project.json')).projectId};
const files=[...new Set([...execFileSync('git',['ls-files','-z','api','lib'],{encoding:'utf8'}).split('\0').filter(p=>p.endsWith('.js')),...STATIC_FILES,'lib/deployment-mode.js','lib/judge-deployment.js','lib/judge-provision.js','lib/judge-diagnostics.js','package.json','package-lock.json','scripts/build-static.js','scripts/dev.js','docs/openapi-readonly.json'])];
await mkdir(output,{recursive:true});
try{const linked=JSON.parse(await readFile(resolve(output,'.vercel/project.json')));if(linked.projectId===protectedMain.projectId)throw new Error('Judge release must never link to the main Vercel project.');}catch(error){if(error.code!=='ENOENT')throw error;}
for(const file of files){const target=resolve(output,file);await mkdir(dirname(target),{recursive:true});await copyFile(file,target);}
await writeFile(resolve(output,'lib/deployment-mode.js'),`export const DEPLOYMENT = Object.freeze(${JSON.stringify({judge:true,protectedMain})});\n`);
await writeFile(resolve(output,'public/js/deployment-mode.js'),'export const JUDGE_DEMO = true;\n');
const config=JSON.parse(await readFile('vercel.json'));delete config.crons;await writeFile(resolve(output,'vercel.json'),JSON.stringify(config,null,2)+'\n');
await writeFile(resolve(output,'.vercelignore'),'.env*\n**/.env*\n**/*.csv\n**/*private*.json\n**/*credentials*.json\n');
console.log('Prepared judge-only release in node_modules/.cache/colorloop-judge-release. No cloud resources or deployments created.');
const privatePath=process.argv[2];
if(privatePath){
 try{await stat(privatePath);throw new Error('Refusing to overwrite an existing private configuration.');}catch(error){if(error.code!=='ENOENT')throw error;}
 if(resolve(privatePath).startsWith(resolve('.')+'/'))throw new Error('Private credentials must be outside the repository.');
 const account=name=>({name,email:`judge-${randomBytes(8).toString('hex')}@colorloop.invalid`,password:'Aa1!'+randomBytes(24).toString('base64url')});
 const privateConfig={environmentId:randomUUID(),mfaEncryptionKey:randomBytes(32).toString('base64'),databaseUrl:'',databaseHost:'',appOrigin:'',projectId:'',operator:account('Private demo operator'),judges:Array.from({length:3},(_,i)=>account(`Judge ${i+1}`)),boards:Array.from({length:3},(_,i)=>account(`Synthetic Board ${i+1}`))};
 await writeFile(privatePath,JSON.stringify(privateConfig,null,2)+'\n',{mode:0o600,flag:'wx'});console.log('Private configuration created with unique credentials and MFA key. Fill its blank database/project fields privately; do not upload it.');
}
}
try{await prepare();}catch{console.error('Judge release preparation failed. Check protected main metadata, output linking and a new private-file path outside the repository. No credentials are printed.');process.exitCode=1;}
