// Minimal local runner; production functions run on Vercel.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import 'dotenv/config';
const root=process.cwd();
const routes=new Map([
 ['/api/reports/retention','../api/reports/retention.js'],
 ['/api/reports/funder','../api/reports/funder.js'],
 ['/api/v1/metrics','../api/v1/metrics.js']
]);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
createServer(async(req,res)=>{
 res.status=code=>{res.statusCode=code;return res;};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
 try {
  const url=new URL(req.url,'http://localhost');req.query=Object.fromEntries(url.searchParams);
  if(routes.has(url.pathname)){const {default:handler}=await import(routes.get(url.pathname));return await handler(req,res);}
  if(url.pathname.startsWith('/api/'))return res.status(503).json({error:{code:'BACKEND_NOT_CONNECTED',message:'This teammate-owned endpoint is not connected in the local runner. Integrate the shared backend and use Vercel for complete workflows.'}});
  if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');res.statusCode=405;return res.end();}
  if(url.pathname!=='/'&&!url.pathname.startsWith('/public/')){res.statusCode=404;return res.end('Not found');}
  const path=resolve(root,`.${decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname)}`);
  if(path!==resolve(root,'index.html')&&!path.startsWith(resolve(root,'public')+'/')){res.statusCode=404;return res.end('Not found');}
  const body=await readFile(path);res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(req.method==='HEAD'?undefined:body);
 }catch{if(!res.writableEnded)res.status(500).json({error:{code:'LOCAL_SERVER_ERROR',message:'The local request could not be completed.'}});}
}).listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log(`ColorLoop local preview: http://127.0.0.1:${process.env.PORT||3000}`));
