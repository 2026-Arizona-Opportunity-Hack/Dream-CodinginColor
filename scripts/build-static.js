import {readFile,writeFile,mkdir,lstat,realpath,rm} from 'node:fs/promises';
import {dirname,resolve,relative,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export const STATIC_FILES=Object.freeze(['index.html','public/css/app.css','public/js/app.js','public/js/api.js','public/js/account-forms.js','public/js/imports.js','public/js/auth-ui.js','public/js/ui.js','public/js/import-review.js','public/js/donor-view.js','public/js/donor-workflows.js','public/js/donor-profile.js','public/js/mentor-screens.js','public/js/duplicate-review.js','public/js/outreach-ui.js','public/js/followups-ui.js','public/js/mentor-data.js']);
const credentialPattern=/(?:^|[^A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})|-----BEGIN [A-Z ]*PRIVATE KEY-----/m;
export async function buildStatic(output=resolve(root,'dist')) {
 output=resolve(output);
 if(basename(output)!=='dist'||output===resolve(root))throw new Error('Build output must be a dedicated dist directory.');
 const content=new Map();
 for(const name of STATIC_FILES){
  const source=resolve(root,name),stat=await lstat(source),canonical=await realpath(source);
  if(!stat.isFile()||stat.isSymbolicLink()||canonical!==source)throw new Error(`Static source must be an ordinary repository file: ${name}`);
  const text=await readFile(source,'utf8');
  if(credentialPattern.test(text)||/\b(?:DATABASE_URL|ADMIN_PASSWORD)\b|from\s*['"]node:/.test(text))throw new Error(`Server material detected in static source: ${name}`);
  content.set(name,text);
 }
 for(const [name,text] of content){
  for(const match of text.matchAll(/(?:src|href)=["'](\/public\/[^"']+)["']|\bfrom\s*["'](\.[^"']+)["']/g)){
   const target=match[1]?.slice(1)||relative(root,resolve(root,dirname(name),match[2]));
   if(!content.has(target))throw new Error(`Static reference is outside the build allowlist: ${target}`);
  }
 }
 try{if((await lstat(output)).isSymbolicLink())throw new Error('Build output cannot be a symlink.');}catch(error){if(error.code!=='ENOENT')throw error;}
 // Only the explicitly designated generated output is replaced.
 await rm(output,{recursive:true,force:true});
 for(const [name,text] of content){const target=resolve(output,name);await mkdir(dirname(target),{recursive:true});await writeFile(target,text);}
 return {output,files:[...content.keys()]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const result=await buildStatic();console.log(`Static build: ${result.files.length} allowlisted files in ${result.output}`);
}
