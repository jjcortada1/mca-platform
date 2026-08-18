'use client';
/**
 * Worksheets — Google-Sheets-style personal tracking, fully separate from
 * deals/funded volume (nothing here feeds any analytics).
 *
 * Editing reliability (the part that MUST never lose data):
 *  - Every keystroke marks the row dirty and schedules a debounced save
 *    (700ms); blur and Enter save immediately. Saves read the LATEST state
 *    via a ref, never a render-time closure.
 *  - Failed saves show an error toast and keep the row dirty for retry.
 *  - The background auto-refresh NEVER runs while any row is dirty, a save
 *    is in flight, or a drag is in progress, so it can't clobber edits.
 *
 * Sheets behaviors:
 *  - Drag the grip on a row number to reorder rows; the order persists.
 *  - Double-click a row (or click its chevron) to expand it INLINE beneath
 *    itself — every column as a labeled field — and collapse it again.
 *  - Import from Google Sheets / Excel / CSV with column mapping and
 *    append-or-overwrite modes. Column edges drag to resize.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PageHeader, Card, Button, Input, Field, Badge, EmptyState, TableSkeleton, Select, Textarea,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-provider';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import { cn } from '@/lib/utils';
import { SheetGrid, ROW_HEIGHTS, DEFAULT_COL_WIDTH as GRID_COL_WIDTH } from '@/components/worksheets/grid';
import type { GridColumn, CellChange, RowHeight } from '@/components/worksheets/grid';
import {
  Plus, Table2, Share2, Settings2, Trash2, X, ChevronRight,
  Users as UsersIcon, GripVertical, Upload, FileSpreadsheet, Copy,
} from 'lucide-react';

interface Col {
  id: string;
  label: string;
  width?: number;
  /** Display format. Presentational only — cell text is never rewritten. */
  format?: 'text' | 'number' | 'currency' | 'percent' | 'date';
  /** Freeze to the left while scrolling horizontally. */
  frozen?: boolean;
}
interface SheetMeta { id: string; name: string; columns: Col[]; myRole: 'owner' | 'edit' | 'view'; ownerName: string | null }
interface RowData { id: string; cells: Record<string, string> }
interface SheetDetail { id: string; name: string; columns: Col[]; myRole: 'owner' | 'edit' | 'view'; rows: RowData[] }
interface ShareRow { id: string; email: string; role: string }

const DEFAULT_COL_WIDTH = 170;
const MAX_IMPORT_ROWS = 2000;

function newColId() {
  return 'c_' + Math.random().toString(36).slice(2, 8);
}
function normLabel(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Parsed state for the import flow (file already read client-side). */
interface ImportDraft {
  fileName: string;
  sheetNames: string[];
  sheetName: string;
  hasHeader: boolean;
  grid: string[][];
  /** file column index -> sheet column id, '__new__', or '__skip__' */
  mapping: Record<number, string>;
  mode: 'append' | 'overwrite';
}

/** Never shrink the sheet below this, even on a very short window. */
const MIN_GRID_H = 260;
/** Gap between the grid and the sheet-tab strip (Tailwind space-y-4 = 16px). */
const TABS_GAP = 16;

/**
 * Size the sheet so it fills the rest of the window, with the tab strip
 * sitting just under it.
 *
 * This replaces a hard-coded `calc(100vh - 320px)`. That number was wrong
 * the moment anything above the grid changed height — the toolbar wraps to
 * two or three lines on a laptop, the import and columns panels push it
 * down, and the mobile top bar and demo banner exist only sometimes. When
 * the guess ran long the page grew a scrollbar and the sheet became a short
 * box floating in a scrolling page, with the tab strip under the fold; when
 * it ran short there was dead space below the tabs.
 *
 * WHICH ELEMENT SCROLLS: the app shell is `min-h-screen`, not `h-screen`,
 * so <main> is never capped at the viewport — it grows to fit its content
 * and its `overflow-auto` never engages. The DOCUMENT is the scroller.
 * (Capping the shell would fix that globally but would also move every
 * page's scrollbar and break the sidebar's `sticky top-0` and the demo
 * banner, so this stays local to the sheet.)
 *
 * Measuring is scroll-INVARIANT on purpose. Deriving the height from the
 * live `getBoundingClientRect().top` would make the grid grow as the page
 * scrolls, which creates more page to scroll — it never settles. Adding the
 * scroll offsets back converts that to a document coordinate, which does
 * not move. Summing ancestor scrollTops as well means this stays correct if
 * the shell is ever changed to cap <main> after all.
 */
function useFillHeight(
  targetRef: React.RefObject<HTMLElement | null>,
  reserveRef: React.RefObject<HTMLElement | null>,
  active: boolean,
): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    let frame = 0;

    const measure = () => {
      const el = targetRef.current;
      if (!el) return;

      // Document-space top of the grid box.
      let scrolled = window.scrollY;
      for (let n: HTMLElement | null = el.parentElement; n; n = n.parentElement) {
        scrolled += n.scrollTop || 0;
      }
      const top = el.getBoundingClientRect().top + scrolled;

      // The tab strip lives below the grid and must stay on screen.
      const reserve = reserveRef.current
        ? reserveRef.current.getBoundingClientRect().height + TABS_GAP
        : 0;

      // The app's content column has responsive bottom padding (py-6 → py-9).
      // Read it instead of hard-coding, so nothing sits under the fold.
      let pad = 0;
      const column = el.closest('main > div');
      if (column instanceof HTMLElement) {
        pad = parseFloat(getComputedStyle(column).paddingBottom) || 0;
      }

      const next = Math.max(MIN_GRID_H, Math.round(window.innerHeight - top - reserve - pad));
      // Sizing the grid changes the page height, which re-fires the observer.
      // Ignoring sub-pixel deltas is what lets that settle instead of looping.
      setHeight((prev) => (prev !== null && Math.abs(prev - next) < 2 ? prev : next));
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('resize', schedule);

    // A wrapping toolbar or a newly opened panel moves the grid without ever
    // firing a window resize, so watch the elements themselves too.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (ro) {
      if (targetRef.current?.parentElement) ro.observe(targetRef.current.parentElement);
      if (reserveRef.current) ro.observe(reserveRef.current);
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
    };
  }, [targetRef, reserveRef, active]);

  return height;
}

export default function WorksheetsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [sheets, setSheets] = useState<SheetMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);

  const [detail, setDetail] = useState<SheetDetail | null>(null);
  const [loadingSheet, setLoadingSheet] = useState(false);

  /* The sheet fills the rest of the window, with the tab strip pinned just
     below it — measured rather than guessed. See useFillHeight above. */
  const gridBoxRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const gridHeight = useFillHeight(gridBoxRef, tabsRef, Boolean(detail) && !loadingSheet);

  // Panels
  const [showShare, setShowShare] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState<'view' | 'edit'>('view');
  const [colDraft, setColDraft] = useState<Col[]>([]);
  const [sheetNameDraft, setSheetNameDraft] = useState('');

  // Inline row expansion (double-click a row, or its chevron)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  /* Grid UI state. Row height is a single sheet-wide setting because the
     grid windows its rows, and windowing needs a known row height. */
  const [gridSearch, setGridSearch] = useState('');
  const [rowHeight, setRowHeight] = useState<RowHeight>('normal');
  const [gridStatus, setGridStatus] = useState('');
  const colSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Import flow
  const [importDraft, setImportDraft] = useState<ImportDraft | null>(null);
  const [importing, setImporting] = useState(false);
  const [parsingFile, setParsingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workbookRef = useRef<any>(null); // XLSX.WorkBook of the picked file
  const xlsxRef = useRef<any>(null); // the dynamically-imported xlsx module

  // Drag-to-reorder (rows)
  const dragFromRef = useRef<number | null>(null);
  const [dragArmed, setDragArmed] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Drag-to-reorder (sheet TABS — own sheets only; shared tabs stay put)
  const tabDragFromRef = useRef<number | null>(null);
  const [tabDragOver, setTabDragOver] = useState<number | null>(null);

  // Drag-to-reorder (columns inside the Columns panel)
  const colDragFromRef = useRef<number | null>(null);
  const [colDragOver, setColDragOver] = useState<number | null>(null);

  // ---- Refs that make saving race-proof ----
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const detailRef = useRef<SheetDetail | null>(null);
  detailRef.current = detail;
  // Rows with unsaved edits + in-flight saves. Auto-refresh checks these.
  const dirtyRowsRef = useRef<Set<string>>(new Set());
  const savingRef = useRef(0);
  const saveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const loadList = useCallback(async (pickFirst = false) => {
    try {
      const res = await fetch('/api/worksheets', { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) return;
      const list: SheetMeta[] = j.data ?? [];
      setSheets(list);
      const params = new URLSearchParams(window.location.search);
      const want = params.get('sheet');
      if (pickFirst) {
        const target = (want && list.find((s) => s.id === want)?.id) || list[0]?.id || null;
        setActiveId(target);
      } else if (activeIdRef.current && !list.some((s) => s.id === activeIdRef.current)) {
        setActiveId(list[0]?.id ?? null);
      }
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadSheet = useCallback(async (id: string, silent = false) => {
    if (!silent) setLoadingSheet(true);
    try {
      const res = await fetch(`/api/worksheets/${id}`, { cache: 'no-store' });
      const j = await res.json();
      if (res.ok && j.data && activeIdRef.current === id) {
        // Never clobber unsaved local edits with server state.
        if (silent && (dirtyRowsRef.current.size > 0 || savingRef.current > 0)) return;
        setDetail(j.data);
        setSheetNameDraft(j.data.name);
      }
    } finally {
      setLoadingSheet(false);
    }
  }, []);

  useEffect(() => { loadList(true); }, [loadList]);
  useEffect(() => {
    if (activeId) {
      setShowShare(false); setShowColumns(false); setExpandedRowId(null); setImportDraft(null);
      dirtyRowsRef.current.clear();
      loadSheet(activeId);
    } else {
      setDetail(null);
    }
  }, [activeId, loadSheet]);

  // Background sync — paused entirely while anything is dirty, saving, or dragging.
  useAutoRefresh(() => {
    if (dirtyRowsRef.current.size > 0 || savingRef.current > 0 || dragFromRef.current !== null) return;
    loadList();
    if (activeIdRef.current) loadSheet(activeIdRef.current, true);
  }, { intervalMs: 45_000 });

  // Flush pending edits when leaving the page (best-effort keepalive).
  useEffect(() => {
    function flushAll() {
      const d = detailRef.current;
      if (!d) return;
      for (const rowId of Array.from(dirtyRowsRef.current)) {
        const row = d.rows.find((r) => r.id === rowId);
        if (!row) continue;
        try {
          navigator.sendBeacon?.(
            `/api/worksheets/${d.id}/rows/${rowId}?beacon=1`,
            new Blob([JSON.stringify({ cells: row.cells })], { type: 'application/json' })
          );
        } catch { /* best-effort */ }
      }
    }
    window.addEventListener('pagehide', flushAll);
    return () => window.removeEventListener('pagehide', flushAll);
  }, []);

  const canEdit = detail?.myRole === 'owner' || detail?.myRole === 'edit';
  const isOwner = detail?.myRole === 'owner';

  /* ---------- sheet CRUD ---------- */

  async function createSheet() {
    const n = sheets.filter((s) => s.myRole === 'owner').length + 1;
    const res = await fetch('/api/worksheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Sheet ${n}` }),
    });
    const j = await res.json();
    if (!res.ok) { toast.error(j.error || 'Could not create the sheet.'); return; }
    await loadList();
    setActiveId(j.data.id);
    toast.success('Sheet created — rename it in the box above the grid.');
  }

  async function renameSheet() {
    if (!detail || !sheetNameDraft.trim() || sheetNameDraft.trim() === detail.name) return;
    const res = await fetch(`/api/worksheets/${detail.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: sheetNameDraft.trim() }),
    });
    if (res.ok) { toast.success('Sheet renamed.'); loadList(); }
  }

  async function deleteSheet() {
    if (!detail) return;
    const ok = await confirm({
      title: `Delete "${detail.name}"?`,
      description: 'The sheet, its rows, and its shares are removed. This does not touch any deals or funded data.',
      confirmLabel: 'Delete sheet',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/worksheets/${detail.id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Sheet deleted.'); setActiveId(null); loadList(true); }
  }

  /* ---------- rows: race-proof editing ---------- */

  async function addRow() {
    if (!detail) return;
    const res = await fetch(`/api/worksheets/${detail.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cells: {} }),
    });
    const j = await res.json();
    if (!res.ok) { toast.error(j.error || 'Could not add a row.'); return; }
    setDetail((d) => d ? { ...d, rows: [...d.rows, j.data] } : d);
  }

  /**
   * Apply a batch of cell edits from the grid.
   *
   * Routed through the SAME dirty-tracking + debounced save path the sheet
   * already used, so a paste of 200 cells still can't be clobbered by a
   * background refresh and still saves one request per row.
   */
  function applyCellChanges(changes: CellChange[]) {
    if (!changes.length) return;
    setDetail((d) => {
      if (!d) return d;
      const byRow = new Map<string, Record<string, string>>();
      for (const ch of changes) {
        const patch = byRow.get(ch.rowId) ?? {};
        patch[ch.colId] = ch.value;
        byRow.set(ch.rowId, patch);
      }
      return {
        ...d,
        rows: d.rows.map((r) => (byRow.has(r.id) ? { ...r, cells: { ...r.cells, ...byRow.get(r.id)! } } : r)),
      };
    });
    const timers = saveTimersRef.current;
    for (const rowId of new Set(changes.map((c) => c.rowId))) {
      dirtyRowsRef.current.add(rowId);
      const existing = timers.get(rowId);
      if (existing) clearTimeout(existing);
      timers.set(rowId, setTimeout(() => saveRowNow(rowId), 700));
    }
  }

  /** Create n rows and resolve with their ids, so a paste can overflow. */
  async function addRows(n: number): Promise<string[]> {
    const d = detailRef.current;
    if (!d || n <= 0) return [];
    const ids: string[] = [];
    const created: RowData[] = [];
    for (let i = 0; i < n; i++) {
      const res = await fetch(`/api/worksheets/${d.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cells: {} }),
      });
      if (!res.ok) break;
      const j = await res.json();
      if (!j?.data?.id) break;
      created.push(j.data);
      ids.push(j.data.id);
    }
    if (created.length) setDetail((cur) => (cur ? { ...cur, rows: [...cur.rows, ...created] } : cur));
    if (ids.length < n) toast.error('Some rows could not be added — paste may be truncated.');
    return ids;
  }

  async function deleteRows(rowIds: string[]) {
    const d = detailRef.current;
    if (!d || !rowIds.length) return;
    const ok = await confirm({
      title: rowIds.length === 1 ? 'Delete this row?' : `Delete ${rowIds.length} rows?`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    for (const rowId of rowIds) {
      const res = await fetch(`/api/worksheets/${d.id}/rows/${rowId}`, { method: 'DELETE' });
      if (res.ok) dirtyRowsRef.current.delete(rowId);
    }
    setDetail((cur) => (cur ? { ...cur, rows: cur.rows.filter((r) => !rowIds.includes(r.id)) } : cur));
  }

  /**
   * Column geometry / format changes. Only the owner may persist them (the
   * API enforces this too), so for an editor the change stays local to the
   * session rather than failing with a 403 on every drag.
   */
  function applyColumnChange(next: GridColumn[]) {
    setDetail((d) => (d ? { ...d, columns: next as Col[] } : d));
    const d = detailRef.current;
    if (!d || d.myRole !== 'owner') return;
    if (colSaveTimerRef.current) clearTimeout(colSaveTimerRef.current);
    colSaveTimerRef.current = setTimeout(() => {
      fetch(`/api/worksheets/${d.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns: (detailRef.current?.columns ?? next) }),
      }).catch(() => { /* width/format is cosmetic; a failed save retries on the next change */ });
    }, 600);
  }

  /** Update a cell locally, mark the row dirty, and schedule a debounced save. */
  function setCell(rowId: string, colId: string, value: string) {
    setDetail((d) => d ? {
      ...d,
      rows: d.rows.map((r) => r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: value } } : r),
    } : d);
    dirtyRowsRef.current.add(rowId);
    const timers = saveTimersRef.current;
    const existing = timers.get(rowId);
    if (existing) clearTimeout(existing);
    timers.set(rowId, setTimeout(() => saveRowNow(rowId), 700));
  }

  /** Save a row using the LATEST state (ref), with visible failure. */
  async function saveRowNow(rowId: string) {
    const d = detailRef.current;
    if (!d) return;
    const row = d.rows.find((r) => r.id === rowId);
    if (!row) { dirtyRowsRef.current.delete(rowId); return; }
    const timers = saveTimersRef.current;
    const t = timers.get(rowId);
    if (t) { clearTimeout(t); timers.delete(rowId); }

    savingRef.current += 1;
    try {
      const res = await fetch(`/api/worksheets/${d.id}/rows/${rowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cells: row.cells }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || 'Could not save — your edit is still on screen, try again.');
        return; // stays dirty so refresh won't clobber and a retry can save
      }
      // Only clear dirty if no NEWER edit arrived while we were saving.
      if (!saveTimersRef.current.has(rowId)) dirtyRowsRef.current.delete(rowId);
    } catch {
      toast.error('Network error while saving — your edit is still on screen, try again.');
    } finally {
      savingRef.current -= 1;
    }
  }

  async function deleteRow(rowId: string) {
    if (!detail) return;
    const ok = await confirm({ title: 'Delete this row?', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    const res = await fetch(`/api/worksheets/${detail.id}/rows/${rowId}`, { method: 'DELETE' });
    if (res.ok) {
      dirtyRowsRef.current.delete(rowId);
      if (expandedRowId === rowId) setExpandedRowId(null);
      setDetail((d) => d ? { ...d, rows: d.rows.filter((r) => r.id !== rowId) } : d);
    }
  }

  /* ---------- drag-to-reorder rows ---------- */

  function onRowDragStart(e: React.DragEvent, index: number) {
    dragFromRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(index)); } catch { /* older browsers */ }
  }

  function onRowDragOver(e: React.DragEvent, index: number) {
    if (dragFromRef.current === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver !== index) setDragOver(index);
  }

  function onRowDragEnd() {
    dragFromRef.current = null;
    setDragArmed(null);
    setDragOver(null);
  }

  async function onRowDrop(e: React.DragEvent, index: number) {
    e.preventDefault();
    const from = dragFromRef.current;
    onRowDragEnd();
    const d = detailRef.current;
    if (from === null || from === index || !d) return;
    const rows = [...d.rows];
    const [moved] = rows.splice(from, 1);
    rows.splice(index, 0, moved);
    setDetail((cur) => cur ? { ...cur, rows } : cur);
    // Persist the full order — GET returns rows by sort_order, so this
    // sticks for everyone the sheet is shared with.
    savingRef.current += 1;
    try {
      const res = await fetch(`/api/worksheets/${d.id}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIds: rows.map((r) => r.id) }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || 'Could not save the new row order — it may reset on refresh.');
      }
    } catch {
      toast.error('Network error saving the row order — it may reset on refresh.');
    } finally {
      savingRef.current -= 1;
    }
  }

  /* ---------- column resizing (drag the header edge) ---------- */

  const resizeRef = useRef<{ colId: string; startX: number; startW: number } | null>(null);

  function startResize(e: React.MouseEvent, col: Col) {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { colId: col.id, startX: e.clientX, startW: col.width ?? DEFAULT_COL_WIDTH };
    const onMove = (ev: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const w = Math.max(70, Math.min(1000, r.startW + (ev.clientX - r.startX)));
      setDetail((d) => d ? {
        ...d,
        columns: d.columns.map((c) => c.id === r.colId ? { ...c, width: w } : c),
      } : d);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const r = resizeRef.current;
      resizeRef.current = null;
      // Persist widths on sheets you own (viewers/editors keep it local).
      const d = detailRef.current;
      if (r && d && d.myRole === 'owner') {
        fetch(`/api/worksheets/${d.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ columns: d.columns.map((c) => ({ id: c.id, label: c.label, width: Math.round(c.width ?? DEFAULT_COL_WIDTH) })) }),
        }).catch(() => {});
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /* ---------- sharing ---------- */

  async function openShare() {
    if (!detail) return;
    setShowShare((v) => !v);
    setShowColumns(false);
    setImportDraft(null);
    const res = await fetch(`/api/worksheets/${detail.id}/shares`, { cache: 'no-store' });
    const j = await res.json();
    if (res.ok) setShares(j.data ?? []);
  }

  async function addShare() {
    if (!detail) return;
    if (!shareEmail.trim().includes('@')) { toast.error('Enter a valid email.'); return; }
    const res = await fetch(`/api/worksheets/${detail.id}/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: shareEmail, role: shareRole }),
    });
    const j = await res.json();
    if (!res.ok) { toast.error(j.error || 'Could not share.'); return; }
    toast.success(`Shared with ${shareEmail.trim()} (${shareRole === 'edit' ? 'can edit' : 'view only'}).`);
    setShareEmail('');
    setShares((arr) => {
      const existing = arr.find((s) => s.email === j.data.email);
      if (existing) return arr.map((s) => s.email === j.data.email ? { ...s, role: j.data.role } : s);
      return [...arr, j.data];
    });
  }

  async function removeShare(share: ShareRow) {
    if (!detail) return;
    const res = await fetch(`/api/worksheets/${detail.id}/shares?shareId=${share.id}`, { method: 'DELETE' });
    if (res.ok) setShares((arr) => arr.filter((s) => s.id !== share.id));
  }

  /* ---------- columns panel ---------- */

  function openColumns() {
    if (!detail) return;
    setShowColumns((v) => !v);
    setShowShare(false);
    setImportDraft(null);
    setColDraft(detail.columns.map((c) => ({ ...c })));
  }

  async function saveColumns() {
    if (!detail) return;
    const cleaned = colDraft.filter((c) => c.label.trim())
      .map((c) => ({ id: c.id, label: c.label.trim(), ...(c.width ? { width: Math.round(c.width) } : {}) }));
    if (!cleaned.length) { toast.error('Keep at least one column.'); return; }
    const res = await fetch(`/api/worksheets/${detail.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns: cleaned }),
    });
    const j = await res.json();
    if (!res.ok) { toast.error(j.error || 'Could not save columns.'); return; }
    toast.success('Columns saved.');
    setShowColumns(false);
    setDetail((d) => d ? { ...d, columns: cleaned } : d);
    loadList();
  }

  /* ---------- import from Google Sheets / Excel / CSV ---------- */

  async function handleImportFile(file: File) {
    if (!detail) return;
    setParsingFile(true);
    try {
      const XLSX = await import('xlsx');
      xlsxRef.current = XLSX;
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      workbookRef.current = wb;
      const sheetNames = wb.SheetNames ?? [];
      if (!sheetNames.length) { toast.error('That file has no sheets in it.'); return; }
      const draft = buildDraftForSheet(wb, sheetNames[0], true, file.name, sheetNames);
      if (!draft) { toast.error('That sheet looks empty — nothing to import.'); return; }
      setImportDraft(draft);
      setShowShare(false); setShowColumns(false);
    } catch {
      toast.error('Could not read that file. Export it as .xlsx or .csv and try again.');
    } finally {
      setParsingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  /** Parse one tab of the workbook into a grid + an auto column mapping. */
  function buildDraftForSheet(
    wb: any, sheetName: string, hasHeader: boolean, fileName: string, sheetNames: string[]
  ): ImportDraft | null {
    const d = detailRef.current;
    if (!d || !xlsxRef.current) return null;
    const ws = wb.Sheets[sheetName];
    if (!ws) return null;
    // sheet_to_json with header:1 → array-of-arrays; raw:false keeps dates
    // and numbers as the formatted text the user sees in Sheets/Excel.
    const grid: string[][] = xlsxRef.current.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
      .map((r: any[]) => r.map((v) => (v == null ? '' : String(v))));
    if (!grid.length) return null;
    return {
      fileName, sheetNames, sheetName, hasHeader, grid,
      mapping: buildAutoMapping(grid, hasHeader, d.columns, d.myRole === 'owner'),
      mode: 'append',
    };
  }

  /** Match file headers to sheet columns by name; unmatched become new columns (owner) or are skipped. */
  function buildAutoMapping(grid: string[][], hasHeader: boolean, cols: Col[], owner: boolean): Record<number, string> {
    const width = Math.max(...grid.map((r) => r.length), 0);
    const headers = hasHeader ? (grid[0] ?? []) : [];
    const byLabel = new Map(cols.map((c) => [normLabel(c.label), c.id]));
    const used = new Set<string>();
    const mapping: Record<number, string> = {};
    for (let i = 0; i < width; i++) {
      const h = normLabel(headers[i] ?? '');
      const match = h && byLabel.get(h);
      if (match && !used.has(match)) {
        mapping[i] = match;
        used.add(match);
      } else if (owner) {
        mapping[i] = '__new__';
      } else {
        // Editors can't add columns; fall back to unclaimed columns in order.
        const free = cols.find((c) => !used.has(c.id));
        if (free && !hasHeader) { mapping[i] = free.id; used.add(free.id); }
        else mapping[i] = '__skip__';
      }
    }
    return mapping;
  }

  function switchImportSheet(sheetName: string) {
    const wb = workbookRef.current;
    const cur = importDraft;
    if (!wb || !cur) return;
    const draft = buildDraftForSheet(wb, sheetName, cur.hasHeader, cur.fileName, cur.sheetNames);
    if (draft) setImportDraft({ ...draft, mode: cur.mode });
    else toast.error('That tab looks empty.');
  }

  function toggleImportHeader(hasHeader: boolean) {
    const cur = importDraft;
    const d = detailRef.current;
    if (!cur || !d) return;
    setImportDraft({
      ...cur, hasHeader,
      mapping: buildAutoMapping(cur.grid, hasHeader, d.columns, d.myRole === 'owner'),
    });
  }

  const importStats = useMemo(() => {
    if (!importDraft || !detail) return null;
    const dataRows = importDraft.hasHeader ? importDraft.grid.slice(1) : importDraft.grid;
    const width = Math.max(...importDraft.grid.map((r) => r.length), 0);
    const mappedIdx = Array.from({ length: width }, (_, i) => i)
      .filter((i) => importDraft.mapping[i] && importDraft.mapping[i] !== '__skip__');
    const nonEmpty = dataRows.filter((r) => mappedIdx.some((i) => (r[i] ?? '').trim() !== ''));
    const newCols = mappedIdx.filter((i) => importDraft.mapping[i] === '__new__').length;
    return { width, dataRows, nonEmpty, mappedCount: mappedIdx.length, newCols };
  }, [importDraft, detail]);

  async function runImport() {
    const d = detailRef.current;
    if (!d || !importDraft || !importStats) return;
    if (!importStats.mappedCount) { toast.error('Map at least one column before importing.'); return; }
    if (!importStats.nonEmpty.length) { toast.error('No rows with data to import.'); return; }
    if (importStats.nonEmpty.length > MAX_IMPORT_ROWS) {
      toast.error(`That's ${importStats.nonEmpty.length.toLocaleString()} rows — the limit per import is ${MAX_IMPORT_ROWS.toLocaleString()}. Split the file and import in parts.`);
      return;
    }
    if (importDraft.mode === 'overwrite') {
      const ok = await confirm({
        title: 'Overwrite this sheet\'s rows?',
        description: `All ${d.rows.length} existing row${d.rows.length === 1 ? '' : 's'} on "${d.name}" will be replaced by the ${importStats.nonEmpty.length} imported row${importStats.nonEmpty.length === 1 ? '' : 's'}. Only this sheet is affected — nothing else in the system is touched.`,
        confirmLabel: 'Overwrite rows',
        destructive: true,
      });
      if (!ok) return;
    }

    // Build new columns (owner only) and the index→column-id mapping.
    const headers = importDraft.hasHeader ? (importDraft.grid[0] ?? []) : [];
    const finalMap: Record<number, string> = {};
    const newCols: Col[] = [];
    for (let i = 0; i < importStats.width; i++) {
      const m = importDraft.mapping[i];
      if (!m || m === '__skip__') continue;
      if (m === '__new__') {
        const id = newColId();
        newCols.push({ id, label: (headers[i] ?? '').trim() || `Column ${i + 1}` });
        finalMap[i] = id;
      } else {
        finalMap[i] = m;
      }
    }
    const columnsPayload = newCols.length
      ? [...d.columns.map((c) => ({ id: c.id, label: c.label, ...(c.width ? { width: Math.round(c.width) } : {}) })), ...newCols]
      : undefined;

    const rowsPayload = importStats.nonEmpty.map((r) => {
      const cells: Record<string, string> = {};
      for (const [idxStr, colId] of Object.entries(finalMap)) {
        const v = (r[Number(idxStr)] ?? '').toString().slice(0, 4000);
        if (v !== '') cells[colId] = v;
      }
      return cells;
    });

    setImporting(true);
    try {
      const res = await fetch(`/api/worksheets/${d.id}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: importDraft.mode, ...(columnsPayload ? { columns: columnsPayload } : {}), rows: rowsPayload }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(j.error || 'Import failed — nothing was changed.'); return; }
      toast.success(`Imported ${rowsPayload.length.toLocaleString()} row${rowsPayload.length === 1 ? '' : 's'} from ${importDraft.fileName}.`);
      setImportDraft(null);
      workbookRef.current = null;
      await loadSheet(d.id);
      loadList();
    } catch {
      toast.error('Network error during import — check the sheet before retrying.');
    } finally {
      setImporting(false);
    }
  }

  const ownSheets = useMemo(() => sheets.filter((s) => s.myRole === 'owner'), [sheets]);
  const sharedSheets = useMemo(() => sheets.filter((s) => s.myRole !== 'owner'), [sheets]);

  /* ---------- sheet-tab drag reorder (own sheets) ---------- */

  async function dropTab(to: number) {
    const from = tabDragFromRef.current;
    tabDragFromRef.current = null;
    setTabDragOver(null);
    if (from === null || from === to) return;
    const own = [...ownSheets];
    const [moved] = own.splice(from, 1);
    own.splice(to, 0, moved);
    setSheets([...own, ...sharedSheets]);
    try {
      const res = await fetch('/api/worksheets/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetIds: own.map((s) => s.id) }),
      });
      if (!res.ok) toast.error('Could not save the tab order — it may reset on refresh.');
    } catch {
      toast.error('Network error saving the tab order.');
    }
  }

  /** Copy one cell's text to the clipboard. */
  async function copyCell(text: string, label: string) {
    if (!text) { toast.error(`${label} is empty — nothing to copy.`); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied.`);
    } catch {
      toast.error('Could not copy — your browser blocked clipboard access.');
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Worksheets"
        description="Your own sheets for tracking outside and co-brokered deals — completely separate from your funded deals and volume. Drag the grip to reorder rows, double-click a row to expand it, drag column edges to resize."
        actions={<Button onClick={createSheet}><Plus className="h-4 w-4" /> New sheet</Button>}
      />

      {loadingList ? (
        <TableSkeleton />
      ) : sheets.length === 0 ? (
        <EmptyState
          icon={Table2}
          title="No sheets yet"
          description="Create your first sheet — columns are fully customizable, and nothing here counts toward your funded numbers."
          action={<Button onClick={createSheet}><Plus className="h-4 w-4" /> New sheet</Button>}
        />
      ) : (
        <>

          {loadingSheet || !detail ? (
            <TableSkeleton />
          ) : (
            <div className="space-y-3">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                {isOwner ? (
                  <Input
                    value={sheetNameDraft}
                    onChange={(e) => setSheetNameDraft(e.target.value)}
                    onBlur={renameSheet}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="h-8 w-[220px] text-sm font-semibold"
                  />
                ) : (
                  <div className="text-sm font-semibold">{detail.name}</div>
                )}
                {!isOwner && (
                  <Badge className="bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400">
                    {detail.myRole === 'edit' ? 'Can edit' : 'View only'} · shared by {sheets.find((s) => s.id === detail.id)?.ownerName ?? 'owner'}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">{detail.rows.length} row{detail.rows.length === 1 ? '' : 's'}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  {canEdit && (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv,.tsv,.ods"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); }}
                      />
                      <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={parsingFile}>
                        <Upload className="h-3.5 w-3.5" /> {parsingFile ? 'Reading…' : 'Import'}
                      </Button>
                    </>
                  )}
                  {isOwner && (
                    <>
                      <Button size="sm" variant="outline" onClick={openShare}>
                        <Share2 className="h-3.5 w-3.5" /> Share
                      </Button>
                      <Button size="sm" variant="outline" onClick={openColumns}>
                        <Settings2 className="h-3.5 w-3.5" /> Columns
                      </Button>
                      <Button size="sm" variant="ghost" onClick={deleteSheet} title="Delete sheet">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Import panel */}
              {importDraft && importStats && canEdit && (
                <Card className="p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <FileSpreadsheet className="h-4 w-4 text-primary" /> Import “{importDraft.fileName}”
                    <button onClick={() => { setImportDraft(null); workbookRef.current = null; }} className="ml-auto p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground" title="Cancel import">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    {importDraft.sheetNames.length > 1 && (
                      <Field label="Tab" className="w-[180px]">
                        <Select className="h-9" value={importDraft.sheetName} onChange={(e) => switchImportSheet(e.target.value)}>
                          {importDraft.sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
                        </Select>
                      </Field>
                    )}
                    <Field label="First row" className="w-[170px]">
                      <Select className="h-9" value={importDraft.hasHeader ? 'header' : 'data'} onChange={(e) => toggleImportHeader(e.target.value === 'header')}>
                        <option value="header">Column names</option>
                        <option value="data">Data (no header)</option>
                      </Select>
                    </Field>
                    <Field label="Mode" className="w-[220px]">
                      <Select
                        className="h-9"
                        value={importDraft.mode}
                        onChange={(e) => setImportDraft({ ...importDraft, mode: e.target.value as 'append' | 'overwrite' })}
                      >
                        <option value="append">Append below existing rows</option>
                        {isOwner && <option value="overwrite">Overwrite existing rows</option>}
                      </Select>
                    </Field>
                  </div>

                  {/* Column mapping + preview */}
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="text-xs border-collapse" style={{ width: 'max-content', minWidth: '100%' }}>
                      <thead>
                        <tr className="bg-muted/40 border-b border-border">
                          {Array.from({ length: importStats.width }, (_, i) => (
                            <th key={i} className="px-2 py-2 text-left font-medium border-l border-border/50 first:border-l-0 min-w-[150px] align-top">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 truncate max-w-[180px]">
                                {importDraft.hasHeader ? ((importDraft.grid[0]?.[i] ?? '').trim() || `Column ${i + 1}`) : `Column ${i + 1}`}
                              </div>
                              <Select
                                className="h-7 text-xs w-full max-w-[180px]"
                                value={importDraft.mapping[i] ?? '__skip__'}
                                onChange={(e) => setImportDraft({ ...importDraft, mapping: { ...importDraft.mapping, [i]: e.target.value } })}
                              >
                                {detail.columns.map((c) => <option key={c.id} value={c.id}>→ {c.label}</option>)}
                                {isOwner && <option value="__new__">+ Add as new column</option>}
                                <option value="__skip__">Skip this column</option>
                              </Select>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {importStats.dataRows.slice(0, 5).map((r, ri) => (
                          <tr key={ri}>
                            {Array.from({ length: importStats.width }, (_, i) => (
                              <td key={i} className={cn(
                                'px-2 py-1.5 border-l border-border/40 first:border-l-0 max-w-[200px] truncate',
                                (importDraft.mapping[i] ?? '__skip__') === '__skip__' && 'opacity-40 line-through'
                              )}>
                                {r[i] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      <span className="font-semibold text-foreground">{importStats.nonEmpty.length.toLocaleString()}</span> row{importStats.nonEmpty.length === 1 ? '' : 's'} with data
                      {importStats.dataRows.length > importStats.nonEmpty.length && ` (${(importStats.dataRows.length - importStats.nonEmpty.length).toLocaleString()} empty skipped)`}
                    </span>
                    <span>{importStats.mappedCount} of {importStats.width} columns mapped{importStats.newCols > 0 && ` · ${importStats.newCols} new column${importStats.newCols === 1 ? '' : 's'} will be added`}</span>
                    <span>
                      {importDraft.mode === 'append'
                        ? `Will be added after your ${detail.rows.length} existing row${detail.rows.length === 1 ? '' : 's'}.`
                        : `Will REPLACE all ${detail.rows.length} existing row${detail.rows.length === 1 ? '' : 's'} on this sheet.`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={runImport} disabled={importing}>
                      <Upload className="h-3.5 w-3.5" /> {importing ? 'Importing…' : `Import ${importStats.nonEmpty.length.toLocaleString()} rows`}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setImportDraft(null); workbookRef.current = null; }}>Cancel</Button>
                  </div>
                </Card>
              )}

              {/* Share panel */}
              {showShare && isOwner && (
                <Card className="p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <UsersIcon className="h-4 w-4 text-primary" /> Who has access to “{detail.name}”
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Share with any email that has an account in the system — including people at other companies. They'll only see this sheet, nothing else of yours.
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Email" className="flex-1 min-w-[200px]">
                      <Input
                        type="email"
                        className="h-9"
                        value={shareEmail}
                        onChange={(e) => setShareEmail(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addShare(); } }}
                        placeholder="partner@othercompany.com"
                      />
                    </Field>
                    <Field label="Access" className="w-[130px]">
                      <Select className="h-9" value={shareRole} onChange={(e) => setShareRole(e.target.value as 'view' | 'edit')}>
                        <option value="view">View only</option>
                        <option value="edit">Can edit</option>
                      </Select>
                    </Field>
                    <Button size="sm" className="h-9" onClick={addShare}><Plus className="h-3.5 w-3.5" /> Share</Button>
                  </div>
                  {shares.length > 0 && (
                    <div className="divide-y divide-border/60 rounded-lg border border-border">
                      {shares.map((s) => (
                        <div key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                          <span className="font-medium">{s.email}</span>
                          <Badge className={cn('ml-1', s.role === 'edit'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400'
                            : 'bg-muted text-muted-foreground')}>
                            {s.role === 'edit' ? 'Can edit' : 'View only'}
                          </Badge>
                          <button onClick={() => removeShare(s)} className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground hover:text-rose-500" title="Remove access">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {/* Columns panel */}
              {showColumns && isOwner && (
                <Card className="p-4 space-y-3">
                  <div className="text-sm font-semibold">Columns</div>
                  <p className="text-xs text-muted-foreground">Rename, add, or remove — drag the grip to reorder. You can also drag the edge of any column header on the grid to resize it.</p>
                  <div className="space-y-1.5">
                    {colDraft.map((c, i) => (
                      <div
                        key={c.id}
                        draggable
                        onDragStart={(e) => {
                          colDragFromRef.current = i;
                          e.dataTransfer.effectAllowed = 'move';
                          try { e.dataTransfer.setData('text/plain', c.id); } catch { /* older browsers */ }
                        }}
                        onDragOver={(e) => {
                          if (colDragFromRef.current === null) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          if (colDragOver !== i) setColDragOver(i);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = colDragFromRef.current;
                          colDragFromRef.current = null;
                          setColDragOver(null);
                          if (from === null || from === i) return;
                          setColDraft((arr) => {
                            const n = [...arr];
                            const [moved] = n.splice(from, 1);
                            n.splice(i, 0, moved);
                            return n;
                          });
                        }}
                        onDragEnd={() => { colDragFromRef.current = null; setColDragOver(null); }}
                        className={cn(
                          'flex items-center gap-1.5 rounded-md transition-shadow',
                          colDragOver === i && colDragFromRef.current !== null && colDragFromRef.current !== i && 'ring-2 ring-primary/50'
                        )}
                      >
                        <span
                          title="Drag to reorder"
                          className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground/40 hover:text-muted-foreground"
                        >
                          <GripVertical className="h-4 w-4" />
                        </span>
                        <Input
                          className="h-8 flex-1"
                          value={c.label}
                          onChange={(e) => setColDraft((arr) => arr.map((x, xi) => xi === i ? { ...x, label: e.target.value } : x))}
                        />
                        <button
                          onClick={() => setColDraft((arr) => arr.filter((_, xi) => xi !== i))}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-rose-500"
                          title="Remove column (its data stays saved but hidden)"
                        ><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setColDraft((arr) => [...arr, { id: newColId(), label: `Column ${arr.length + 1}` }])}>
                      <Plus className="h-3.5 w-3.5" /> Add column
                    </Button>
                    <Button size="sm" onClick={saveColumns}>Save columns</Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowColumns(false)}>Cancel</Button>
                  </div>
                </Card>
              )}

              {/* Grid toolbar — search, density, and structure controls. */}
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={gridSearch}
                  onChange={(e) => setGridSearch(e.target.value)}
                  placeholder="Search this sheet"
                  className="h-8 w-52 text-[12.5px]"
                />
                <Select
                  value={rowHeight}
                  onChange={(e) => setRowHeight(e.target.value as RowHeight)}
                  className="h-8 w-auto text-[12px]"
                  aria-label="Row height"
                >
                  <option value="compact">Compact rows</option>
                  <option value="normal">Normal rows</option>
                  <option value="tall">Tall rows</option>
                </Select>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => addRows(1)}>
                    <Plus className="h-3.5 w-3.5" /> Row
                  </Button>
                )}
                {isOwner && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => applyColumnChange([
                        ...(detail.columns as GridColumn[]),
                        { id: newColId(), label: `Column ${detail.columns.length + 1}`, width: GRID_COL_WIDTH },
                      ])}
                    >
                      <Plus className="h-3.5 w-3.5" /> Column
                    </Button>
                    <Select
                      value=""
                      onChange={(e) => {
                        const [colId, fmt] = e.target.value.split('|');
                        if (!colId) return;
                        applyColumnChange((detail.columns as GridColumn[]).map((c) => (
                          c.id === colId ? { ...c, format: fmt as GridColumn['format'] } : c
                        )));
                      }}
                      className="h-8 w-auto text-[12px]"
                      aria-label="Column format"
                    >
                      <option value="">Format a column…</option>
                      {detail.columns.map((c) => (
                        <optgroup key={c.id} label={c.label}>
                          {(['text', 'number', 'currency', 'percent'] as const).map((f) => (
                            <option key={f} value={`${c.id}|${f}`}>
                              {c.label} → {f}{(c.format ?? 'text') === f ? ' ✓' : ''}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                    <Select
                      value=""
                      onChange={(e) => {
                        const colId = e.target.value;
                        if (!colId) return;
                        applyColumnChange((detail.columns as GridColumn[]).map((c) => (
                          c.id === colId ? { ...c, frozen: !c.frozen } : c
                        )));
                      }}
                      className="h-8 w-auto text-[12px]"
                      aria-label="Freeze column"
                    >
                      <option value="">Freeze / unfreeze…</option>
                      {detail.columns.map((c) => (
                        <option key={c.id} value={c.id}>{c.frozen ? `Unfreeze ${c.label}` : `Freeze ${c.label}`}</option>
                      ))}
                    </Select>
                  </>
                )}
                {gridStatus && <span className="text-[11.5px] text-muted-foreground">{gridStatus}</span>}
              </div>

              {/* Spreadsheet grid — fills the remaining viewport so the sheet
                  itself is the interface rather than a card floating in a page.
                  Height comes from useFillHeight; the calc() below is only the
                  first paint, before the measurement lands. */}
              <div
                ref={gridBoxRef}
                className="flex flex-col min-h-0"
                style={{ height: gridHeight ?? 'calc(100vh - 320px)', minHeight: MIN_GRID_H }}
              >
                <SheetGrid
                  columns={detail.columns as GridColumn[]}
                  rows={detail.rows}
                  canEdit={canEdit}
                  canEditColumns={isOwner}
                  rowHeight={rowHeight}
                  search={gridSearch}
                  onCellsChange={applyCellChanges}
                  onColumnsChange={applyColumnChange}
                  onAddRows={addRows}
                  onDeleteRows={deleteRows}
                  onStatus={setGridStatus}
                />
              </div>
            </div>
          )}

          {/* Sheet tabs — drag your own tabs to reorder them (Sheet 2 before
              Sheet 1, etc.); the order saves automatically. */}
          <div ref={tabsRef} className="flex items-end gap-1 border-b border-border overflow-x-auto pb-px">
            {ownSheets.map((s, i) => (
              <div
                key={s.id}
                draggable
                onDragStart={(e) => {
                  tabDragFromRef.current = i;
                  e.dataTransfer.effectAllowed = 'move';
                  try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* older browsers */ }
                }}
                onDragOver={(e) => {
                  if (tabDragFromRef.current === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (tabDragOver !== i) setTabDragOver(i);
                }}
                onDrop={(e) => { e.preventDefault(); dropTab(i); }}
                onDragEnd={() => { tabDragFromRef.current = null; setTabDragOver(null); }}
                className={cn('shrink-0 rounded-t-lg transition-shadow',
                  tabDragOver === i && tabDragFromRef.current !== null && tabDragFromRef.current !== i &&
                  'ring-2 ring-primary/50')}
              >
                <SheetTab sheet={s} active={activeId === s.id} onClick={() => setActiveId(s.id)} />
              </div>
            ))}
            {sharedSheets.length > 0 && <div className="mx-1.5 mb-2 h-4 w-px bg-border shrink-0" />}
            {sharedSheets.map((s) => (
              <SheetTab key={s.id} sheet={s} active={activeId === s.id} onClick={() => setActiveId(s.id)} />
            ))}
            <button
              onClick={createSheet}
              title="New sheet"
              className="ml-1 mb-1 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SheetTab({ sheet, active, onClick }: { sheet: SheetMeta; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative px-3.5 py-2 text-[13px] font-medium rounded-t-lg border border-b-0 transition-colors shrink-0 max-w-[200px] truncate',
        active
          ? 'bg-card border-border text-foreground -mb-px'
          : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
      )}
      title={sheet.myRole !== 'owner' ? `Shared by ${sheet.ownerName ?? 'owner'} (${sheet.myRole})` : sheet.name}
    >
      {sheet.name}
      {sheet.myRole !== 'owner' && <Share2 className="inline h-3 w-3 ml-1.5 -mt-0.5 text-muted-foreground" />}
    </button>
  );
}
