import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'csv-parse/sync';
import { readSheet } from 'read-excel-file/node';
import { workbook } from '../test-support/workbook.js';
import { neon } from '@neondatabase/serverless';
import handler from '../api/health.js';

test('CSV parsing preserves quoted commas in donor names', () => {
  assert.deepEqual(parse('name,amount\n"Color, Inc.",100', { columns: true }), [
    { name: 'Color, Inc.', amount: '100' },
  ]);
});

test('XLSX parser reads synthetic data under ES modules', async () => {
  assert.deepEqual(await readSheet(workbook([['name', 'amount'], ['Example Donor', '100']])), [
    ['name', 'amount'], ['Example Donor', '100'],
  ]);
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
