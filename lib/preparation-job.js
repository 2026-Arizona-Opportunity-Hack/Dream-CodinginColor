import {timingSafeEqual,createHash} from 'node:crypto';
import {getStore} from './retention-store.js';
import {prepareThankYou,generateReminders} from './outreach.js';
import {ApiError} from './retention-http.js';
import {processEmailAutomation} from './email-automation.js';
import {isJudgeDeployment} from './judge-deployment.js';
const valid=(value,secret)=>typeof secret==='string'&&secret.length>=32&&typeof value==='string'&&value.startsWith('Bearer ')&&timingSafeEqual(createHash('sha256').update(value.slice(7)).digest(),createHash('sha256').update(secret).digest());
export async function preparationJob(req,res,{store,env=process.env,provider,secret=env.CRON_SECRET,userId=env.AUTOMATION_USER_ID,now=new Date()}={}){
 res.setHeader('Cache-Control','no-store');
 if(isJudgeDeployment(env))return res.status(403).json({error:{code:'JUDGE_AUTOMATION_DISABLED',message:'Background jobs are disabled in Judge Demo.'}});
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:{code:'METHOD_NOT_ALLOWED',message:'Use GET or POST.'}});}
 if(!valid(req.headers.authorization,secret))return res.status(401).json({error:{code:'UNAUTHORIZED',message:'A configured preparation-job credential is required.'}});
 if(!userId)return res.status(503).json({error:{code:'AUTOMATION_UNCONFIGURED',message:'Configure a genuine automation account.'}});
 try{
  const source=store||getStore();
  const validate=state=>{
   const user=state.users.find(u=>u.id===userId&&u.active),role=user&&state.roles.find(r=>r.id===user.roleId&&r.active!==false);
   if(!role||((user.boardMember||role.id==='board-member')&&role.id!=='administrator')||!['tasks.manage','outreach.write'].every(p=>role.permissions.includes(p)))throw new ApiError(403,'FORBIDDEN','The automation account lacks preparation permissions.');
  };
  const checked={transaction:work=>source.transaction(state=>{validate(state);return work(state);})};
  const thanks=await checked.transaction(state=>{let count=0;for(const gift of state.donations){const before=state.drafts.length;prepareThankYou(state,gift.id,userId,now);if(state.drafts.length>before)count++;}return count;});
  const actor={id:userId};
  const donors=await generateReminders(checked,actor,now,'donor-quarterly');
  const boards=await generateReminders(checked,actor,now,'quarterly');
  const overdue=await generateReminders(checked,actor,now,'overdue');
  // Preparing drafts never implicitly activates unattended provider delivery.
  const email=env.EMAIL_CRON_ENABLED==='true'?await processEmailAutomation(source,userId,now,{env,provider}):{enabled:false,queued:0,failed:0,blocked:0,deliveryUpdates:0,scheduledDeliveryDisabled:true};
  return res.status(200).json({data:{thankYouDraftsCreated:thanks,quarterlyDonorDrafts:donors.length,quarterlyBoardDrafts:boards.length,overdueDrafts:overdue.length,messagesSent:0,email}});
 }catch(error){return res.status(error.status||503).json({error:{code:error.status?error.code:'PREPARATION_UNAVAILABLE',message:error.status?error.message:'Preparation is unavailable; verify account and database configuration.'}});}
}
