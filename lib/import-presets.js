import {allowlist,ensure,text,uuid,page} from './data-validation.js';
import {insert,update} from './donor-data.js';
import {IMPORT_FIELDS} from './import-parser.js';
export const BUILTIN_PRESETS=[
 {id:'generic',name:'Generic spreadsheet: review detected columns',source:'generic',mapping:{}},
 {id:'zeffy',name:'Zeffy: supplied sample headings',source:'zeffy',mapping:{first_name:'First name',last_name:'Last name',email:'Email',secondary_email:'Secondary email',amount:'Amount',donation_date:'First payment date (America/Phoenix)'}},
 {id:'benevity',name:'Benevity: configure your export columns',source:'benevity',mapping:{}},
];
export async function listPresets(query,params={}){const [limit,offset]=page(params);return (await query('SELECT id,name,source,mapping FROM import_presets ORDER BY source,name,id LIMIT $1 OFFSET $2',[limit,offset])).rows;}
export async function savePreset(query,input,actor){
 allowlist(input,['id','name','source','mapping']);ensure(['generic','zeffy','benevity'].includes(input.source),'Choose a supported preset source.');
 const mapping=allowlist(input.mapping,[...IMPORT_FIELDS,...Object.keys(input.mapping||{}).filter(k=>/^custom:[a-z][a-z0-9_]{0,63}$/.test(k)&&!['__proto__','constructor','prototype'].includes(k.slice(7)))]);
 ensure(Object.keys(mapping).length<=100,'Too many mapped fields.');for(const value of Object.values(mapping))text(value,100,true);
 const data={name:text(input.name,200,true),source:input.source,mapping:JSON.stringify(mapping),updated_by:actor.id};
 await query('SELECT pg_advisory_xact_lock(78234902)');
 if(input.id){const existing=(await query('SELECT id FROM import_presets WHERE id=$1',[uuid(input.id)])).rows[0];ensure(existing,'Preset not found.','NOT_FOUND',404);return update(query,'import_presets',input.id,data);}
 return insert(query,'import_presets',{...data,created_by:actor.id});
}
