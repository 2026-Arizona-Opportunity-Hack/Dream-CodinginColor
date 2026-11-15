import {readOnlyHandler,readRoutes} from './read-only-api.js';
import readOnlySpec from '../docs/openapi-readonly.json' with {type:'json'};
import {createHandler} from './retention-api.js';
import {handlerFor} from './donor-routes.js';
import {preparationJob} from './preparation-job.js';
import {contextKey} from './permissions.js';
import retention from '../api/reports/retention.js';
import funder from '../api/reports/funder.js';
import metrics from '../api/v1/metrics.js';
import health from '../api/health.js';
const data=new Map([['donors','donors'],['donations','donations'],['imports/presets','presets'],['imports/preview','preview'],['imports/confirm','confirm'],['merges/preview','mergePreview'],['merges/candidates','candidates'],['merges','merges'],['custom-fields','fields'],['campaigns','campaigns'],['outcomes','outcomes']]);
const workflow=new Set(['email/settings','email/run','auth/login','auth/logout','auth/me','auth/signup','auth/mfa/enroll','auth/mfa/confirm','auth/mfa/verify','account/profile','account/security','account/preferences','account/password','account/mfa/recovery','account/mfa/reset','account/mfa/admin-reset','account-requests','users','roles','roles/retire','assignments','assignments/balance','assignments/members','activities','tasks','tasks/reminders','outreach/templates','outreach/drafts','outreach/approve','outreach/send','outreach/handoff','outreach/confirm-manual','outreach/history','retention/at-risk','retention/settings']);
const special=new Map([['reports/retention',retention],['reports/funder',funder],['v1/metrics',metrics],['health',health]]);
export function createRouter({database,store,origin,now}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  let path=req.query?.route;
  if(Array.isArray(path)||typeof path!=='string'||!path||path.includes('..')||!/^[-a-zA-Z0-9_/]+$/.test(path))return res.status(404).json({error:{code:'NOT_FOUND',message:'Endpoint not found.'}});
  path=path.replace(/\/$/,'');
  const sql=database?async(strings,...params)=>(await database.query(strings.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),params)).rows:undefined;
  req[contextKey]={...req[contextKey],...(store?{store}:{}),...(origin?{origin}:{}),...(sql?{sql}:{}),...(now?{now}:{})};
  req.query={...req.query};delete req.query.route;
  if(path==='v1/openapi'){if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:{code:'METHOD_NOT_ALLOWED',message:'Use GET.'}});}return res.status(200).json(readOnlySpec);}
  if(Object.hasOwn(readRoutes,path))return readOnlyHandler(path,database?{db:database}:undefined)(req,res);
  const batch=/^imports\/([0-9a-f-]{36})$/i.exec(path);if(batch){req.query.id=batch[1];return readOnlyHandler('import-detail',database?{db:database}:undefined)(req,res);}
  if(path==='jobs/prepare')return preparationJob(req,res,{store});
  if(workflow.has(path)||path==='email/test-reminder')return createHandler(path,{store,origin:origin||req[contextKey]?.origin,now})(req,res);
  if(special.has(path))return special.get(path)(req,res);
  let route=data.get(path);
  const alias=/^donors\/([^/]+)\/aliases$/.exec(path);if(alias){req.query.id=alias[1];route='aliases';}
  const donor=/^donors\/([^/]+)(\/donations)?$/.exec(path);
  if(donor){req.query.id=donor[1];route=donor[2]?'history':'donor';}
  const config=/^(custom-fields|campaigns|donations)\/([^/]+)$/.exec(path);
  if(config){req.query.id=config[2];route=({'custom-fields':'field',campaigns:'campaign',donations:'donation'})[config[1]];}
  if(route)return handlerFor(route,database?{db:database}:undefined)(req,res);
  return res.status(404).json({error:{code:'NOT_FOUND',message:'Endpoint not found.'}});
 };
}
