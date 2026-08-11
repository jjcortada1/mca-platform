'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Spreadsheet grid.
 *
 * Behaves the way every user already expects a spreadsheet to behave:
 * column letters, row numbers, a selection you can extend, arrow/Tab/Enter
 * navigation, type-to-edit, copy/paste of real TSV blocks, undo/redo,
 * drag-resizable columns, frozen headers and columns.
 *
 * Built on divs rather than a <table> so the visible rows can be windowed —
 * only the rows on screen are in the DOM, which is what keeps a 1,000-row
 * sheet responsive. Row height is a single global setting rather than
 * per-row, because a uniform height is what makes that windowing exact.
 *
 * The grid owns NO persistence. It reports changes through callbacks; the
 * page keeps its existing debounced, dirty-tracked save path.
 */

export interface GridColumn {
  id: string;
  label: string;
  width?: number;
  format?: 'text' | 'number' | 'currency' | 'percent' | 'date';
  frozen?: boolean;
}

export interface GridRow {
  id: string;
  cells: Record<string, string>;
}

export interface CellChange {
  rowId: string;
  colId: string;
  value: string;
}

export type RowHeight = 'compact' | 'normal' | 'tall';

export const ROW_HEIGHTS: Record<RowHeight, number> = { compact: 26, normal: 32, tall: 44 };

export const DEFAULT_COL_WIDTH = 170;
const GUTTER_W = 48;
const MIN_COL_W = 60;
const MAX_COL_W = 1200;

/** A1-style column letters. */
export function colLetter(i: number): string {
  let n = i;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/* ─────────────────────── value formatting ─────────────────────── */

/**
 * Display formatting only — the stored cell text is never rewritten, so
 * switching a column's format back shows exactly what was typed.
 */
export function formatCell(raw: string, format: GridColumn['format']): string {
  const v = (raw ?? '').trim();
  if (!v || !format || format === 'text') return raw ?? '';
  if (format === 'date') return raw ?? '';

  const n = Number(v.replace(/[$,\s%]/g, ''));
  if (!Number.isFinite(n)) return raw ?? '';

  switch (format) {
    case 'currency':
      return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'percent':
      return `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
    case 'number':
      return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    default:
      return raw ?? '';
  }
}

function isNumericFormat(f: GridColumn['format']): boolean {
  return f === 'number' || f === 'currency' || f === 'percent';
}

/* ─────────────────────── selection model ─────────────────────── */

interface Sel {
  /** Anchor (where the selection started). */
  ar: number; ac: number;
  /** Focus (where it currently extends to). */
  fr: number; fc: number;
}

const norm = (s: Sel) => ({
  r1: Math.min(s.ar, s.fr), r2: Math.max(s.ar, s.fr),
  c1: Math.min(s.ac, s.fc), c2: Math.max(s.ac, s.fc),
});

const inSel = (s: Sel, r: number, c: number) => {
  const n = norm(s);
  return r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2;
};

/* ─────────────────────── undo stack ─────────────────────── */

interface UndoEntry { before: CellChange[]; after: CellChange[] }

export interface SheetGridProps {
  columns: GridColumn[];
  rows: GridRow[];
  canEdit: boolean;
  /** Only the sheet owner may change column definitions. */
  canEditColumns: boolean;
  rowHeight: RowHeight;
  search: string;
  onCellsChange: (changes: CellChange[]) => void;
  onColumnsChange: (columns: GridColumn[]) => void;
  /** Create n rows, resolving with their ids (used when a paste overflows). */
  onAddRows: (n: number) => Promise<string[]>;
  onDeleteRows: (rowIds: string[]) => void;
  onStatus?: (text: string) => void;
}

export function SheetGrid({
  columns, rows, canEdit, canEditColumns, rowHeight, search,
  onCellsChange, onColumnsChange, onAddRows, onDeleteRows, onStatus,
}: SheetGridProps) {
  const rowH = ROW_HEIGHTS[rowHeight];
  const scrollRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; value: string } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const [dragSel, setDragSel] = useState(false);
  const [resizing, setResizing] = useState<{ colId: string; startX: number; startW: number } | null>(null);

  const undoRef = useRef<UndoEntry[]>([]);
  const redoRef = useRef<UndoEntry[]>([]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const colsRef = useRef(columns);
  colsRef.current = columns;

  /* ── windowing: only render the rows on screen ── */
  const OVERSCAN = 8;
  const firstVisible = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN);
  const lastVisible = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / rowH) + OVERSCAN);
  const visibleRows = useMemo(
    () => rows.slice(firstVisible, lastVisible).map((r, i) => ({ row: r, index: firstVisible + i })),
    [rows, firstVisible, lastVisible],
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── column geometry (frozen columns stick to the left) ── */
  const widths = columns.map((c) => c.width ?? DEFAULT_COL_WIDTH);
  const frozenOffsets: number[] = [];
  let acc = GUTTER_W;
  for (let i = 0; i < columns.length; i++) {
    frozenOffsets[i] = acc;
    if (columns[i].frozen) acc += widths[i];
  }
  const totalWidth = GUTTER_W + widths.reduce((a, b) => a + b, 0);

  const searchLower = search.trim().toLowerCase();
  const matches = useCallback(
    (v: string) => Boolean(searchLower) && (v ?? '').toLowerCase().includes(searchLower),
    [searchLower],
  );

  /* ── applying edits, with undo ── */
  const apply = useCallback((changes: CellChange[], record = true) => {
    if (!changes.length) return;
    if (record) {
      const before: CellChange[] = changes.map((c) => ({
        rowId: c.rowId,
        colId: c.colId,
        value: rowsRef.current.find((r) => r.id === c.rowId)?.cells[c.colId] ?? '',
      }));
      undoRef.current.push({ before, after: changes });
      if (undoRef.current.length > 100) undoRef.current.shift();
      redoRef.current = [];
    }
    onCellsChange(changes);
  }, [onCellsChange]);

  const undo = useCallback(() => {
    const e = undoRef.current.pop();
    if (!e) { onStatus?.('Nothing to undo'); return; }
    redoRef.current.push(e);
    onCellsChange(e.before);
    onStatus?.('Undo');
  }, [onCellsChange, onStatus]);

  const redo = useCallback(() => {
    const e = redoRef.current.pop();
    if (!e) { onStatus?.('Nothing to redo'); return; }
    undoRef.current.push(e);
    onCellsChange(e.after);
    onStatus?.('Redo');
  }, [onCellsChange, onStatus]);

  /* ── keeping the focused cell in view ── */
  const scrollIntoView = useCallback((r: number, c: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const top = r * rowH;
    const headerH = 52;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowH > el.scrollTop + el.clientHeight - headerH) {
      el.scrollTop = top + rowH - el.clientHeight + headerH;
    }
    let x = GUTTER_W;
    for (let i = 0; i < c; i++) x += widths[i];
    if (x < el.scrollLeft + GUTTER_W) el.scrollLeft = Math.max(0, x - GUTTER_W);
    else if (x + widths[c] > el.scrollLeft + el.clientWidth) el.scrollLeft = x + widths[c] - el.clientWidth;
  }, [rowH, widths]);

  const moveTo = useCallback((r: number, c: number, extend = false) => {
    const rr = Math.max(0, Math.min(rowsRef.current.length - 1, r));
    const cc = Math.max(0, Math.min(colsRef.current.length - 1, c));
    setSel((prev) => (extend && prev ? { ...prev, fr: rr, fc: cc } : { ar: rr, ac: cc, fr: rr, fc: cc }));
    scrollIntoView(rr, cc);
  }, [scrollIntoView]);

  const commitEdit = useCallback((value: string, move: 'down' | 'right' | null) => {
    setEditing((cur) => {
      if (!cur) return null;
      const row = rowsRef.current[cur.r];
      const col = colsRef.current[cur.c];
      if (row && col && (row.cells[col.id] ?? '') !== value) {
        apply([{ rowId: row.id, colId: col.id, value }]);
      }
      if (move === 'down') moveTo(cur.r + 1, cur.c);
      else if (move === 'right') moveTo(cur.r, cur.c + 1);
      return null;
    });
  }, [apply, moveTo]);

  /* ── clipboard ── */
  const copySelection = useCallback(async (cut: boolean) => {
    if (!sel) return;
    const n = norm(sel);
    const lines: string[] = [];
    const cleared: CellChange[] = [];
    for (let r = n.r1; r <= n.r2; r++) {
      const cells: string[] = [];
      for (let c = n.c1; c <= n.c2; c++) {
        const row = rows[r];
        const col = columns[c];
        if (!row || !col) { cells.push(''); continue; }
        cells.push(row.cells[col.id] ?? '');
        if (cut && canEdit) cleared.push({ rowId: row.id, colId: col.id, value: '' });
      }
      lines.push(cells.join('\t'));
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      onStatus?.(cut ? 'Cut' : `Copied ${(n.r2 - n.r1 + 1) * (n.c2 - n.c1 + 1)} cells`);
      if (cut && cleared.length) apply(cleared);
    } catch {
      onStatus?.('Clipboard blocked by the browser');
    }
  }, [sel, rows, columns, canEdit, apply, onStatus]);

  const pasteAt = useCallback(async (text: string) => {
    if (!sel || !canEdit) return;
    const n = norm(sel);
    const grid = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map((l) => l.split('\t'));
    while (grid.length && grid[grid.length - 1].every((v) => v === '')) grid.pop();
    if (!grid.length) return;

    // Extend the sheet when the paste runs past the last row.
    const needed = n.r1 + grid.length - rowsRef.current.length;
    let workingRows = rowsRef.current;
    if (needed > 0) {
      const capped = Math.min(needed, 200);
      onStatus?.(`Adding ${capped} row${capped === 1 ? '' : 's'}…`);
      const newIds = await onAddRows(capped);
      if (!newIds.length) { onStatus?.('Could not add rows for the paste'); return; }
      workingRows = rowsRef.current;
    }

    const changes: CellChange[] = [];
    for (let i = 0; i < grid.length; i++) {
      const row = workingRows[n.r1 + i];
      if (!row) break;
      for (let j = 0; j < grid[i].length; j++) {
        const col = columns[n.c1 + j];
        if (!col) break;
        changes.push({ rowId: row.id, colId: col.id, value: grid[i][j] });
      }
    }
    apply(changes);
    setSel({ ar: n.r1, ac: n.c1, fr: n.r1 + grid.length - 1, fc: n.c1 + (grid[0]?.length ?? 1) - 1 });
    onStatus?.(`Pasted ${changes.length} cells`);
  }, [sel, canEdit, columns, apply, onAddRows, onStatus]);

  /* ── keyboard ── */
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey;

    if (editing) {
      if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
      else if (e.key === 'Enter') { e.preventDefault(); commitEdit(editing.value, 'down'); }
      else if (e.key === 'Tab') { e.preventDefault(); commitEdit(editing.value, 'right'); }
      return;
    }
    if (!sel) return;

    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (meta && e.key.toLowerCase() === 'c') { e.preventDefault(); void copySelection(false); return; }
    if (meta && e.key.toLowerCase() === 'x') { e.preventDefault(); void copySelection(true); return; }
    if (meta && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSel({ ar: 0, ac: 0, fr: rows.length - 1, fc: columns.length - 1 });
      return;
    }

    const { fr, fc } = sel;
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); moveTo(fr - 1, fc, e.shiftKey); return;
      case 'ArrowDown': e.preventDefault(); moveTo(fr + 1, fc, e.shiftKey); return;
      case 'ArrowLeft': e.preventDefault(); moveTo(fr, fc - 1, e.shiftKey); return;
      case 'ArrowRight': e.preventDefault(); moveTo(fr, fc + 1, e.shiftKey); return;
      case 'Tab': e.preventDefault(); moveTo(fr, fc + (e.shiftKey ? -1 : 1)); return;
      case 'Enter':
        e.preventDefault();
        if (canEdit) {
          const row = rows[fr]; const col = columns[fc];
          if (row && col) setEditing({ r: fr, c: fc, value: row.cells[col.id] ?? '' });
        }
        return;
      case 'Home': e.preventDefault(); moveTo(fr, 0, e.shiftKey); return;
      case 'End': e.preventDefault(); moveTo(fr, columns.length - 1, e.shiftKey); return;
      case 'PageDown': e.preventDefault(); moveTo(fr + Math.floor(viewportH / rowH), fc, e.shiftKey); return;
      case 'PageUp': e.preventDefault(); moveTo(fr - Math.floor(viewportH / rowH), fc, e.shiftKey); return;
      case 'Delete':
      case 'Backspace': {
        if (!canEdit) return;
        e.preventDefault();
        const n = norm(sel);
        const changes: CellChange[] = [];
        for (let r = n.r1; r <= n.r2; r++) {
          for (let c = n.c1; c <= n.c2; c++) {
            const row = rows[r]; const col = columns[c];
            if (row && col && (row.cells[col.id] ?? '') !== '') changes.push({ rowId: row.id, colId: col.id, value: '' });
          }
        }
        apply(changes);
        onStatus?.(`Cleared ${changes.length} cell${changes.length === 1 ? '' : 's'}`);
        return;
      }
      default: break;
    }

    // Type to start editing, the way a spreadsheet does.
    if (canEdit && e.key.length === 1 && !meta && !e.altKey) {
      e.preventDefault();
      setEditing({ r: fr, c: fc, value: e.key });
    }
  }, [editing, sel, rows, columns, canEdit, moveTo, commitEdit, copySelection, apply, undo, redo, viewportH, rowH, onStatus]);

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    if (editing || !canEdit) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    void pasteAt(text);
  }, [editing, canEdit, pasteAt]);

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editing]);

  /* ── column resize ── */
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const next = Math.max(MIN_COL_W, Math.min(MAX_COL_W, resizing.startW + (e.clientX - resizing.startX)));
      onColumnsChange(colsRef.current.map((c) => (c.id === resizing.colId ? { ...c, width: next } : c)));
    };
    const onUp = () => setResizing(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing, onColumnsChange]);

  /* ── mouse selection ── */
  useEffect(() => {
    if (!dragSel) return;
    const onUp = () => setDragSel(false);
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [dragSel]);

  const selNorm = sel ? norm(sel) : null;
  const selectionCount = selNorm ? (selNorm.r2 - selNorm.r1 + 1) * (selNorm.c2 - selNorm.c1 + 1) : 0;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div
        ref={scrollRef}
        tabIndex={0}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        className="flex-1 min-h-0 overflow-auto outline-none bg-card border border-border rounded-md"
        role="grid"
        aria-rowcount={rows.length}
        aria-colcount={columns.length}
      >
        <div style={{ width: totalWidth, position: 'relative' }}>
          {/* ── Header: letter strip + labels ── */}
          <div className="sticky top-0 z-30 bg-card">
            {/* letters */}
            <div className="flex h-[22px] border-b border-border">
              <div
                className="sticky left-0 z-20 bg-muted/60 border-r border-border shrink-0"
                style={{ width: GUTTER_W }}
              />
              {columns.map((c, i) => (
                <div
                  key={`L-${c.id}`}
                  className={cn(
                    'shrink-0 bg-muted/60 border-r border-border text-center text-[10px] font-medium text-muted-foreground leading-[22px] select-none',
                    c.frozen && 'sticky z-20',
                  )}
                  style={{ width: widths[i], ...(c.frozen ? { left: frozenOffsets[i] } : {}) }}
                >
                  {colLetter(i)}
                </div>
              ))}
            </div>
            {/* labels */}
            <div className="flex h-[30px] border-b border-border">
              <div
                className="sticky left-0 z-20 bg-muted/40 border-r border-border shrink-0 text-[10px] text-muted-foreground flex items-center justify-center"
                style={{ width: GUTTER_W }}
              >
                #
              </div>
              {columns.map((c, i) => (
                <div
                  key={`H-${c.id}`}
                  className={cn(
                    'relative shrink-0 bg-muted/40 border-r border-border px-2 flex items-center text-[12px] font-semibold truncate',
                    c.frozen && 'sticky z-20',
                    isNumericFormat(c.format) && 'justify-end',
                  )}
                  style={{ width: widths[i], ...(c.frozen ? { left: frozenOffsets[i] } : {}) }}
                  title={c.label}
                >
                  <span className="truncate">{c.label}</span>
                  {canEditColumns && (
                    <span
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setResizing({ colId: c.id, startX: e.clientX, startW: widths[i] });
                      }}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/60"
                      title="Drag to resize"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Rows (windowed) ── */}
          <div style={{ height: rows.length * rowH, position: 'relative' }}>
            {visibleRows.map(({ row, index: r }) => (
              <div
                key={row.id}
                className="absolute left-0 flex"
                style={{ top: r * rowH, height: rowH, width: totalWidth }}
              >
                <div
                  className={cn(
                    'sticky left-0 z-10 shrink-0 border-r border-b border-border bg-muted/30 text-[10.5px] text-muted-foreground flex items-center justify-center select-none',
                    selNorm && r >= selNorm.r1 && r <= selNorm.r2 && 'bg-primary/10 text-foreground font-medium',
                  )}
                  style={{ width: GUTTER_W }}
                  onMouseDown={() => setSel({ ar: r, ac: 0, fr: r, fc: columns.length - 1 })}
                >
                  {r + 1}
                </div>

                {columns.map((c, ci) => {
                  const raw = row.cells[c.id] ?? '';
                  const isEditing = editing?.r === r && editing?.c === ci;
                  const selected = sel ? inSel(sel, r, ci) : false;
                  const isFocus = sel?.fr === r && sel?.fc === ci;
                  const hit = matches(raw);

                  return (
                    <div
                      key={c.id}
                      role="gridcell"
                      onMouseDown={(e) => {
                        if (isEditing) return;
                        e.preventDefault();
                        scrollRef.current?.focus();
                        if (e.shiftKey && sel) setSel({ ...sel, fr: r, fc: ci });
                        else { setSel({ ar: r, ac: ci, fr: r, fc: ci }); setDragSel(true); }
                      }}
                      onMouseEnter={() => { if (dragSel) setSel((p) => (p ? { ...p, fr: r, fc: ci } : p)); }}
                      onDoubleClick={() => { if (canEdit) setEditing({ r, c: ci, value: raw }); }}
                      className={cn(
                        'relative shrink-0 border-r border-b border-border px-2 flex items-center text-[12.5px] overflow-hidden',
                        c.frozen && 'sticky z-10 bg-card',
                        !c.frozen && 'bg-card',
                        selected && !isFocus && 'bg-primary/10',
                        isFocus && 'ring-2 ring-primary ring-inset z-20',
                        hit && !selected && 'bg-amber-100 dark:bg-amber-500/20',
                        isNumericFormat(c.format) && 'justify-end tabular-nums',
                      )}
                      style={{ width: widths[ci], ...(c.frozen ? { left: frozenOffsets[ci] } : {}) }}
                    >
                      {isEditing ? (
                        <input
                          ref={editRef}
                          value={editing!.value}
                          onChange={(e) => setEditing({ r, c: ci, value: e.target.value })}
                          onBlur={() => commitEdit(editing!.value, null)}
                          className="absolute inset-0 w-full h-full px-2 text-[12.5px] bg-card border-2 border-primary outline-none z-30"
                        />
                      ) : (
                        <span className="truncate w-full" title={raw || undefined}>
                          {formatCell(raw, c.format)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Status bar ── */}
      <div className="flex items-center gap-4 px-2 py-1 text-[11px] text-muted-foreground border-x border-b border-border rounded-b-md bg-muted/20">
        <span>{rows.length.toLocaleString()} rows · {columns.length} columns</span>
        {selNorm && selectionCount > 1 && <span>{selectionCount.toLocaleString()} cells selected</span>}
        {selNorm && selectionCount === 1 && (
          <span>{colLetter(selNorm.c1)}{selNorm.r1 + 1}</span>
        )}
        <SelectionMath rows={rows} columns={columns} sel={selNorm} />
        <span className="ml-auto hidden md:inline">
          Enter edit · Tab next · Ctrl/⌘+C copy · Ctrl/⌘+V paste · Ctrl/⌘+Z undo
        </span>
      </div>
    </div>
  );
}

/**
 * Sum and average of the numeric cells in the selection — the status-bar
 * readout every spreadsheet user reaches for without thinking.
 */
function SelectionMath({
  rows, columns, sel,
}: {
  rows: GridRow[];
  columns: GridColumn[];
  sel: { r1: number; r2: number; c1: number; c2: number } | null;
}) {
  if (!sel) return null;
  const nums: number[] = [];
  for (let r = sel.r1; r <= sel.r2; r++) {
    for (let c = sel.c1; c <= sel.c2; c++) {
      const raw = rows[r]?.cells[columns[c]?.id] ?? '';
      const v = Number(String(raw).replace(/[$,\s%]/g, ''));
      if (raw.trim() && Number.isFinite(v)) nums.push(v);
    }
  }
  if (nums.length < 2) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return (
    <span className="tabular-nums">
      Sum {sum.toLocaleString('en-US', { maximumFractionDigits: 2 })} · Avg{' '}
      {(sum / nums.length).toLocaleString('en-US', { maximumFractionDigits: 2 })} · Count {nums.length}
    </span>
  );
}
