export class DataError extends Error {
  constructor(code, message, status = 400) { super(message); Object.assign(this, { code, status }); }
}
export function ensure(value, message, code = 'VALIDATION_ERROR', status = 400) {
  if (!value) throw new DataError(code, message, status);
}
export function object(value) {
  ensure(value && typeof value === 'object' && !Array.isArray(value), 'Expected a JSON object.');
  return value;
}
export function allowlist(value, keys) {
  object(value);
  ensure(Object.keys(value).every((key) => keys.includes(key)), 'Unknown or protected field.');
  return value;
}
export function text(value, max = 300, required = false) {
  if (value === null || value === undefined || value === '') {
    ensure(!required, 'A required text field is missing.'); return null;
  }
  ensure(typeof value === 'string', 'Expected text.');
  value = value.trim();
  ensure(value.length <= max && (!required || value.length > 0) && !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value), 'Invalid text length or characters.');
  return value || null;
}
export function uuid(value) {
  ensure(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), 'Invalid UUID.');
  return value.toLowerCase();
}
export function date(value) {
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000-') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, 'Date must be a real YYYY-MM-DD date.');
  return value;
}
export function amount(value) {
  const string = String(value);
  ensure(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(string) && Number(string) > 0, 'Amount must be positive with at most two decimal places.');
  return Number(string).toFixed(2);
}
export function email(value) {
  value = text(value, 254);
  if (value) ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'Invalid email.');
  return value?.toLowerCase() ?? null;
}
export function page(params = {}) {
  for (const key of ['limit', 'offset']) if (params[key] !== undefined) ensure(/^\d+$/.test(String(params[key])), 'Invalid pagination.');
  const limit = Number(params.limit ?? 25), offset = Number(params.offset ?? 0);
  ensure(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100 && Number.isSafeInteger(offset) && offset <= 100000, 'Invalid pagination.');
  return [limit, offset];
}
export async function customData(query, value, previous = {}) {
  object(value);
  ensure(JSON.stringify(value).length <= 16000, 'Custom values are too large.');
  const { rows: definitions } = await query('SELECT * FROM custom_fields');
  for (const [key, item] of Object.entries(value)) {
    const field = definitions.find((entry) => entry.key === key);
    if (!field?.active && Object.hasOwn(previous,key) && JSON.stringify(previous[key])===JSON.stringify(item)) continue;
    ensure(field?.active, 'Unknown or inactive custom field.');
    const rules = field.validation_rules;
    if (field.field_type === 'text') text(item, rules.max_length ?? 2000, true);
    if (field.field_type === 'number') ensure(typeof item === 'number' && Number.isFinite(item) && (rules.min === undefined || item >= rules.min) && (rules.max === undefined || item <= rules.max), 'Invalid custom number.');
    if (field.field_type === 'boolean') ensure(typeof item === 'boolean', 'Invalid custom boolean.');
    if (field.field_type === 'date') date(item);
    if (field.field_type === 'select') ensure(rules.options.includes(item), 'Invalid custom selection.');
  }
  for (const field of definitions) if (field.active && field.validation_rules.required) ensure(value[field.key] !== undefined && value[field.key] !== null && value[field.key] !== '', 'A required custom field is missing.');
  return value;
}
export const donorKeys = ['donor_type', 'first_name', 'last_name', 'display_name', 'normalized_email', 'secondary_email', 'phone', 'company', 'organization_name', 'contact_person', 'custom_data', 'archived', 'email_consent', 'sms_consent', 'opted_out'];
export async function donorInput(query, input, previous = {}) {
  allowlist(input, donorKeys);
  const data = { ...previous, ...input };
  ensure(['person', 'organization'].includes(data.donor_type), 'Invalid donor type.');
  const result = { donor_type: data.donor_type, first_name: text(data.first_name), last_name: text(data.last_name), display_name: text(data.display_name, 300, true), normalized_email: email(data.normalized_email), phone: text(data.phone, 80), company: text(data.company) };
  for(const key of ['organization_name','contact_person'])if(key in data){const value=text(data[key],300);if(value!==null||key in previous)result[key]=value;}
  if(['organization_name','contact_person'].some(key=>Object.hasOwn(result,key))&&!Object.hasOwn(previous,'organization_name'))ensure((await query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='donors' AND column_name='organization_name') AS ready")).rows[0].ready,'Organization/contact-person fields require reviewed migration 008. Existing records were not changed.','MIGRATION_REQUIRED',503);
  result.secondary_email = email(data.secondary_email);
  if (input.custom_data !== undefined || !previous.id) result.custom_data = await customData(query, data.custom_data ?? {}, previous.custom_data);
  if ('archived' in input) { ensure(typeof input.archived === 'boolean', 'Invalid archived flag.'); result.archived_at = input.archived ? new Date().toISOString() : null; }
  for (const key of ['email_consent','sms_consent','opted_out']) if (key in input) {
    ensure(typeof input[key] === 'boolean', 'Invalid contact preference.'); result[key] = input[key];
  }
  return result;
}
export function donationInput(input) {
  allowlist(input, ['donor_id', 'amount', 'donation_date', 'source', 'external_transaction_id', 'campaign_id', 'program','currency','status']);
  const currency = input.currency ?? null, status = input.status ?? null;
  ensure(currency === null || (typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)), 'Invalid currency.');
  ensure(status === null || ['completed','pending','refunded','voided'].includes(status), 'Invalid donation status.');
  return { donor_id: uuid(input.donor_id), amount: amount(input.amount), donation_date: date(input.donation_date), source: text(input.source, 100, true), external_transaction_id: text(input.external_transaction_id, 300), campaign_id: input.campaign_id ? uuid(input.campaign_id) : null, program: text(input.program), currency, status };
}
