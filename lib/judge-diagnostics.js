const messages={
 JUDGE_PASSWORD_POLICY:'Use 20–128 characters with uppercase, lowercase, a digit and a special character.',
 INVALID_JUDGE_ACCOUNTS:'Check required account fields and unique emails/passwords in the private configuration.',
 JUDGE_DATABASE_NOT_EMPTY:'A brand-new empty database is required. Existing records were not overwritten.',
 JUDGE_DEMO_UNAVAILABLE:'Dedicated judge identity or configuration checks failed.',
 INVALID_INPUT:'An account or seed field failed validation.',
 STORAGE_UNAVAILABLE:'A storage operation failed; inspect its stage and database error code.',
 '23505':'A unique database constraint rejected this operation.',
 '23503':'A referenced database record is missing.',
 '23514':'A database validation constraint rejected this operation.',
 '42501':'The dedicated database role lacks permission for this operation.',
 '42P01':'A required table or view is unavailable.',
 '42703':'A required column is unavailable.',
 '28P01':'Database authentication failed.',
 '53300':'The database connection limit was reached.',
 '57014':'The database operation was canceled or timed out.',
 ENOENT:'A required private configuration or release metadata file is missing.',
 PROVISION_FAILED:'Provisioning failed. Raw driver messages, SQL and private values are intentionally omitted.'
};
export function provisioningDiagnostic(error,stage='initialization'){
 const code=Object.hasOwn(messages,error?.code)?error.code:/^[0-9A-Z]{5}$/.test(error?.code||'')?error.code:'PROVISION_FAILED';
 return {code,stage:/^[a-z][a-z0-9.-]{0,100}$/.test(stage)?stage:'initialization',message:messages[code]||'A database operation failed. Raw driver details are intentionally omitted.'};
}
