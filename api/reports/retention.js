import { calculateRetention, parseFilters } from '../../lib/reporting.js';
import { authorize, loadGifts, loadActivityCount, handleError, readOnly } from '../../lib/reporting-store.js';
export default async function handler(req,res) {
  if(!readOnly(req,res))return;
  try {
    const deps=await authorize(req,res,'reports.read');if(!deps)return;
    const filters=parseFilters(req.query);
    const [gifts,count]=await Promise.all([loadGifts(deps.sql,filters),loadActivityCount(deps.sql,filters)]);
    const report=calculateRetention(gifts,filters,count);
    const donors=await deps.sql`SELECT id::text,name FROM reporting_donors`;
    report.categoryDonors=Object.fromEntries(Object.entries(report.categories).map(([key,ids])=>[key,ids.map(id=>({id,name:donors.find(d=>d.id===id)?.name||'Archived donor'}))]));
    return res.status(200).json({data:report});
  }catch(error){return handleError(res,error);}
}
