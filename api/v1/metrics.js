import { createHash, timingSafeEqual } from 'node:crypto';
import { calculateRetention, parseFilters, ReportError } from '../../lib/reporting.js';
import { database, loadGifts, loadActivityCount, handleError, readOnly } from '../../lib/reporting-store.js';
import { contextKey } from '../../lib/permissions.js';
export function validKey(header,expected) {
  if(!expected||typeof header!=='string'||!header.startsWith('Bearer '))return false;
  const digest=value=>createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header.slice(7)),digest(expected));
}
export function createHandler({ connect=database, giftsFor=loadGifts, activitiesFor=loadActivityCount }={}) {
 return async function handler(req,res) {
  if(!readOnly(req,res))return;
  try {
    if(!process.env.REPORTING_API_KEY)throw new ReportError(503,'REPORTING_NOT_CONFIGURED','The reporting credential is not configured.');
    if(!validKey(req.headers.authorization,process.env.REPORTING_API_KEY))throw new ReportError(401,'UNAUTHORIZED','A valid reporting bearer key is required.');
    const filters=parseFilters(req.query),{sql}=req[contextKey]?.sql?{sql:req[contextKey].sql}:await connect();
    const [gifts,count]=await Promise.all([giftsFor(sql,filters),activitiesFor(sql,filters)]);
    const report=calculateRetention(gifts,filters,count);
    // Explicit allowlist: never serialize gift rows, names, emails or donor identifiers.
    return res.status(200).json({data:{from:filters.from,to:filters.to,program:filters.program,boardMember:filters.boardMember,currency:'USD',donorTotal:report.donorTotal,giftTotal:report.giftTotal,giftCount:report.giftCount,activityCount:report.activityCount,byProgram:report.byProgram,byBoardMember:report.byBoardMember,monthly:report.monthly}});
  }catch(error){return handleError(res,error);}
}

}
export default createHandler();
