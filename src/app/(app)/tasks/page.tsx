'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, Button, Input, Field, PageHeader, EmptyState, TableSkeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Plus, X, ClipboardList, Users as UsersIcon, Trash2, ChevronDown, ChevronRight,
} from 'lucide-react';

/* ============================================================
   Tasks — company + broker to-dos with teams and leaders.

   Visibility (enforced server-side, mirrored here):
     - Admins see everything.
     - Company-wide tasks (no assignee) are visible to everyone.
     - A broker sees their own tasks; a team leader also sees
       their members' tasks.
   Status flow: open → handling (someone claimed it) → completed.
   ============================================================ */

interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  teamId: string | null;
  dueDate: string | null;
  status: 'open' | 'handling' | 'completed';
  handledBy: string | null;
  handledByName: string | null;
  createdBy: string | null;
  createdByName: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface Team {
  id: string;
  name: string;
  members: { userId: string; name: string; email: string; isLeader: boolean }[];
}

interface CompanyUser { id: string; name: string; email: string; role: string }

const STATUS_META: Record<string, { label: string; tone: string }> = {
  open:      { label: 'Open',      tone: 'bg-blue-100 text-blue-800 border-blue-200' },
  handling:  { label: 'Handling',  tone: 'bg-amber-100 text-amber-800 border-amber-200' },
  completed: { label: 'Completed', tone: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
};

export default function TasksPage() {
  const toast = useToast();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [me, setMe] = useState<{ id: string; isAdmin: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState<'active' | 'open' | 'handling' | 'completed' | 'all'>('active');
  const [mineOnly, setMineOnly] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TaskItem | null>(null);

  async function load() {
    setLoading(true);
    const [tRes, teamRes, uRes] = await Promise.all([
      fetch('/api/tasks', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      fetch('/api/teams', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      fetch('/api/users').then((r) => r.json()).catch(() => ({ data: [] })),
    ]);
    setTasks(tRes.data ?? []);
    setMe(tRes.me ?? null);
    setTeams(teamRes.data ?? []);
    setCompanyUsers(((uRes.data ?? []) as CompanyUser[]).filter((u) => u.role !== 'lead_source'));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let arr = tasks;
    if (statusFilter === 'active') arr = arr.filter((t) => t.status !== 'completed');
    else if (statusFilter !== 'all') arr = arr.filter((t) => t.status === statusFilter);
    if (mineOnly && me) arr = arr.filter((t) => t.assignedToUserId === me.id || (!t.assignedToUserId));
    return arr;
  }, [tasks, statusFilter, mineOnly, me]);

  async function setStatus(task: TaskItem, status: TaskItem['status']) {
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Could not update task.');
      return;
    }
    load();
  }

  async function deleteTask(task: TaskItem) {
    const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Could not delete task.');
      return;
    }
    toast.success('Task deleted.');
    setTasks((arr) => arr.filter((t) => t.id !== task.id));
  }

  const counts = useMemo(() => ({
    active: tasks.filter((t) => t.status !== 'completed').length,
    open: tasks.filter((t) => t.status === 'open').length,
    handling: tasks.filter((t) => t.status === 'handling').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    all: tasks.length,
  }), [tasks]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks"
        description="Company and broker to-dos. Claim a task with “Handling”, close it out with “Complete”."
        actions={
          <div className="flex gap-2">
            {me?.isAdmin && (
              <a href="/settings?tab=teams" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm hover:bg-muted transition-colors">
                <UsersIcon className="h-4 w-4" /> Manage teams
              </a>
            )}
            <Button onClick={() => setShowCreate((v) => !v)} className="gap-1.5">
              <Plus className="h-4 w-4" /> New task
            </Button>
          </div>
        }
      />

      {showCreate && (
        <CreateTaskForm
          me={me}
          teams={teams}
          companyUsers={companyUsers}
          onCreated={() => { setShowCreate(false); load(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {([['active', 'Active'], ['open', 'Open'], ['handling', 'Handling'], ['completed', 'Completed'], ['all', 'All']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all',
              statusFilter === key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
            )}
          >
            {label}
            <span className={cn('tabular-nums px-1.5 py-0.5 rounded text-[10px]',
              statusFilter === key ? 'bg-primary-foreground/20' : 'bg-muted')}>{counts[key]}</span>
          </button>
        ))}
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer ml-2">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} className="h-3.5 w-3.5 rounded" />
          My tasks only
        </label>
      </div>

      {/* List */}
      {loading ? (
        <TableSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No tasks here"
          description="Create a task to get the board going."
        />
      ) : (
        <Card>
          <div className="divide-y divide-border/60">
            {filtered.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                me={me}
                teams={teams}
                onStatus={(s) => setStatus(t, s)}
                onDelete={() => setPendingDelete(t)}
              />
            ))}
          </div>
        </Card>
      )}

      {pendingDelete && (
        <ConfirmDialog
          open
          destructive
          title={`Delete "${pendingDelete.title}"?`}
          description="This removes the task for everyone. Cannot be undone."
          confirmLabel="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => { const t = pendingDelete; setPendingDelete(null); deleteTask(t); }}
        />
      )}
    </div>
  );
}

function TaskRow({
  task, me, teams, onStatus, onDelete,
}: {
  task: TaskItem;
  me: { id: string; isAdmin: boolean } | null;
  teams: Team[];
  onStatus: (s: TaskItem['status']) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[task.status] ?? STATUS_META.open;
  const team = task.teamId ? teams.find((tm) => tm.id === task.teamId) : null;
  const overdue = task.dueDate && task.status !== 'completed' && new Date(task.dueDate).getTime() < Date.now();
  const canDelete = me?.isAdmin || task.createdBy === me?.id;

  return (
    <div className={cn('px-4 py-3', task.status === 'completed' && 'opacity-60')}>
      <div className="flex items-start gap-3">
        <button onClick={() => setExpanded((v) => !v)} className="mt-0.5 text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('font-medium text-sm', task.status === 'completed' && 'line-through')}>{task.title}</span>
            <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium border', meta.tone)}>{meta.label}</span>
            {task.assignedToName
              ? <span className="text-[11px] text-muted-foreground">→ {task.assignedToName}</span>
              : <span className="text-[11px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 border border-violet-200 font-medium">Company</span>}
            {team && <span className="text-[11px] text-muted-foreground">· {team.name}</span>}
            {task.dueDate && (
              <span className={cn('text-[11px] tabular-nums', overdue ? 'text-rose-600 font-semibold' : 'text-muted-foreground')}>
                due {new Date(task.dueDate).toLocaleDateString()}{overdue ? ' — overdue' : ''}
              </span>
            )}
          </div>
          {task.status === 'handling' && task.handledByName && (
            <div className="text-[11px] text-amber-700 mt-0.5">{task.handledByName} is handling this</div>
          )}
          {expanded && (
            <div className="mt-2 space-y-1.5">
              {task.description
                ? <p className="text-sm text-foreground/80 whitespace-pre-wrap">{task.description}</p>
                : <p className="text-xs text-muted-foreground italic">No details.</p>}
              <div className="text-[11px] text-muted-foreground">
                Created {new Date(task.createdAt).toLocaleDateString()}{task.createdByName ? ` by ${task.createdByName}` : ''}
                {task.completedAt ? ` · completed ${new Date(task.completedAt).toLocaleDateString()}` : ''}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {task.status === 'open' && (
            <Button size="sm" variant="outline" onClick={() => onStatus('handling')}>Handling</Button>
          )}
          {task.status !== 'completed' && (
            <Button size="sm" onClick={() => onStatus('completed')}>Complete</Button>
          )}
          {task.status === 'completed' && (
            <Button size="sm" variant="outline" onClick={() => onStatus('open')}>Reopen</Button>
          )}
          {canDelete && (
            <button onClick={onDelete} className="p-1.5 text-muted-foreground hover:text-destructive rounded hover:bg-destructive/10" title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateTaskForm({
  me, teams, companyUsers, onCreated, onCancel,
}: {
  me: { id: string; isAdmin: boolean } | null;
  teams: Team[];
  companyUsers: CompanyUser[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // '' = company-wide (admin only); otherwise a userId
  const [assignee, setAssignee] = useState(me?.isAdmin ? '' : (me?.id ?? ''));
  const [teamId, setTeamId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) { toast.error('Give the task a title.'); return; }
    setSaving(true);
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() || null,
        assignedToUserId: assignee || null,
        teamId: teamId || null,
        dueDate: dueDate || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Could not create task.');
      return;
    }
    toast.success('Task created.');
    onCreated();
  }

  return (
    <Card className="border-primary/40 bg-primary/[0.02]">
      <CardContent className="p-4 space-y-3">
        <div className="text-sm font-semibold flex items-center justify-between">
          <span>New task</span>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Title" className="sm:col-span-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Follow up with merchant on statements" autoFocus />
          </Field>
          <Field label="Details" className="sm:col-span-2">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Anything the person handling this needs to know…"
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm resize-y"
            />
          </Field>
          <Field label="Assign to">
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
            >
              {me?.isAdmin && <option value="">Whole company</option>}
              {companyUsers.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
            </select>
          </Field>
          <Field label="Team (optional)">
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
            >
              <option value="">— none —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Due date (optional)">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving || !title.trim()}>{saving ? 'Creating…' : 'Create task'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

