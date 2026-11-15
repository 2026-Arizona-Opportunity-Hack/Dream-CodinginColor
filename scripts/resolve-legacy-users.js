import 'dotenv/config';
import {readFile} from 'node:fs/promises';
import {transaction,close} from '../lib/db.js';
import {unresolvedLegacyReferences,resolveLegacyReferences} from '../lib/legacy-user-references.js';
try{
 if(process.argv[2]==='--apply'){
  if(process.env.RESOLVE_LEGACY_USERS!=='true')throw new Error('Explicit opt-in required.');
  const mappings=JSON.parse(await readFile(process.argv[3],'utf8'));
  const result=await transaction(q=>resolveLegacyReferences(q,mappings,process.env.LEGACY_RESOLUTION_ACTOR_ID));
  console.log(JSON.stringify({appliedMappings:result.length,unresolved:await transaction(unresolvedLegacyReferences)}));
 }else{
  console.log(JSON.stringify({mode:'read-only',unresolved:await transaction(unresolvedLegacyReferences)}));
 }
}catch{console.error('Reconciliation failed. Check the migration state, administrator and reviewed mapping file privately. No identity is inferred.');process.exitCode=1;}
finally{await close();}
