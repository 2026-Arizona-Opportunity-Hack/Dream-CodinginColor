import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildStatic,STATIC_FILES} from '../scripts/build-static.js';

async function files(root,prefix=''){
 const result=[];for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){const path=prefix?`${prefix}/${entry.name}`:entry.name;result.push(...(entry.isDirectory()?await files(root,path):[path]));}return result.sort();
}
test('the static output contains only browser assets and preserves every referenced asset path',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'colorloop-build-'));
 try{
  const output=join(temp,'dist');await mkdir(output);await writeFile(join(output,'stale-secret.env'),'synthetic stale output');
  await buildStatic(output);
  assert.deepEqual(await files(output),[...STATIC_FILES].sort());
  const html=await readFile(join(output,'index.html'),'utf8');
  assert.match(html,/src="\/public\/js\/app.js"/);assert.match(html,/href="\/public\/css\/app.css"/);
  for(const source of STATIC_FILES)assert.equal(await readFile(join(output,source),'utf8'),await readFile(new URL(`../${source}`,import.meta.url),'utf8'));
  assert.ok((await files(output)).every(name=>!name.startsWith('api/')&&!name.startsWith('lib/')&&!name.startsWith('db/')&&!name.includes('.env')));
 }finally{await rm(temp,{recursive:true,force:true});}
});
test('Vercel keeps API routing independent from the static allowlist and packages the import worker',async()=>{
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.equal(config.outputDirectory,'dist');assert.equal(config.framework,null);
 assert.equal(config.buildCommand,'npm run build');
 assert.deepEqual(config.rewrites,[{source:'/api/:route*',destination:'/api/router?route=:route'}]);assert.equal(config.routes,undefined);
 assert.equal(config.functions['api/**/*.js'].includeFiles,'lib/import-worker.js');
 assert.equal((await files(fileURLToPath(new URL('../api',import.meta.url)))).filter(path=>path.endsWith('.js')).length,5);
});
