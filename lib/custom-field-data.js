import { allowlist, ensure, object, text, uuid, page } from './data-validation.js';
import { insert, update } from './donor-data.js';

export function fieldInput(input, previous = {}) {
  allowlist(input, ['key', 'label', 'field_type', 'validation_rules', 'active','hidden']);
  if (previous.id) ensure(input.key === undefined && input.field_type === undefined, 'Field keys and types are immutable.');
  const value = { ...previous, ...input };
  const key = text(value.key, 64, true);
  ensure(/^[a-z][a-z0-9_]{0,63}$/.test(key) && !['constructor', 'prototype', '__proto__'].includes(key), 'Invalid custom field key.');
  ensure(['text', 'number', 'boolean', 'date', 'select'].includes(value.field_type), 'Invalid field type.');
  const rules = object(value.validation_rules ?? {});
  allowlist(rules, ['required', 'max_length', 'min', 'max', 'options']);
  if ('required' in rules) ensure(typeof rules.required === 'boolean', 'Invalid required rule.');
  if ('max_length' in rules) ensure(Number.isInteger(rules.max_length) && rules.max_length >= 1 && rules.max_length <= 2000 && value.field_type === 'text', 'Invalid length rule.');
  for (const bound of ['min', 'max']) if (bound in rules) ensure(value.field_type === 'number' && Number.isFinite(rules[bound]), 'Invalid numeric bound.');
  if ('min' in rules && 'max' in rules) ensure(rules.min <= rules.max, 'Invalid numeric bounds.');
  if ('options' in rules || value.field_type === 'select') ensure(value.field_type === 'select' && Array.isArray(rules.options) && rules.options.length >= 1 && rules.options.length <= 50 && rules.options.every((item) => typeof item === 'string' && text(item, 100, true)), 'Invalid options.');
  const active = value.active ?? true;
  ensure(typeof active === 'boolean', 'Invalid active flag.');
  const hidden = value.hidden ?? false;
  ensure(typeof hidden === 'boolean', 'Invalid visibility flag.');
  return { key, label: text(value.label, 100, true), field_type: value.field_type, validation_rules: rules, active, hidden };
}
export async function saveField(query, input, id) {
  const previous = id ? (await query('SELECT * FROM custom_fields WHERE id = $1 FOR UPDATE', [uuid(id)])).rows[0] : {};
  ensure(previous, 'Field not found.', 'NOT_FOUND', 404);
  const value = fieldInput(input, previous);
  return id ? update(query, 'custom_fields', id, value) : insert(query, 'custom_fields', value);
}
export async function listFields(query, params = {}) {
  const [limit, offset] = page(params);
  return (await query('SELECT * FROM custom_fields ORDER BY key LIMIT $1 OFFSET $2', [limit, offset])).rows;
}
export async function saveCampaign(query, input, id) {
  allowlist(input, ['name', 'archived']);
  const data = {};
  if ('name' in input || !id) data.name = text(input.name, 200, true);
  if ('archived' in input) { ensure(typeof input.archived === 'boolean', 'Invalid archived flag.'); data.archived_at = input.archived ? new Date().toISOString() : null; }
  ensure(Object.keys(data).length, 'No changes provided.');
  if (!id) return insert(query, 'campaigns', data);
  const campaign = await update(query, 'campaigns', uuid(id), data);
  ensure(campaign, 'Campaign not found.', 'NOT_FOUND', 404);
  return campaign;
}
export async function listCampaigns(query, params) {
  const [limit, offset] = page(params);
  return (await query('SELECT * FROM campaigns WHERE archived_at IS NULL ORDER BY name, id LIMIT $1 OFFSET $2', [limit, offset])).rows;
}
