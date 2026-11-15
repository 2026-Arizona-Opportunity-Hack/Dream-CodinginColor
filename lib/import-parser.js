import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { allowlist, ensure, text, email, date, amount, uuid } from './data-validation.js';

export const MAX_FILE_SIZE = 1000000;
const fields = ['donor_type', 'first_name', 'last_name', 'display_name', 'email', 'phone', 'company', 'amount', 'donation_date', 'board_contact', 'campaign_id', 'campaign', 'source', 'program', 'external_transaction_id', 'source_donor_id', 'currency','status'];
const headerKey = (value) => value.toLowerCase().trim().replace(/[\s_-]+/g, ' ');
const aliases = {
  first_name: ['first name', 'donor first name'], last_name: ['last name', 'donor last name'],
  display_name: ['name', 'donor name', 'display name', 'organization name'], email: ['email', 'email address', 'donor email'],
  company: ['company', 'organization'], phone: ['phone', 'phone number'], amount: ['amount', 'donation amount', 'gross amount'],
  donation_date: ['date', 'donation date', 'transaction date'], campaign: ['campaign', 'campaign name'],
  program: ['program'], board_contact: ['board contact', 'board member'],
  external_transaction_id: ['transaction id', 'donation id'], source_donor_id: ['donor id', 'supporter id'],
  donor_type: ['donor type'], source: ['source'], currency:['currency'], status:['status','payment status'],
};
function xlsxRows(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./import-worker.js', import.meta.url), { workerData: buffer, resourceLimits: { maxOldGenerationSizeMb: 64 }, execArgv: [] });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Spreadsheet parsing timeout.')); }, 5000);
    worker.once('message', (result) => { clearTimeout(timer); worker.terminate(); result.error ? reject(new Error()) : resolve(result.rows); });
    worker.once('error', () => { clearTimeout(timer); reject(new Error()); });
    worker.once('exit', (code) => { if (code !== 0) { clearTimeout(timer); reject(new Error()); } });
  });
}
export async function parseImport(input) {
  allowlist(input, ['filename', 'content_base64', 'source', 'mapping']);
  const filename = text(input.filename, 200, true), source = text(input.source, 100, true);
  ensure(!/[\\/]/.test(filename), 'Filename must not contain paths.');
  ensure(typeof input.content_base64 === 'string' && input.content_base64.length <= Math.ceil(MAX_FILE_SIZE / 3) * 4, 'File exceeds 1 MB.', 'FILE_TOO_LARGE', 413);
  ensure(input.content_base64.length > 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content_base64), 'Invalid file encoding.');
  const buffer = Buffer.from(input.content_base64, 'base64');
  ensure(buffer.length <= MAX_FILE_SIZE, 'File exceeds 1 MB.', 'FILE_TOO_LARGE', 413);
  let matrix;
  try {
    if (/\.csv$/i.test(filename)) {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      ensure(!/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(decoded), 'CSV must be UTF-8 text.');
      matrix = parse(decoded, { bom: true, skip_empty_lines: true, max_record_size: 16000, relax_column_count: false });
    } else {
      ensure(/\.xlsx$/i.test(filename) && buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])), 'Only CSV and XLSX files are accepted.');
      matrix = await xlsxRows(buffer);
    }
  } catch { ensure(false, 'File is malformed or contains unsupported or unsafe spreadsheet content.', 'INVALID_FILE'); }
  ensure(matrix.length >= 2 && matrix.length <= 1001, 'File must contain 1–1000 data rows.');
  const headers = matrix[0].map((cell) => text(cell, 100, true));
  ensure(headers.length <= 100 && new Set(headers.map(headerKey)).size === headers.length, 'Headers must be unique; at most 100 columns are allowed.');
  ensure(headers.every((header) => !['__proto__', 'constructor', 'prototype'].includes(header.toLowerCase())), 'Unsafe spreadsheet header.');
  const mapping = Object.create(null);
  if (input.mapping !== undefined) {
    allowlist(input.mapping, [...fields, ...Object.keys(input.mapping).filter((key) => /^custom:[a-z][a-z0-9_]{0,63}$/.test(key) && !['constructor', 'prototype', '__proto__'].includes(key.slice(7)))]);
    for (const [key, header] of Object.entries(input.mapping)) { ensure(headers.includes(header), 'Mapped column does not exist.'); mapping[key] = headers.indexOf(header); }
  } else {
    for (const [key, names] of Object.entries(aliases)) {
      const indices = headers.map((header, i) => names.includes(headerKey(header)) ? i : -1).filter((index) => index >= 0);
      ensure(indices.length <= 1, 'Ambiguous headers; provide an explicit column mapping.');
      if (indices.length) mapping[key] = indices[0];
    }
  }
  const rows = matrix.slice(1).map((cells, index) => {
    try {
      ensure(cells.length <= 100 && cells.every((cell) => cell === null || cell instanceof Date || ['string', 'number', 'boolean'].includes(typeof cell)), 'Invalid cell type.');
      ensure(cells.every((cell) => String(cell ?? '').length <= 2000), 'Cell exceeds 2000 characters.');
      // Values remain text and must be rendered with textContent; never evaluate formulas.
      ensure(cells.every((cell) => typeof cell !== 'string' || (!/^\s*[=@+-]/.test(cell) || /^\+?[0-9 ()-]+$/.test(cell))), 'Formula-like values are not accepted.');
      const raw = Object.fromEntries(Object.entries(mapping).map(([key, column]) => [key, cells[column] ?? null]));
      const custom = Object.fromEntries(Object.entries(raw).filter(([key]) => key.startsWith('custom:')).map(([key, value]) => [key.slice(7), value]));
      const first = text(raw.first_name), last = text(raw.last_name), company = text(raw.company);
      const display = text(raw.display_name) ?? ([first, last].filter(Boolean).join(' ') || company);
      const donor = { donor_type: raw.donor_type ?? (company && !first && !last ? 'organization' : 'person'), first_name: first, last_name: last, display_name: text(display, 300, true), normalized_email: email(raw.email), phone: text(raw.phone, 80), company, custom_data: custom };
      ensure(['person', 'organization'].includes(donor.donor_type), 'Invalid donor type.');
      let donation = null;
      if (raw.amount !== null && raw.amount !== undefined && raw.amount !== '') {
        const when = raw.donation_date instanceof Date ? raw.donation_date.toISOString().slice(0, 10) : raw.donation_date;
        const currency = text(raw.currency), status = text(raw.status);
        ensure(currency === null || /^[A-Z]{3}$/.test(currency), 'Invalid currency.');
        ensure(status === null || ['completed','pending','refunded','voided'].includes(status), 'Invalid status.');
        donation = { amount: amount(raw.amount), donation_date: date(when), source, external_transaction_id: text(raw.external_transaction_id), campaign_id: raw.campaign_id ? uuid(raw.campaign_id) : null, program: text(raw.program),currency,status };
      } else ensure(!raw.donation_date && !raw.external_transaction_id, 'Donation amount is required when donation details are supplied.');
      return { row_number: index + 2, data: { donor, donation, source_donor_id: text(raw.source_donor_id), board_contact: text(raw.board_contact), campaign: text(raw.campaign) }, errors: [] };
    } catch { return { row_number: index + 2, data: null, errors: ['Row contains missing, invalid, or unsafe fields.'] }; }
  });
  return { filename, source, file_hash: createHash('sha256').update(buffer).digest('hex'), headers, mapping, rows };
}
