import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,randomBytes} from 'node:crypto';
import {STATIC_FILES} from './build-static.js';
import {workbook} from '../test-support/workbook.js';
const root=resolve(process.env.VERCEL_BUILD_OUTPUT||'node_modules/.cache/colorloop-judge-build-verification/.vercel/output');
async function walk(directory,prefix=''){const result=[];for(const e of await readdir(join(directory,prefix),{withFileTypes:true})){const p=prefix?prefix+'/'+e.name:e.name;result.push(...(e.isDirectory()?await walk(directory,p):[p]));}return result;}
const functions=await walk(join(root,'functions'));assert.equal(functions.filter(p=>p.endsWith('.vc-config.json')).length,5);assert.ok(functions.every(p=>!/(?:^|\/)\.env/.test(p)));
for(const p of functions.filter(p=>p.endsWith('.vc-config.json')))assert.equal(JSON.parse(await readFile(join(root,'functions',p))).runtime,'nodejs22.x');
for(const p of STATIC_FILES){const bytes=await readFile(join(root,'static',p),'utf8');if(p==='public/js/deployment-mode.js')assert.match(bytes,/JUDGE_DEMO = true/);else assert.equal(bytes,await readFile(p,'utf8'));}
const mode=await import(pathToFileURL(join(root,'functions/api/router.func/lib/deployment-mode.js')).href);assert.equal(mode.DEPLOYMENT.judge,true);
const {parseImport}=await import(pathToFileURL(join(root,'functions/api/router.func/lib/import-parser.js')).href);
const xlsx=await parseImport({filename:'synthetic-judge.xlsx',source:'judge-package-test',content_base64:workbook([['Name','Amount','Date','Currency','Status'],['Synthetic Packaged Donor','10','2026-11-01','USD','completed']]).toString('base64')});assert.deepEqual(xlsx.rows[0].errors,[]);
const {createRouter}=await import(pathToFileURL(join(root,'functions/api/router.func/lib/api-router.js')).href),router=createRouter();
const call=async path=>{const res={setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};await router({method:'GET',query:{route:path},headers:{}},res);return res;};
delete process.env.COLORLOOP_ENVIRONMENT;process.env.DATABASE_URL='postgresql://synthetic:synthetic-password@protected.invalid/neondb';
assert.equal((await call('health')).statusCode,503,'Immutable judge bundle must not fall back to main mode or DATABASE_URL');
delete process.env.DATABASE_URL;
Object.assign(process.env,{COLORLOOP_ENVIRONMENT:'judge',JUDGE_DATABASE_URL:'postgresql://synthetic:synthetic-password@judge.invalid/neondb',JUDGE_DATABASE_HOST:'judge.invalid',JUDGE_ENVIRONMENT_ID:randomUUID(),MFA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),APP_ORIGIN:'https://judge.synthetic.test',EMAIL_DELIVERY_MODE:'disabled',EMAIL_CRON_ENABLED:'false',CIC_DONOR_AUTOMATION_APPROVED:'false',JUDGE_PROJECT_ID:'prj_synthetic_judge',VERCEL_PROJECT_ID:'prj_synthetic_judge'});
for(const [path,status]of [['health',200],['v1/openapi',200],['donors',401],['jobs/prepare',403]])assert.equal((await call(path)).statusCode,status,path);
const {createEmailProvider}=await import(pathToFileURL(join(root,'functions/api/router.func/lib/email-provider.js')).href);assert.throws(()=>createEmailProvider({env:{EMAIL_DELIVERY_MODE:'live'}}),{code:'JUDGE_EMAIL_DISABLED'});
const sourceConfig=JSON.parse(await readFile('node_modules/.cache/colorloop-judge-release/vercel.json'));assert.equal(sourceConfig.crons,undefined);
console.log(JSON.stringify({result:'PASS',functions:5,node:'22.x',staticAssets:STATIC_FILES.length,packagedXlsxExecuted:true,immutableJudgeMode:true,missingConfigurationFailsClosed:true,noMainDatabaseFallback:true,mandatoryAuthentication:true,cronDisabled:true,emailHardBlocked:true,privateEnvironmentFilesBundled:false}));
