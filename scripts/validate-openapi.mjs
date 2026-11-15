// Full standards validation with existing temporary tools; no app dependency added.
import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';import assert from 'node:assert/strict';
const schemaPath=process.env.OPENAPI_SCHEMA_PATH,validator=process.env.AJV_MODULE_PATH;
assert.ok(schemaPath&&validator,'Set OPENAPI_SCHEMA_PATH to the official OAS 3.1 schema and AJV_MODULE_PATH to installed ajv/dist/2020.js.');
const {default:Ajv}=await import(pathToFileURL(resolve(validator)).href);
const schema=JSON.parse(await readFile(schemaPath,'utf8')),spec=JSON.parse(await readFile(new URL('../docs/openapi-readonly.json',import.meta.url),'utf8'));
// This standalone official schema has one nested #meta anchor whose rule is
// exactly object-or-boolean. Resolve that local reference statically for Ajv's
// nested-dynamic-anchor limitation; preserve the rule and validate Schema Objects
// separately against draft 2020-12. No OAS profile/anchor overrides are accepted.
let anchors=0;
const compatible=value=>{
 if(Array.isArray(value))return value.map(compatible);if(!value||typeof value!=='object')return value;
 const next=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,compatible(v)]));
 if(next.$dynamicAnchor){assert.equal(next.$dynamicAnchor,'meta');anchors++;delete next.$dynamicAnchor;}
 if(next.$dynamicRef){assert.equal(next.$dynamicRef,'#meta');delete next.$dynamicRef;next.$ref='#/$defs/schema';}
 return next;
};
assert.deepEqual(schema.$defs.schema.type,['object','boolean']);
const resolved=compatible(schema);assert.equal(anchors,1);
const ajv=new Ajv({strict:false,allErrors:true,validateFormats:false}),validate=ajv.compile(resolved);
assert.ok(validate(spec),JSON.stringify(validate.errors?.slice(0,8)));
let schemas=0;
const walk=value=>{if(!value||typeof value!=='object')return;
 if(value.schema){assert.ok(ajv.validateSchema(value.schema),JSON.stringify(ajv.errors?.slice(0,4)));schemas++;}
 for(const child of Object.values(value))walk(child);
};walk(spec);
for(const entry of Object.values(spec.components.schemas)){assert.ok(ajv.validateSchema(entry),JSON.stringify(ajv.errors?.slice(0,4)));schemas++;}
const bad=structuredClone(spec);bad.paths['/donors'].get.parameters[0].in='invalid-location';assert.equal(validate(bad),false);assert.equal(ajv.validateSchema({type:'invalid-type'}),false);
console.log(JSON.stringify({openapi:spec.openapi,officialSchema:schema.$id,paths:Object.keys(spec.paths).length,checkedSchemaObjects:schemas,localMetaReferenceCompatibility:true,negativeChecksPassed:true,valid:true}));
