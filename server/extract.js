/**
 * server/extract.js
 * Pull plain text out of uploaded documents so the normal pipeline can
 * compress them: PDF, Word (.docx), Excel (.xlsx) and CSV.
 *
 * Runs on the server because the parsers are Node libraries. Nothing is stored.
 */

import path from 'node:path';
import { extractText as pdfText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';

export class ExtractError extends Error {}

export const SUPPORTED = ['.pdf', '.docx', '.xlsx', '.csv'];

/**
 * @param {Buffer} buffer
 * @param {string} filename  only the extension is used
 * @returns {Promise<{ text: string, kind: 'pdf'|'docx'|'sheet', pages?: number }>}
 */
export async function extractFromFile(buffer, filename) {
  const ext = path.extname(String(filename)).toLowerCase();
  let result;
  try {
    if (ext === '.pdf')       result = await fromPdf(buffer);
    else if (ext === '.docx') result = await fromDocx(buffer);
    else if (ext === '.xlsx') result = await fromXlsx(buffer);
    else if (ext === '.csv')  result = { kind: 'sheet', text: fromCsv(buffer.toString('utf8')) };
    else if (ext === '.doc' || ext === '.xls') {
      throw new ExtractError(`Old ${ext} files aren't supported. Save it as ${ext === '.doc' ? '.docx' : '.xlsx'} and upload again.`);
    } else {
      throw new ExtractError(`Unsupported file type "${ext || 'unknown'}". Use ${SUPPORTED.join(', ')}, .vtt, .srt or .txt.`);
    }
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError(`Could not read this ${ext.slice(1).toUpperCase()} file. It may be corrupted or password-protected.`);
  }

  result.text = result.text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!result.text) {
    throw new ExtractError(
      result.kind === 'pdf'
        ? 'No text found in this PDF. Scanned PDFs (images of pages) need OCR, which is not supported.'
        : 'No text found in this file.'
    );
  }
  return result;
}

async function fromPdf(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await pdfText(pdf, { mergePages: true });
  return { kind: 'pdf', text, pages: totalPages };
}

async function fromDocx(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return { kind: 'docx', text: value };
}

// Excel cells can be plain values or objects (formulas, rich text, hyperlinks, dates).
function cellToString(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellToString(v.result);
    if ('richText' in v) return v.richText.map(r => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('error' in v) return '';
    return '';
  }
  return String(v).trim();
}

async function fromXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const parts = [];
  wb.eachSheet(sheet => {
    const rows = [];
    sheet.eachRow(row => {
      const cells = row.values.slice(1).map(cellToString);   // row.values is 1-indexed
      if (cells.some(Boolean)) rows.push(cells.join(' | '));
    });
    if (rows.length > 0) parts.push(`Sheet: ${sheet.name}\n${rows.join('\n')}`);
  });
  return { kind: 'sheet', text: parts.join('\n\n') };
}

/** Minimal CSV reader: handles quoted fields, escaped quotes and commas inside quotes. */
export function fromCsv(raw) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuotes) {
      if (c === '"' && raw[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field.trim()); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && raw[i + 1] === '\n') i++;
      row.push(field.trim()); field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows.map(r => r.join(' | ')).join('\n');
}
