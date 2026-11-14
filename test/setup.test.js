import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { neon } from '@neondatabase/serverless';
import handler from '../api/health.js';

test('CSV parsing preserves quoted commas in donor names', () => {
  assert.deepEqual(parse('name,amount\n"Color, Inc.",100', { columns: true }), [
    { name: 'Color, Inc.', amount: '100' },
  ]);
});

test('XLSX can round-trip donor import data under ES modules', () => {
  const rows = [{ name: 'Example Donor', amount: 100 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Donors');
  const parsed = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  assert.deepEqual(XLSX.utils.sheet_to_json(parsed.Sheets.Donors), rows);
});

test('Neon driver exports its ES module connection factory', () => {
  assert.equal(typeof neon, 'function');
});

test('Vercel health handler returns a successful JSON response', () => {
  const response = {
    status(code) { assert.equal(code, 200); return this; },
    json(body) { assert.deepEqual(body, { status: 'ok', service: 'colorloop' }); },
  };
  handler({}, response);
});
