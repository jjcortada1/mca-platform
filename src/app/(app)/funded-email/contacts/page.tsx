'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card, CardContent, Button, Input, Field, PageHeader,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { Plus, Trash2, ArrowLeft } from 'lucide-react';

interface Contact { id: string; name: string; email: string; company: string | null; notes: string | null }

export default function FundedContactsPage() {
  const toast = useToast();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Contact> | null>(null);

  async function load() {
    setLoading(true);
    const r = await fetch('/api/funded-email/contacts', { cache: 'no-store' });
    const j = await r.json();
    setContacts(j.data ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing?.name?.trim() || !editing?.email?.trim()) {
      toast.error('Name and email required.');
      return;
    }
    const res = await fetch('/api/funded-email/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editing),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Save failed.'); return; }
    toast.success(editing.id ? 'Contact updated.' : 'Contact added.');
    setEditing(null);
    load();
  }

  async function remove(id: string) {
    if (!confirm('Delete this contact?')) return;
    const res = await fetch('/api/funded-email/contacts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) { toast.error('Delete failed.'); return; }
    toast.success('Contact deleted.');
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/funded-email" className="text-sm inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to funded email
        </Link>
      </div>
      <PageHeader title="Funded email contacts" description="Your private contacts list — used when picking who to send a funded email to." />

      <Button onClick={() => setEditing({ name: '', email: '', company: '', notes: '' })}>
        <Plus className="h-4 w-4 mr-1.5" /> Add contact
      </Button>

      {editing && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <Field label="Name"><Input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={editing.email ?? ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
            <Field label="Company (optional)"><Input value={editing.company ?? ''} onChange={(e) => setEditing({ ...editing, company: e.target.value })} /></Field>
            <Field label="Notes (optional)"><Input value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
            <div className="flex gap-2">
              <Button onClick={save}>{editing.id ? 'Update' : 'Add'}</Button>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : contacts.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No saved contacts yet.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b border-border">
                <tr className="text-left">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium w-20"></th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/20 cursor-pointer" onClick={() => setEditing(c)}>
                    <td className="px-4 py-2">{c.name}</td>
                    <td className="px-4 py-2 text-muted-foreground font-mono text-xs">{c.email}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.company ?? '—'}</td>
                    <td className="px-4 py-2">
                      <button onClick={(e) => { e.stopPropagation(); remove(c.id); }} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
