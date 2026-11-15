// All APIs share one origin and store; production remains Vercel/Neon.
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import 'dotenv/config';
import { contextKey } from '../lib/permissions.js';
import { createHandler } from '../lib/retention-api.js';
import { handlerFor } from '../lib/donor-routes.js';

export async function startServer({ database, store, port=Number(process.env.PORT||3000), tls, origin,
  staticRoot=fileURLToPath(new URL('../',import.meta.url)) }={}) {
  const root=resolve(staticRoot);
  const scheme=tls?'https':'http';origin??=process.env.APP_ORIGIN||`${scheme}://localhost:${port}`;
  const dataRoutes=new Map([['/api/donors','donors'],['/api/donations','donations'],['/api/imports/preview','preview'],['/api/imports/confirm','confirm'],['/api/merges/candidates','candidates'],['/api/merges','merges'],['/api/custom-fields','fields'],['/api/campaigns','campaigns']]);
  const workflow=new Set(['auth/login','auth/logout','auth/me','users','roles','assignments','assignments/members','activities','tasks','tasks/reminders','outreach/templates','outreach/drafts','outreach/approve','outreach/send','outreach/history','retention/at-risk','retention/settings']);
  const sql=database?async(strings,...params)=>{
    const statement=strings.reduce((value,part,i)=>value+(i?`$${i}`:'')+part,'');return (await database.query(statement,params)).rows;
  }:undefined;
  const listener=async(req,res)=>{
    res.status=code=>{res.statusCode=code;return res;};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    try {
      const url=new URL(req.url,origin);req.query=Object.fromEntries(url.searchParams);
      if(url.pathname.startsWith('/api/')) {
        if(['POST','PATCH'].includes(req.method)) {
          let size=0;const chunks=[];
          for await(const chunk of req){size+=chunk.length;if(size>1500000)return res.status(413).json({error:{code:'REQUEST_TOO_LARGE',message:'Request exceeds 1.5 MB.'}});chunks.push(chunk);}
          req.body=Buffer.concat(chunks).toString()||'{}';
        }
        req[contextKey]={store,origin,sql};
        const name=url.pathname.slice(5);
        if(workflow.has(name))return createHandler(name,{store,origin})(req,res);
        let route=dataRoutes.get(url.pathname);
        const donor=/^\/api\/donors\/([^/]+)(\/donations)?$/.exec(url.pathname);
        if(donor){req.query.id=decodeURIComponent(donor[1]);route=donor[2]?'history':'donor';}
        const config=/^\/api\/(custom-fields|campaigns)\/([^/]+)$/.exec(url.pathname);
        if(config){req.query.id=decodeURIComponent(config[2]);route=config[1]==='campaigns'?'campaign':'field';}
        if(route)return handlerFor(route,database?{db:database}:undefined)(req,res);
        if(['reports/retention','reports/funder','v1/metrics','health'].includes(name)) {
          const module=await import(`../api/${name}.js`);return module.default(req,res);
        }
        return res.status(404).json({error:{code:'NOT_FOUND',message:'Endpoint not found.'}});
      }
      if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return res.status(405).end();}
      const decoded=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
      const target=resolve(root,`.${decoded}`);
      if(target!==resolve(root,'index.html')&&!target.startsWith(resolve(root,'public')+'/'))return res.status(404).end();
      let content;try{content=await readFile(target);}catch{return res.status(404).end('Not found');}
      res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'})[extname(target)]||'application/octet-stream');
      res.end(req.method==='HEAD'?undefined:content);
    }catch{if(!res.writableEnded)res.status(500).json({error:{code:'LOCAL_SERVER_ERROR',message:'The local request could not be completed.'}});}
  };
  const server=tls?httpsServer(tls,listener):httpServer(listener);
  await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',accept);});
  if (origin.endsWith(':0')) origin=origin.slice(0,-1)+server.address().port;
  return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let database,store;
  if(process.env.COLORLOOP_DEMO==='true'){
    const {createIsolatedDatabase}=await import('../lib/isolated-database.js');
    const {migrate}=await import('../lib/database-setup.js');
    const {initializeSyntheticDemo}=await import('../lib/demo-data.js');
    database=await createIsolatedDatabase();await database.transaction(migrate);
    store=await initializeSyntheticDemo(database,process.env.DEMO_PASSWORD);
  }
  const tls=process.env.LOCAL_TLS_KEY&&process.env.LOCAL_TLS_CERT?{key:await readFile(process.env.LOCAL_TLS_KEY),cert:await readFile(process.env.LOCAL_TLS_CERT)}:undefined;
  const server=await startServer({database,store,tls});
  console.log(`ColorLoop local preview: ${tls?'https':'http'}://localhost:${server.address().port}`);
  if(!tls)console.log('Use local HTTPS certificates to sign in with Secure cookies.');
}
