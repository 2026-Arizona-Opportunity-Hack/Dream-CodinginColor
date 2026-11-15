import {STATIC_FILES} from './build-static.js';
// Validate actual Vercel CLI output, not a hand-written vercel.json routing model.
import assert from 'node:assert/strict';
import {readFile,readdir,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {workbook} from '../test-support/workbook.js';
import {randomBytes} from 'node:crypto';
const root=resolve(process.env.VERCEL_BUILD_OUTPUT||'.vercel/output');
const config=JSON.parse(await readFile(join(root,'config.json'),'utf8'));
const rewrite=config.routes.find(r=>r.dest?.startsWith('/api/router?route='));assert.ok(rewrite);
const paths=['email/settings','email/run','v1/openapi','v1/follow-ups','v1/campaign-summaries','v1/overview','imports/history','imports/50000000-0000-4000-8000-000000000001','merges/preview','donors/50000000-0000-4000-8000-000000000001/aliases','auth/login','auth/logout','auth/me','auth/signup','auth/mfa/enroll','auth/mfa/confirm','auth/mfa/verify','account/profile','account/security','account/password','account/preferences','account/mfa/recovery','account/mfa/reset','account/mfa/admin-reset','account-requests','imports/presets','donors','donors/50000000-0000-4000-8000-000000000001','donors/50000000-0000-4000-8000-000000000001/donations','donations','imports/preview','imports/confirm','campaigns','custom-fields','assignments/members','tasks/reminders','outreach/handoff','outreach/confirm-manual','roles/retire','outcomes','donations/50000000-0000-4000-8000-000000000001','assignments/balance','jobs/prepare'];
for(const path of paths){const match=new RegExp(rewrite.src).exec(`/api/${path}`);assert.ok(match,path);const dest=rewrite.dest.replace(/\$(\d+)/g,(_,n)=>match[+n]||'');assert.equal(new URL(dest,'https://synthetic.invalid').searchParams.get('route'),path);}
async function walk(directory,prefix=''){
 const result=[];for(const entry of await readdir(join(directory,prefix),{withFileTypes:true})){const path=prefix?`${prefix}/${entry.name}`:entry.name;if(entry.isDirectory())result.push(...await walk(directory,path));else result.push(path);}return result;
}
const configs=(await walk(join(root,'functions'))).filter(p=>p.endsWith('.vc-config.json'));
assert.equal(configs.length,5);assert.ok(configs.length<=12);
for(const path of configs){const settings=JSON.parse(await readFile(join(root,'functions',path),'utf8'));assert.equal(settings.runtime,'nodejs22.x');}
await access(join(root,'functions/api/router.func/lib/import-worker.js'));
const {parseImport}=await import(pathToFileURL(join(root,'functions/api/router.func/lib/import-parser.js')).href);
const parsed=await parseImport({filename:'synthetic.xlsx',source:'synthetic-build',content_base64:workbook([['First name','Last name','Amount','First payment date (America/Phoenix)'],['Synthetic','Packaged','25','10/19/2026, 8:23 PM']]).toString('base64')});
assert.deepEqual(parsed.rows[0].errors,[]);assert.equal(parsed.rows[0].data.donation.donation_date,'2026-10-19');
// Execute the packaged security dependencies without any database or secret output.
process.env.MFA_ENCRYPTION_KEY=randomBytes(32).toString('base64');
const {enrollment,decryptTotp,authenticator}=await import(pathToFileURL(join(root,'functions/api/router.func/lib/totp.js')).href);
const user={id:'synthetic-packaged-user',email:'packaged@example.test'},setup=await enrollment(user,new Date());
assert.ok(setup.qr.startsWith('data:image/png;base64,'));
assert.match(authenticator(decryptTotp(setup.ciphertext,user.id),user.email).generate(),/^\d{6}$/);
for(const path of STATIC_FILES)assert.equal(await readFile(join(root,'static',path),'utf8'),await readFile(new URL('../'+path,import.meta.url),'utf8'),`Packaged browser asset is current: ${path}`);
const {createRouter}=await import(pathToFileURL(join(root,'functions/api/router.func/lib/api-router.js')).href);
const router=createRouter();for(const [path,status] of [['v1/openapi',200],['v1/follow-ups',401],['email/settings',401],['email/run',405]]){const res={setHeader(){},status(n){this.statusCode=n;return this;},json(v){this.body=v;this.headersSent=true;return this;}};await router({method:'GET',query:{route:path},headers:{}},res);assert.equal(res.statusCode,status);if(status===200)assert.equal(res.body.openapi,'3.1.1');}
const publicFiles=await walk(join(root,'static'));assert.ok(publicFiles.every(p=>p==='index.html'||p.startsWith('public/')));
assert.ok(publicFiles.every(p=>!/(?:^|\/)\.env|\.sql$|(?:^|\/)(?:lib|db|node_modules)\//.test(p)));
console.log(JSON.stringify({actualVercelBuild:true,functions:configs.length,rewrittenPathsVerified:paths.length,packagedXlsxWorkerExecuted:true,packagedTotpAndQrExecuted:true,packagedOpenApiExecuted:true,packagedEmailGuardsExecuted:true,privateStaticAssets:false}));
