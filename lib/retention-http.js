export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    Object.assign(this, { status, code });
  }
}
export function fail(status, code, message) { throw new ApiError(status, code, message); }
export function check(condition, message) {
  if (!condition) fail(400, 'INVALID_INPUT', message);
}
export function text(value, name, max = 1000) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max,
    `${name} must be a nonempty string of at most ${max} characters.`);
  return value.trim();
}
export function id(value, name = 'id') {
  const result = text(value, name, 100);
  check(/^[a-zA-Z0-9_-]+$/.test(result), `${name} is invalid.`);
  return result;
}
export function record(value, fields) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'A JSON object is required.');
  check(Object.keys(value).every(key => fields.includes(key)), 'Unknown input field.');
  return value;
}
export function boolean(value, name) {
  check(typeof value === 'boolean', `${name} must be a boolean.`);
  return value;
}
export function date(value, name) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/.test(value),
    `${name} must be an ISO date or UTC timestamp.`);
  const parsed = new Date(value);
  check(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value.slice(0, 10),
    `${name} is invalid.`);
  return parsed.toISOString();
}
export function find(rows, value, name = 'Record') {
  const row = rows.find(item => item.id === value);
  if (!row) fail(404, 'NOT_FOUND', `${name} not found.`);
  return row;
}
export function header(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  return typeof value === 'string' ? value : '';
}
export function respond(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(payload);
}
export function sendError(res, error) {
  const known = error instanceof ApiError && error.status >= 400 && error.status <= 599;
  const unavailable = error.code === 'STORAGE_UNAVAILABLE';
  return respond(res, known ? error.status : unavailable ? 503 : 500, { error: {
    code: known || unavailable ? error.code : 'INTERNAL_ERROR',
    message: known || unavailable ? error.message : 'The request could not be completed.',
  } });
}
export function body(req) {
  let value = req.body;
  if (typeof value === 'string') {
    check(Buffer.byteLength(value) <= 32768, 'Request body exceeds 32 KiB.');
    try { value = JSON.parse(value); } catch { fail(400, 'INVALID_JSON', 'Valid JSON is required.'); }
  }
  check(value && typeof value === 'object' && !Array.isArray(value), 'A JSON object is required.');
  check(Buffer.byteLength(JSON.stringify(value)) <= 32768, 'Request body exceeds 32 KiB.');
  return value;
}
