import { parentPort, workerData } from 'node:worker_threads';
import { Unzip, UnzipInflate, zipSync } from 'fflate';
import { readSheet } from 'read-excel-file/node';

try {
  // Inspect actual streamed output, not just attacker-controlled ZIP sizes.
  const entries = Object.create(null);
  let total = 0, count = 0, finished = 0;
  const unzip = new Unzip((file) => {
    if (++count > 100 || file.name in entries || !/^[\w.\-\/[\]]+$/.test(file.name) || file.name.split('/').includes('..')) throw new Error();
    if (file.originalSize > 8000000) throw new Error();
    const parts = [];
    entries[file.name] = null;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      total += chunk.length;
      if (total > 8000000) throw new Error();
      parts.push(chunk);
      if (final) {
        entries[file.name] = Buffer.concat(parts);
        finished++;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  const input = workerData;
  for (let i = 0; i < input.length; i += 1024) unzip.push(input.subarray(i, i + 1024), i + 1024 >= input.length);
  if (finished !== count || !entries['[Content_Types].xml'] || !entries['xl/workbook.xml']) throw new Error();
  if (!entries['[Content_Types].xml'].toString().includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')) throw new Error();
  for (const [name, content] of Object.entries(entries)) {
    if (!name.endsWith('.xml') && !name.endsWith('.rels') && !name.endsWith('/')) throw new Error();
    const xml = content.toString('utf8');
    if (/<!DOCTYPE|<!ENTITY|<(?:\w+:)?f(?:\s|\/|>)|TargetMode\s*=\s*["']External["']/i.test(xml)) throw new Error();
    if (name.startsWith('xl/worksheets/')) {
      // Reject sparse worksheets with enormous coordinates before XML parsing.
      for (const match of xml.matchAll(/\b(?:r|ref)\s*=\s*["']([^"']+)["']/g)) {
        for (const ref of match[1].split(':')) {
          if (/^\d+$/.test(ref)) { if (+ref > 1001) throw new Error(); continue; }
          const cell = /^([A-Z]+)([1-9]\d*)$/.exec(ref);
          if (!cell) throw new Error();
          const column = [...cell[1]].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0);
          if (column > 100 || +cell[2] > 1001) throw new Error();
        }
      }
    }
  }
  // Repack only the inspected content, eliminating inconsistent central entries.
  const rows = await readSheet(Buffer.from(zipSync(entries, { level: 0 })), 1);
  parentPort.postMessage({ rows });
} catch {
  parentPort.postMessage({ error: true });
}
