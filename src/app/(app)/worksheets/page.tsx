'use client';
/**
 * Worksheets — Google-Sheets-style personal tracking, fully separate from
 * deals/funded volume (nothing here feeds any analytics).
 *
 * - Multiple sheets as tabs (like sheet tabs in Google Sheets).
 * - Each sheet has customizable columns and free-form rows.
 * - The owner can share an individual sheet with any email that already has
 *   an account in the system — INCLUDING users at other companies — as
 *   view-only or edit. Access is per sheet: sharing one sheet reveals only
 *   that sheet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PageHeader, Card, Button, Input, Field, Badge, EmptyState, TableSkeleton, Select,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-provider';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import { cn } from '@/lib/utils';
import {
  Plus, Table2, Share2, Settings2, Trash2, X, ChevronUp, ChevronDown, Users as UsersIcon,
} from 'lucide-react';

interface Col { id: string; label: string }
interface SheetMeta { id: string; name: string; columns: Col[]; myRole: 'owner' | 'edit' | 'view'; ownerName: string | null }
interface RowData { id: string; cells: Record<string, string> }
interface ShareRow { id: string; email: string; role: string }

function newColId() {
  return 'c_' + Math.random().toString(36).slice(2, 8);
}

export default function WorksheetsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [sheets, setSheets] = useState<SheetMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);

  // Active sheet detail
  const [detail, setDetail] = useState<{ id: string; name: string; columns: Col[]; myRole: 'owner' | 'edit' | 'view'; rows: RowData[] } | null>(null);
  const [loadingSheet, setLoadingSheet] = useState(false);

  // Panels
  const [showShare, setShowShare] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState<'view' | 'edit'>('view');
  const [colDraft, setColDraft] = useState<Col[]>([]);
  const [sheetNameDraft, setSheetNameDraft] = useState('');

  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const loadList = useCallback(async (pickFirst = false) => {
    try {
      const res = await fetch('/api/worksheets', { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) return;
      const list: SheetMeta[] = j.data ?? [];
      setSheets(list);
      // Deep link ?sheet=... on first load; else keep/repair selection.
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
        setDetail(j.data);
        setSheetNameDraft(j.data.name);
      }
    } finally {
      setLoadingSheet(false);
    }
  }, []);

  useEffect(() => { loadList(true); }, [loadList]);
  useEffect(() => {
    if (activeId) { setShowShare(false); setShowColumns(false); loadSheet(activeId); }
    else setDetail(null);
  }, [activeId, loadSheet]);

  // Background sync — the hook skips ticks while the user is typing, so
  // in-cell edits are never clobbered.
  useAutoRefresh(() => {
    loadList();
    if (activeIdRef.current) loadSheet(activeIdRef.current, true);
  }, { intervalMs: 45_000 });

  const canEdit = detail?.myRole === 'owner' || detail?.myRole === 'edit';
  const isOwner = detail?.myRole === 'owner';

  /* ---------- sheet CRUD ---------- */

  async function createSheet() {
    // Created immediately with a default name — rename inline in the toolbar
    // (no browser prompt; the app never uses native popups).
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
    if (res.ok) { toast.success('Sheet renamed.'); loadList(); loadSheet(detail.id, true); }
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

  /* ---------- rows ---------- */

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

  function setCellLocal(rowId: string, colId: string, value: string) {
    setDetail((d) => d ? {
      ...d,
      rows: d.rows.map((r) => r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: value } } : r),
    } : d);
  }

  async function saveRow(row: RowData) {
    if (!detail) return;
    await fetch(`/api/worksheets/${detail.id}/rows/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cells: row.cells }),
    }).catch(() => {});
  }

  async function deleteRow(rowId: string) {
    if (!detail) return;
    const ok = await confirm({ title: 'Delete this row?', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    const res = await fetch(`/api/worksheets/${detail.id}/rows/${rowId}`, { method: 'DELETE' });
    if (res.ok) setDetail((d) => d ? { ...d, rows: d.rows.filter((r) => r.id !== rowId) } : d);
  }

  /* ---------- sharing ---------- */

  async function openShare() {
    if (!detail) return;
    setShowShare((v) => !v);
    setShowColumns(false);
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

  /* ---------- columns ---------- */

  function openColumns() {
    if (!detail) return;
    setShowColumns((v) => !v);
    setShowShare(false);
    setColDraft(detail.columns.map((c) => ({ ...c })));
  }

  async function saveColumns() {
    if (!detail) return;
    const cleaned = colDraft.filter((c) => c.label.trim());
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
    loadSheet(detail.id, true);
    loadList();
  }

  const ownSheets = useMemo(() => sheets.filter((s) => s.myRole === 'owner'), [sheets]);
  const sharedSheets = useMemo(() => sheets.filter((s) => s.myRole !== 'owner'), [sheets]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Worksheets"
        description="Your own sheets for tracking outside and co-brokered deals — completely separate from your funded deals and volume. Share a specific sheet with anyone in the system, view-only or edit."
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
          {/* Sheet tabs — Google-Sheets style */}
          <div className="flex items-end gap-1 border-b border-border overflow-x-auto pb-px">
            {ownSheets.map((s) => (
              <SheetTab key={s.id} sheet={s} active={activeId === s.id} onClick={() => setActiveId(s.id)} />
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

          {loadingSheet || !detail ? (
            <TableSkeleton />
          ) : (
            <div className="space-y-3">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                {isOwner ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={sheetNameDraft}
                      onChange={(e) => setSheetNameDraft(e.target.value)}
                      onBlur={renameSheet}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      className="h-8 w-[220px] text-sm font-semibold"
                    />
                  </div>
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
                  <div className="space-y-1.5">
                    {colDraft.map((c, i) => (
                      <div key={c.id} className="flex items-center gap-1.5">
                        <Input
                          className="h-8 flex-1"
                          value={c.label}
                          onChange={(e) => setColDraft((arr) => arr.map((x, xi) => xi === i ? { ...x, label: e.target.value } : x))}
                        />
                        <button
                          onClick={() => setColDraft((arr) => { if (i === 0) return arr; const n = [...arr]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}
                          disabled={i === 0}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground disabled:opacity-30"
                          title="Move up"
                        ><ChevronUp className="h-3.5 w-3.5" /></button>
                        <button
                          onClick={() => setColDraft((arr) => { if (i === arr.length - 1) return arr; const n = [...arr]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}
                          disabled={i === colDraft.length - 1}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground disabled:opacity-30"
                          title="Move down"
                        ><ChevronDown className="h-3.5 w-3.5" /></button>
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

              {/* Grid */}
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ minWidth: `${Math.max(640, detail.columns.length * 170 + 60)}px` }}>
                    <thead>
                      <tr className="bg-muted/40 border-b border-border">
                        <th className="w-9 px-2 py-2 text-left text-[10px] font-semibold text-muted-foreground">#</th>
                        {detail.columns.map((c) => (
                          <th key={c.id} className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-l border-border/50">
                            {c.label}
                          </th>
                        ))}
                        <th className="w-9"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {detail.rows.map((row, ri) => (
                        <tr key={row.id} className="group hover:bg-muted/20">
                          <td className="px-2 py-1 text-[11px] text-muted-foreground tabular-nums">{ri + 1}</td>
                          {detail.columns.map((c) => (
                            <td key={c.id} className="border-l border-border/40 p-0">
                              {canEdit ? (
                                <input
                                  value={row.cells[c.id] ?? ''}
                                  onChange={(e) => setCellLocal(row.id, c.id, e.target.value)}
                                  onBlur={() => saveRow({ ...row, cells: { ...row.cells, [c.id]: row.cells[c.id] ?? '' } })}
                                  className="w-full bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:bg-primary/[0.04] focus:ring-1 focus:ring-inset focus:ring-ring/40 tabular-nums"
                                />
                              ) : (
                                <div className="px-2.5 py-1.5 text-[13px] tabular-nums whitespace-pre-wrap">{row.cells[c.id] ?? ''}</div>
                              )}
                            </td>
                          ))}
                          <td className="px-1 py-1 text-center">
                            {canEdit && (
                              <button
                                onClick={() => deleteRow(row.id)}
                                className="p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-rose-500 hover:bg-muted transition-colors"
                                title="Delete row"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {detail.rows.length === 0 && (
                        <tr>
                          <td colSpan={detail.columns.length + 2} className="px-4 py-8 text-center text-sm text-muted-foreground">
                            {canEdit ? 'Empty sheet — add your first row.' : 'This sheet is empty.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {canEdit && (
                  <button
                    onClick={addRow}
                    className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 border-t border-border transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add row
                  </button>
                )}
              </Card>
            </div>
          )}
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
