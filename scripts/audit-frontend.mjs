import {STATIC_FILES} from './build-static.js';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
// Run with Node 22+ and a local Chrome install. Fixtures are synthetic and audit-only.
const root=fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/,'');
const output=join(tmpdir(),'colorloop-visual-audit');await mkdir(output,{recursive:true});
const year=new Date().getUTCFullYear();
const donor={id:'audit-donor',name:'Audit Community Foundation',email:'audit@example.invalid',board_member_name:'Audit Board Member',total_donated:1250};
const report={from:`${year}-01-01`,to:`${year}-11-14`,previousFrom:`${year-1}-01-01`,previousTo:`${year-1}-11-14`,giftTotal:1250,donorTotal:3,returning:2,lapsed:1,new:1,reactivated:1,retentionRate:2/3,churnRate:1/3,increased:1,decreased:1,unchanged:0,monthly:[{month:`${year}-01`,total:300},{month:`${year}-02`,total:950}],byProgram:[{name:'Community digital education',total:1250}],byBoardMember:[{name:'Audit Board Member',total:1250}]};
const task={id:'audit-task',title:'Thank the community foundation',due_date:`${year}-01-01`,assignee_name:'Audit Board Member',status:'open'};
const fixtures={'/api/auth/me':{name:'Audit user'},'/api/reports/retention':report,'/api/donors':[donor],'/api/tasks':[task],'/api/board-members':[{id:'audit-member',name:'Audit Board Member',role:'admin'}],'/api/outreach/drafts':[{id:'audit-draft',subject:'Thank you for supporting digital skills',body:'Synthetic audit draft only.',status:'approved'}],'/api/retention/at-risk':[{name:donor.name,last_gift_date:`${year-1}-01-01`,next_action:'Arrange a conversation'}],'/api/outreach/history':[{subject:'Thank you',sent_at:`${year}-01-02`,status:'sent'}],'/api/custom-fields':[{id:'audit-field',label:'Community connection',type:'text',active:true}],'/api/campaigns':[{id:'audit-campaign',name:'Digital learning',archived:false}],'/api/roles':[{name:'admin',permissions:['reports:read','reports:funder']}],'/api/settings/outreach':{follow_up_days:30,thank_you_template:'Thank you.',follow_up_template:'Let’s connect.'}};
// Canonical backend DTOs: the browser adapter, not fixtures, produces screen models.
fixtures['/api/auth/me']={user:{id:'audit-user',name:'Audit user',email:'audit@example.test',roleId:'administrator',roleName:'Administrator',active:true,totpEnabled:true,preferences:{},administrator:true,permissions:['donors.read','donors.write','donations.write','imports.manage','assignments.manage','activities.write','tasks.manage','outreach.write','outreach.approve','outreach.send','reports.read','settings.manage','users.manage','roles.manage']},authentication:'authenticated',csrfToken:'synthetic-audit-csrf'};
fixtures['/api/account/profile']=fixtures['/api/auth/me'].user;
fixtures['/api/donors']=[{id:donor.id,display_name:donor.name,normalized_email:donor.email,board_member_name:donor.board_member_name,verified_usd_total:'1250.00'}];
fixtures['/api/tasks']=[{id:task.id,donorId:donor.id,nextAction:task.title,dueAt:`${year}-01-01T00:00:00Z`,assigneeId:'audit-member',status:'open'}];
fixtures['/api/assignments/members']=[{id:'audit-member',name:'Audit Board Member',roleId:'administrator',active:true}];
fixtures['/api/outreach/drafts']=[{id:'audit-draft',revision:1,subject:'Thank you for supporting digital skills',body:'Synthetic audit draft only.',status:'approved',channel:'email'}];
fixtures['/api/retention/at-risk']=[{donorId:donor.id,donorName:donor.name,lastDonationAt:`${year-1}-01-01`,reason:'Configured inactivity threshold reached.'}];
fixtures['/api/outreach/history']=[{subject:'Thank you',at:`${year}-01-02`,status:'sent'}];
fixtures['/api/custom-fields']=[{id:'audit-field',key:'interest',label:'Community connection',field_type:'text',validation_rules:{},active:true}];
fixtures['/api/campaigns']=[{id:'audit-campaign',name:'Digital learning',archived_at:null}];
fixtures['/api/roles']=[{id:'administrator',name:'Administrator',permissions:['reports.read']}];
fixtures['/api/retention/settings']={inactivityMonths:12};

fixtures['/api/donors/audit-donor']={id:donor.id,display_name:donor.name,normalized_email:donor.email,donor_type:'organization',custom_data:{},email_consent:true};
fixtures['/api/donors/audit-donor/donations']=[{id:'audit-gift',donor_id:donor.id,donation_date:`${year}-01-01`,amount:'1250.00',currency:'USD',status:'completed',source:'Synthetic'}];
fixtures['/api/activities']=[];fixtures['/api/assignments']=[];
fixtures['/api/v1/follow-ups']={items:[{id:task.id,donor_id:donor.id,donor_name:donor.name,next_action:task.title,due_at:`${year}-01-01T00:00:00Z`,assignee_id:'audit-member',assignee_name:'Audit Board Member',status:'open'}],has_more:false};
fixtures['/api/v1/overview']={counts:{overdue:1,due_today:0,pending_drafts:1,unassigned_donors:0}};
fixtures['/api/imports/history']={items:[],has_more:false};
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;try{if(path.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:fixtures[path]??[]}));return;}const file=path==='/'?'index.html':path.slice(1);if(!STATIC_FILES.includes(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(`${root}/${file}`));}catch(e){res.writeHead(500).end(e.message);}});
server.listen(0,'127.0.0.1');await once(server,'listening');
const chrome=spawn(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${join(tmpdir(),`colorloop-audit-profile-${process.pid}`)}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let websocket;
try{
 const address=await new Promise((resolve,reject)=>{let stderr='';chrome.stderr.on('data',b=>{stderr+=b.toString();const found=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(found)resolve(found[1]);});chrome.on('error',reject);chrome.on('exit',code=>reject(new Error(`Chrome exited ${code}: ${stderr.slice(-1000)}`)));setTimeout(()=>reject(new Error('Chrome debugging startup timed out')),20000).unref();});
 websocket=new WebSocket(address);await once(websocket,'open');let sequence=0;const pending=new Map();
 websocket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const p=pending.get(data.id);pending.delete(data.id);if(data.error)p?.reject(new Error(JSON.stringify(data.error)));else p?.resolve(data.result);}});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});websocket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const cdp=(method,params)=>send(method,params,sessionId);
 await cdp('Page.enable');await cdp('Runtime.enable');
 const evaluate=async expression=>{const value=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw new Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
 const waitReady=()=>evaluate(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(document.querySelector('main h1')&&!document.querySelector('main .loading')&&document.querySelector('main').textContent.length>100)return resolve(true);if(++n>100)return reject(new Error('UI not ready'));setTimeout(poll,30);};poll();})`);
 const results=[];
 for(const [name,width,height,scale=1] of [['desktop',1440,1000],['tablet',768,1024],['mobile',390,844],['narrow',320,800],['zoom200',720,500,2]]){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile:false});
  for(const screen of ['dashboard','donors','imports','tasks','outreach','reports','settings',...['giving','timeline','outreach','tasks','details'].map(tab=>'donors/audit-donor?tab='+tab),'donors?view=duplicates','outreach?view=attention','outreach?view=history']){
   await cdp('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/#${screen}`});await waitReady();
   await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
   const audit=await evaluate(`(()=>{
    const luminance=rgb=>{const values=rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return values[0]*.2126+values[1]*.7152+values[2]*.0722;};
    const parse=color=>color.match(/[\\d.]+/g)?.slice(0,3).map(Number);
    const background=el=>{for(let node=el;node;node=node.parentElement){const bg=getComputedStyle(node).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')return bg;}return 'rgb(255, 255, 255)';};
    const contrast=[];const small=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){const text=walker.currentNode.textContent.trim();const el=walker.currentNode.parentElement;if(!text||!el.checkVisibility({checkVisibilityCSS:true})||!el.getClientRects().length||el.closest('script,style,dialog:not([open])'))continue;const style=getComputedStyle(el);const fg=luminance(parse(style.color)),bg=luminance(parse(background(el)));const ratio=(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);const size=parseFloat(style.fontSize);const threshold=size>=24||(size>=18.66&&Number(style.fontWeight)>=700)?3:4.5;if(ratio<threshold)contrast.push({text:text.slice(0,65),ratio,size,foreground:style.color,background:background(el)});if(size<12)small.push({text:text.slice(0,65),size});}
    return {title:document.title,overflow:document.documentElement.scrollWidth>innerWidth,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,contrast,small,images:document.images.length,bodyFont:getComputedStyle(document.body).fontFamily,bodyLineHeight:getComputedStyle(document.body).lineHeight,buttons:[...document.querySelectorAll('button')].filter(b=>b.checkVisibility()).map(b=>({text:b.textContent.trim(),type:b.type,width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height})),renderErrors:[...document.querySelectorAll('main [role=alert]')].map(e=>e.textContent).filter(Boolean),unlabelled:[...document.querySelectorAll('input,select,textarea')].filter(e=>e.checkVisibility()&&!e.labels.length&&!e.getAttribute('aria-label')).map(e=>e.outerHTML)};
   })()`);
   results.push({viewport:name,screen,...audit});
   if(['dashboard','donors','imports'].includes(screen)||name==='mobile'){const {data}=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(`${output}/${name}-${screen.replaceAll(/[^a-z0-9-]/gi,'-')}.png`,Buffer.from(data,'base64'));}
  }
 }
 // Keyboard checks use actual Tab, Enter, and Escape events.
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?keyboard=1#donors`});await waitReady();await cdp('Page.bringToFront');
 const key=async(key,code,extra={})=>{await cdp('Input.dispatchKeyEvent',{type:'keyDown',key,code,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{}),...extra});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key,code,...extra});await evaluate('new Promise(resolve=>setTimeout(resolve,30))');};
 await key('Tab','Tab',{windowsVirtualKeyCode:9});
 const skipFocused=await evaluate(`document.activeElement.classList.contains('skip')`);
 const focusStyle=await evaluate(`({style:getComputedStyle(document.activeElement).outlineStyle,width:getComputedStyle(document.activeElement).outlineWidth,color:getComputedStyle(document.activeElement).outlineColor})`);
 await key('Enter','Enter',{windowsVirtualKeyCode:13});
 const skipWorks=await evaluate(`document.activeElement.id==='main'&&location.hash==='#donors'`);
 await evaluate(`document.querySelector('#session').focus()`);await key('Enter','Enter',{windowsVirtualKeyCode:13});

 await key('ArrowDown','ArrowDown',{windowsVirtualKeyCode:40});await key('Enter','Enter',{windowsVirtualKeyCode:13});
 const dialogStartsOnName=await evaluate(`document.querySelector('dialog').open&&document.activeElement.name==='name'`);
 for(let i=0;i<6;i++)await key('Tab','Tab',{windowsVirtualKeyCode:9});
 const dialogTrapsFocus=await evaluate(`document.querySelector('dialog').contains(document.activeElement)`);
 await key('Escape','Escape',{windowsVirtualKeyCode:27});
 const closeFocus=await evaluate(`document.activeElement.outerHTML`);
 const dialogReturnsFocus=await evaluate(`!document.querySelector('dialog').open&&document.activeElement.id==='session'`);
 await evaluate(`document.querySelector('.table-wrap').focus()`);
 await cdp('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:false});
 await key('ArrowRight','ArrowRight',{windowsVirtualKeyCode:39});
 const tableFitsOrScrolls=await evaluate(`(()=>{const t=document.querySelector('.table-wrap');return t.scrollWidth<=t.clientWidth+1||t.scrollLeft>0;})()`);
 const tablesFocusable=await evaluate(`[...document.querySelectorAll('.table-wrap')].every(t=>t.tabIndex===0&&!!t.getAttribute('aria-label'))`);
 await evaluate(`document.querySelector('#more-navigation').focus()`);await key('Enter','Enter',{windowsVirtualKeyCode:13});
 await evaluate(`document.querySelector('#mobile-more a[href="#reports"]').focus()`);await key('Enter','Enter',{windowsVirtualKeyCode:13});await waitReady();
 const routeFocus=await evaluate(`document.activeElement.id==='main'&&document.title.startsWith('Reports')`);
 const keyboard={skipFocused,focusStyle,skipWorks,dialogStartsOnName,dialogTrapsFocus,dialogReturnsFocus,closeFocus,tablesFocusable,tableFitsOrScrolls,routeFocus};
 const css=await readFile(`${root}/public/css/app.css`,'utf8');
 const approved=new Set(['#007A3D','#00A850','#E6F4ED','#FFFFFF','#595959','#C8C8C8','#000000']);
 const offPalette=[...new Set(css.match(/#[0-9a-f]{3,8}\b/gi)||[])].filter(c=>!approved.has(c.toUpperCase()));
 const summary={fixtureOnly:true,offPalette,results,keyboard};await writeFile(`${output}/results.json`,JSON.stringify(summary,null,2));
 console.log(JSON.stringify({output,offPalette,views:results.length,overflow:results.filter(r=>r.overflow).map(r=>[r.viewport,r.screen]),contrast:results.filter(r=>r.contrast.length).map(r=>({viewport:r.viewport,screen:r.screen,issues:r.contrast})),smallText:results.filter(r=>r.small.length),unlabelled:results.filter(r=>r.unlabelled.length),renderErrors:results.filter(r=>r.renderErrors.length),keyboard},null,2));
 if(offPalette.length||results.some(r=>r.overflow||r.contrast.length||r.small.length||r.unlabelled.length||r.renderErrors.length)||Object.entries(keyboard).some(([key,value])=>!['focusStyle','closeFocus'].includes(key)&&value!==true))process.exitCode=1;
}finally{websocket?.close();chrome.kill('SIGTERM');server.close();}
