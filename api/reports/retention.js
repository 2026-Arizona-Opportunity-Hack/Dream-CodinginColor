import { calculateRetention, parseFilters } from '../../lib/reporting.js';
import { authorize, loadGifts, loadActivityCount, handleError, readOnly } from '../../lib/reporting-store.js';
export default async function handler(req,res) {
  if(!readOnly(req,res))return;
  try {
    const deps=await authorize(req,res,'reports:read');if(!deps)return;
    const filters=parseFilters(req.query);
    const [gifts,count]=await Promise.all([loadGifts(deps.sql,filters),loadActivityCount(deps.sql,filters)]);
    return res.status(200).json({data:calculateRetention(gifts,filters,count)});
  }catch(error){return handleError(res,error);}
}
