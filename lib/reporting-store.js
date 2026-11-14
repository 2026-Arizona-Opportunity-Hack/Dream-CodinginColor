import { ReportError } from './reporting.js';
import { contextKey } from './permissions.js';
// Integration boundary: reuse teammate-owned modules without replacing them.
export async function database() {
  try {
    const {sql}=await import('./db.js');
    if(typeof sql!=='function')throw new Error('Missing sql export');
    return {sql};
  }catch{throw new ReportError(503,'REPORTING_NOT_CONFIGURED','Reporting requires the shared lib/db.js sql export and reporting views.');}
}
export async function dependencies() {
  const {sql}=await database();
  try {
    const {requirePermission}=await import('./permissions.js');
    if(typeof requirePermission!=='function')throw new Error('Missing permission export');
    return {sql,requirePermission};
  }catch{throw new ReportError(503,'REPORTING_NOT_CONFIGURED','Reporting requires the shared permission middleware.');}
}
export async function loadGifts(sql,filters,donorId=null) {
  return sql`SELECT donor_id, donated_at::text, amount_cents::text, program, board_member_id
    FROM reporting_gifts WHERE donated_at < (${filters.to}::date + INTERVAL '1 day')
    AND (${filters.program}::text IS NULL OR program = ${filters.program})
    AND (${filters.boardMember}::text IS NULL OR board_member_id::text = ${filters.boardMember})
    AND (${donorId}::text IS NULL OR donor_id::text = ${donorId}) ORDER BY donated_at, donor_id`;
}
export async function loadActivityCount(sql,f) {
  const result=await sql`SELECT COUNT(*)::int AS count FROM reporting_activities
    WHERE occurred_at >= ${f.from}::date AND occurred_at < (${f.to}::date + INTERVAL '1 day')
    AND (${f.program}::text IS NULL OR program = ${f.program})
    AND (${f.boardMember}::text IS NULL OR board_member_id::text = ${f.boardMember})`;
  return Number(result[0]?.count||0);
}
export function handleError(res,error) {
  const status=error.status||error.statusCode||500;
  const safe=status>=400&&status<500||error instanceof ReportError;
  return res.status(status>=400&&status<=599?status:500).json({error:{code:safe?(error.code||'FORBIDDEN'):'REPORT_FAILED',message:safe?error.message:'Reporting is unavailable. Check the server configuration.'}});
}
export function readOnly(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');res.status(405).json({error:{code:'METHOD_NOT_ALLOWED',message:'Use GET.'}});return false;}
  return true;
}
export async function authorize(req,res,permission) {
  const deps=await dependencies();
  // Shared contract: return an authenticated principal; throw on missing permission.
  const principal=await deps.requirePermission(req,res,permission);
  if(!principal){if(!res.headersSent)throw new ReportError(403,'FORBIDDEN','You do not have permission to view this report.');return null;}
  return req[contextKey]?.sql ? {...deps,sql:req[contextKey].sql} : deps;
}
