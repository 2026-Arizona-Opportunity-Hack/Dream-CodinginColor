import {endpoint} from './data-api.js';
import {allowlist,ensure,page,text,uuid,date} from './data-validation.js';
import {assignmentScoped} from './donor-access.js';
const scope=user=>assignmentScoped(user)?uuid(user.id):null;
const windowed=(rows,limit,offset)=>({items:rows.slice(0,limit),limit,offset,has_more:rows.length>limit});
const get=(permission,work)=>({permission,run:({request,user,db})=>db.transaction(async q=>{await q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return work(q,request.query||{},user);})});
const params=(input,extra=[])=>{allowlist(input,['limit','offset',...extra]);return page(input);};
export const readRoutes={
 'v1/follow-ups':get('donors.read',async(q,input,user)=>{
  const [limit,offset]=params(input,['donor_id','status']),donorId=input.donor_id?uuid(input.donor_id):null,status=text(input.status,30);
  ensure(!status||['open','in_progress','completed','cancelled'].includes(status),'Unknown follow-up status.');
  const rows=(await q(`SELECT t.id,t.donor_id,d.display_name AS donor_name,t.next_action,t.due_at,t.status,t.assignee_id,u.name AS assignee_name
   FROM tasks t JOIN donors d ON d.id=t.donor_id JOIN users u ON u.id=t.assignee_id
   WHERE ($1::uuid IS NULL OR d.assigned_board_member_id=$1) AND ($2::uuid IS NULL OR t.donor_id=$2) AND ($3::text IS NULL OR t.status=$3)
   ORDER BY t.due_at,t.id LIMIT $4 OFFSET $5`,[scope(user),donorId,status,limit+1,offset])).rows;
  return windowed(rows,limit,offset);
 }),
 'v1/campaign-summaries':get('donors.read',async(q,input,user)=>{
  const [limit,offset]=params(input);
  const rows=(await q(`SELECT c.id,c.name,count(g.id)::int AS verified_usd_gift_count,coalesce(sum(g.amount),0)::text AS verified_usd_total
   FROM campaigns c LEFT JOIN donations g ON g.campaign_id=c.id AND g.currency='USD' AND g.status='completed'
   AND ($1::uuid IS NULL OR EXISTS(SELECT 1 FROM donors d WHERE d.id=g.donor_id AND d.assigned_board_member_id=$1))
   WHERE c.archived_at IS NULL AND ($1::uuid IS NULL OR EXISTS(SELECT 1 FROM donations x JOIN donors d ON d.id=x.donor_id WHERE x.campaign_id=c.id AND d.assigned_board_member_id=$1))
   GROUP BY c.id,c.name ORDER BY c.name,c.id LIMIT $2 OFFSET $3`,[scope(user),limit+1,offset])).rows;
  return windowed(rows,limit,offset);
 }),
 'v1/overview':get('donors.read',async(q,input,user)=>{
  const [limit,offset]=params(input,['on','time_zone']),day=date(input.on),zone=input.time_zone||'America/Phoenix';ensure(['America/Phoenix','UTC'].includes(zone),'Choose America/Phoenix or UTC.');
  const owner=scope(user);
  const taskDay="(CASE WHEN (t.due_at AT TIME ZONE 'UTC')::time='00:00:00'::time THEN (t.due_at AT TIME ZONE 'UTC')::date ELSE (t.due_at AT TIME ZONE $3)::date END)";
  const counts=(await q(`SELECT count(*) FILTER(WHERE ${taskDay}<$2::date)::int AS overdue,
   count(*) FILTER(WHERE ${taskDay}=$2::date)::int AS due_today FROM tasks t JOIN donors d ON d.id=t.donor_id
   WHERE t.status IN ('open','in_progress') AND ($1::uuid IS NULL OR d.assigned_board_member_id=$1)`,[owner,day,zone])).rows[0];
  counts.pending_drafts=(await q(`SELECT count(*)::int AS n FROM outreach_messages m LEFT JOIN donors d ON d.id=m.donor_id WHERE m.status='draft'
   AND ($1::uuid IS NULL OR (m.audience='donor' AND d.assigned_board_member_id=$1) OR (m.audience='board' AND m.user_id=$1))`,[owner])).rows[0].n;
  counts.unassigned_donors=(await q('SELECT count(*)::int AS n FROM donors WHERE archived_at IS NULL AND assigned_board_member_id IS NULL AND $1::uuid IS NULL',[owner])).rows[0].n;
  const tasks=(await q(`SELECT t.id,t.donor_id,d.display_name AS donor_name,t.next_action,t.due_at,t.status,t.assignee_id
   FROM tasks t JOIN donors d ON d.id=t.donor_id WHERE t.status IN ('open','in_progress') AND ${taskDay}<=$2::date
   AND ($1::uuid IS NULL OR d.assigned_board_member_id=$1) ORDER BY t.due_at,t.id LIMIT $4 OFFSET $5`,[owner,day,zone,limit+1,offset])).rows;
  return {on:day,time_zone:zone,counts,tasks:windowed(tasks,limit,offset)};
 }),
 'imports/history':get('imports.manage',async(q,input,user)=>{
  ensure(!assignmentScoped(user),'Import history requires a staff account.','FORBIDDEN',403);const [limit,offset]=params(input);
  const rows=(await q(`SELECT id,filename,source,status,validation_counts,created_at,confirmed_at FROM import_batches
   WHERE importing_user_id=$1 OR $2 ORDER BY created_at DESC,id LIMIT $3 OFFSET $4`,[user.id,user.roleId==='administrator',limit+1,offset])).rows;
  return windowed(rows,limit,offset);
 }),
 'import-detail':get('imports.manage',async(q,input,user)=>{
  ensure(!assignmentScoped(user),'Import history requires a staff account.','FORBIDDEN',403);const [limit,offset]=params(input,['id']),id=uuid(input.id);
  const batch=(await q(`SELECT id,filename,source,status,validation_counts,created_at,confirmed_at FROM import_batches
   WHERE id=$1 AND (importing_user_id=$2 OR $3)`,[id,user.id,user.roleId==='administrator'])).rows[0];ensure(batch,'Import not found.','NOT_FOUND',404);
  const rows=(await q('SELECT row_number,result,error_details,donor_id,donation_id FROM import_rows WHERE import_batch_id=$1 ORDER BY row_number LIMIT $2 OFFSET $3',[id,limit+1,offset])).rows;
  return {batch,rows:windowed(rows,limit,offset)};
 }),
};
export const readOnlyHandler=(name,options)=>endpoint({GET:readRoutes[name]},options);
