// Validate actual Vercel CLI output, not a hand-written vercel.json routing model.
import assert from 'node:assert/strict';
import {readFile,readdir,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {workbook} from '../test-support/workbook.js';
const root=resolve(process.env.VERCEL_BUILD_OUTPUT||'.vercel/output');
const config=JSON.parse(await readFile(join(root,'config.json'),'utf8'));
const rewrite=config.routes.find(r=>r.dest?.startsWith('/api/router?route='));assert.ok(rewrite);
const paths=['auth/login','auth/logout','auth/me','donors','donors/50000000-0000-4000-8000-000000000001','donors/50000000-0000-4000-8000-000000000001/donations','donations','imports/preview','imports/confirm','campaigns','custom-fields','assignments/members','tasks/reminders','outreach/handoff','outreach/confirm-manual','roles/retire','outcomes','donations/50000000-0000-4000-8000-000000000001','assignments/balance','jobs/prepare'];
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
for(const path of ['index.html','public/js/app.js','public/js/api.js','public/js/imports.js','public/js/account-forms.js','public/css/app.css'])await access(join(root,'static',path));
const publicFiles=await walk(join(root,'static'));assert.ok(publicFiles.every(p=>p==='index.html'||p.startsWith('public/')));
assert.ok(publicFiles.every(p=>!/(?:^|\/)\.env|\.sql$|(?:^|\/)(?:lib|db|node_modules)\//.test(p)));
console.log(JSON.stringify({actualVercelBuild:true,functions:configs.length,rewrittenPathsVerified:paths.length,packagedXlsxWorkerExecuted:true,privateStaticAssets:false}));
