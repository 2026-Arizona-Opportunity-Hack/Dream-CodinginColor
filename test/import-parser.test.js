import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImport, MAX_FILE_SIZE } from '../lib/import-parser.js';
import { workbook } from '../test-support/workbook.js';

const file = (content, filename = 'synthetic.csv', rest = {}) => ({ filename, source: 'synthetic-test', content_base64: Buffer.from(content).toString('base64'), ...rest });

test('valid CSV normalizes names/email and preserves exact decimal amounts', async () => {
  const result = await parseImport(file('First Name,Last Name,Email,Amount,Date\nExample,Supporter,EXAMPLE@example.invalid,10.25,2026-02-28'));
  assert.equal(result.rows[0].data.donor.display_name, 'Example Supporter');
  assert.equal(result.rows[0].data.donor.normalized_email, 'example@example.invalid');
  assert.equal(result.rows[0].data.donation.amount, '10.25');
});

test('valid XLSX is inspected and parsed without evaluating formulas', async () => {
  const result = await parseImport(file(workbook([['Name', 'Amount', 'Date'], ['Example Supporter', '10.25', '2026-02-28']]), 'synthetic.xlsx'));
  assert.equal(result.rows[0].data.donation.amount, '10.25');
});

test('explicit mapping supports CIC/provider/custom spreadsheet headings', async () => {
  const result = await parseImport(file('Supporter,Contact,Interest\nExample,example@example.invalid,STEM', 'synthetic.csv', { mapping: { display_name: 'Supporter', email: 'Contact', 'custom:interests': 'Interest' } }));
  assert.equal(result.rows[0].data.donor.custom_data.interests, 'STEM');
});

test('reject binary content disguised as CSV and non-XLSX ZIP files', async () => {
  await assert.rejects(parseImport(file(Buffer.from([0, 1, 2, 3]))), { code: 'INVALID_FILE' });
  await assert.rejects(parseImport(file('Name\nExample', 'synthetic.xlsx')), { code: 'INVALID_FILE' });
  await assert.rejects(parseImport(file(workbook([['Name'], ['Example']]), 'synthetic.xls')), { code: 'INVALID_FILE' });
  await assert.rejects(parseImport(file('"unterminated')), { code: 'INVALID_FILE' });
});

test('enforces upload, row, column and cell limits', async () => {
  await assert.rejects(parseImport(file(Buffer.alloc(MAX_FILE_SIZE + 1))), { code: 'FILE_TOO_LARGE' });
  await assert.rejects(parseImport(file('Name\n' + 'Example\n'.repeat(1001))), /1–1000/);
  const cell = await parseImport(file('Name\n' + 'x'.repeat(2001)));
  assert.ok(cell.rows[0].errors.length);
  await assert.rejects(parseImport(file(Array.from({ length: 101 }, (_, i) => `Column${i}`).join(',') + '\n' + Array(101).fill('value').join(','))), /100 columns/);
});

test('rejects dangerous/duplicate headers and unknown mappings', async () => {
  await assert.rejects(parseImport(file('__proto__,Name\nx,Example')), /Unsafe/);
  await assert.rejects(parseImport(file('Name,name\nx,y')), /unique/);
  await assert.rejects(parseImport(file('Name\nExample', 'synthetic.csv', { mapping: { id: 'Name' } })), /Unknown/);
});

test('missing names, invalid dates and invalid amounts produce row errors', async () => {
  for (const csv of ['Email\nexample@example.invalid', 'Name,Amount,Date\nExample,5,2026-02-30', 'Name,Amount,Date\nExample,5.001,2026-02-28']) {
    assert.ok((await parseImport(file(csv))).rows[0].errors.length);
  }
});

test('CSV formula-like values are rejected', async () => {
  for (const value of ['=HYPERLINK("https://example.invalid")', '@SUM(1)', '+CMD()']) {
    const csv = `Name\n"${value.replaceAll('"', '""')}"`;
    assert.ok((await parseImport(file(csv))).rows[0].errors.length);
  }
});

test('XLSX formulas, external links, XML entities and sparse dimensions are rejected', async () => {
  const hostile = [
    { 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1"><f>SUM(1)</f><v>1</v></c></row></sheetData></worksheet>' },
    { 'xl/_rels/sheet1.xml.rels': '<Relationships><Relationship TargetMode="External" Target="https://example.invalid"/></Relationships>' },
    { 'xl/worksheets/sheet1.xml': '<!DOCTYPE x [<!ENTITY x "example">]><worksheet/>' },
    { 'xl/worksheets/sheet1.xml': '<worksheet><dimension ref="A1:XFD1048576"/></worksheet>' },
  ];
  for (const extra of hostile) await assert.rejects(parseImport(file(workbook([['Name'], ['Example']], extra), 'synthetic.xlsx')), { code: 'INVALID_FILE' });
});

test('XLSX decompression bombs are rejected', async () => {
  const content = workbook([['Name'], ['Example']], { 'xl/sharedStrings.xml': ' '.repeat(8000001) });
  assert.ok(content.length < MAX_FILE_SIZE);
  await assert.rejects(parseImport(file(content, 'synthetic.xlsx')), { code: 'INVALID_FILE' });
});
