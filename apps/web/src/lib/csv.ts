// Minimal, dependency-free CSV parse/generate — no library pulled in for
// something this small (same convention as this codebase's hand-authored
// SVG icons instead of an icon package, or ₪{price} string concatenation
// instead of Intl.NumberFormat). Handles RFC4180-style quoting (quoted
// fields, embedded commas/newlines, escaped "" for a literal quote) since a
// supplier name or note column can realistically contain a comma.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let i = 0;
  while (i < normalized.length) {
    const char = normalized[i];
    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    // A quote only opens quoted mode at the very start of a field — e.g.
    // Hebrew unit abbreviations like ק"ג (kg) or מ"ל (ml) contain a literal
    // gershayim/quote character mid-field, which must survive as plain
    // text, not be mistaken for an RFC4180 quoted-field opener.
    if (char === '"' && field === '') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += char;
    i++;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-blank trailing lines (a common artifact of a trailing
  // newline at end of file, or stray blank rows left in a spreadsheet).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const str = String(cell);
          return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
        })
        .join(','),
    )
    .join('\r\n');
}

// Triggers a browser download of CSV text. Prefixes a UTF-8 BOM — without
// it, Excel on Windows (the realistic tool a restaurant owner already has
// their ingredient list in) can misdetect the encoding and show Hebrew
// text as mojibake when the file is double-clicked open.
export function downloadCsv(filename: string, csvText: string) {
  const blob = new Blob(['﻿' + csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
