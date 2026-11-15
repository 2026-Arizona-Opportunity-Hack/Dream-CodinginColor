import { parseFilters, ReportError } from '../../lib/reporting.js';
import { authorize, loadGifts, handleError, readOnly } from '../../lib/reporting-store.js';
export default async function handler(req,res) {
  if(!readOnly(req,res))return;
  try {
    const deps=await authorize(req,res,'reports.read');if(!deps)return;
    const filters=parseFilters(req.query),donorId=req.query.donorId;
    if(typeof donorId!=='string'||!donorId||donorId.length>120)throw new ReportError(400,'INVALID_DONOR','A donorId of at most 120 characters is required.');
    const sql=deps.sql;
    const [donors,gifts,outcomes]=await Promise.all([
      sql`SELECT name FROM reporting_donors WHERE id::text = ${donorId}`,
      loadGifts(sql,filters,donorId),
      sql`SELECT description, verified_at::text, evidence_reference FROM reporting_outcomes
        WHERE donor_id::text = ${donorId} AND verified_at IS NOT NULL
        AND evidence_reference IS NOT NULL AND evidence_reference <> ''
        AND period_start >= ${filters.from}::date AND period_end <= ${filters.to}::date
        AND (${filters.program}::text IS NULL OR program = ${filters.program})
        AND (${filters.boardMember}::text IS NULL OR board_member_id::text = ${filters.boardMember}) ORDER BY verified_at`
    ]);
    if(!donors.length)throw new ReportError(404,'DONOR_NOT_FOUND','Funder not found.');
    return res.status(200).json({data:{name:donors[0].name,...filters,currency:'USD',gifts:gifts.filter(g=>g.donated_at.slice(0,10)>=filters.from).map(g=>({donated_at:g.donated_at,amount:Number(g.amount_cents)/100,program:g.program})),outcomes}});
  }catch(error){return handleError(res,error);}
}
