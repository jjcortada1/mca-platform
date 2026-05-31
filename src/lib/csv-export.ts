/**
 * Browser-only CSV export helper.
 *
 * Usage:
 *   exportCSV('active-deals', [{ name, status, ... }], [
 *     { key: 'name', label: 'Deal Name' },
 *     { key: 'status', label: 'Status' },
 *     { key: 'fundedAmount', label: 'Funded Amount', format: (v) => `$${v}` },
 *   ]);
 *
 * Triggers a download of `active-deals-YYYY-MM-DD.csv` in the user's browser.
 * Excel-friendly (BOM-prefixed UTF-8, quoted strings, escaped quotes).
 */

export interface CsvColumn<T> {
  key: keyof T | string;
  label: string;
  /** Optional transform applied per cell. Receives raw value, returns string. */
  format?: (value: unknown, row: T) => string | number | null | undefined;
}

function cellToString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    // Arrays of strings -> "; "; everything else -> JSON
    if (Array.isArray(v)) return v.map(cellToString).join('; ');
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

function escape(s: string): string {
  // Always quote — safer for cells containing commas, quotes, newlines.
  return `"${s.replace(/"/g, '""')}"`;
}

export function buildCSV<T extends object>(
  rows: T[],
  columns: CsvColumn<T>[]
): string {
  const header = columns.map((c) => escape(c.label)).join(',');
  const body = rows.map((row) => {
    return columns.map((c) => {
      const raw = (row as unknown as Record<string, unknown>)[c.key as string];
      const v = c.format ? c.format(raw, row) : raw;
      return escape(cellToString(v));
    }).join(',');
  }).join('\r\n');
  return header + '\r\n' + body;
}

/**
 * Generate a CSV and trigger a browser download.
 * Adds a UTF-8 BOM so Excel renders accented characters and emoji correctly.
 */
export function exportCSV<T extends object>(
  filename: string,
  rows: T[],
  columns: CsvColumn<T>[]
): void {
  const dateStamp = new Date().toISOString().slice(0, 10);
  const safeName = filename.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
  const fullName = `${safeName}-${dateStamp}.csv`;

  const csv = '\uFEFF' + buildCSV(rows, columns); // BOM for Excel
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fullName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
