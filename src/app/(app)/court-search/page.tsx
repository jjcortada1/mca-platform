'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  PageHeader, Card, CardContent, Button, Input, Field, Badge,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { Gavel, Search, AlertTriangle, ExternalLink, Info } from 'lucide-react';

/**
 * NY court record search.
 *
 * Drives the New York State courts' public WebCivil Supreme party search.
 * There is no official API, so the server adapter works the public search
 * the way a browser does. Two consequences worth being honest about in the
 * UI: it can be temporarily blocked or rate-limited by the court, and a
 * name match is not proof the case belongs to this merchant.
 */

interface ScoredCase {
  indexNumber: string;
  caption: string;
  court: string | null;
  county: string | null;
  caseType: string | null;
  filedDate: string | null;
  status: string | null;
  url: string | null;
  matchedName: string;
  score: number;
  confidence: 'strong' | 'partial' | 'weak';
}

interface SearchResponse {
  id: string | null;
  status: string;
  error: string | null;
  searched: string[];
  resultCount: number;
  results: ScoredCase[];
}

export default function CourtSearchPage() {
  const toast = useToast();
  const [businessName, setBusinessName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/court/searches', { cache: 'no-store' });
      const j = await res.json();
      if (res.ok && Array.isArray(j.data)) setHistory(j.data);
    } catch { /* history is a convenience; a failure here isn't worth a toast */ }
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  async function run(kind: 'business' | 'person') {
    const payload = kind === 'business'
      ? { businessName: businessName.trim() }
      : { firstName: firstName.trim(), lastName: lastName.trim() };

    if (kind === 'business' && !payload.businessName) { toast.error('Enter a business name.'); return; }
    if (kind === 'person' && !payload.lastName) { toast.error('A last name is required — first name alone is not searchable.'); return; }

    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/court/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Court search failed.'); return; }
      setResult(j.data);
      if (j.data.status === 'ok') toast.success(`${j.data.resultCount} case${j.data.resultCount === 1 ? '' : 's'} found.`);
      else if (j.data.status === 'no_results') toast.success('No cases found.');
      void loadHistory();
    } catch {
      toast.error('Network error running the court search.');
    } finally {
      setBusy(false);
    }
  }

  const failed = result && !['ok', 'no_results'].includes(result.status);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Public records"
        title="NY court search"
        description="Search the New York State courts' public civil index by business name or by an owner's name — the same WebCivil Supreme search you'd run by hand, without leaving the CRM."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="text-[14px] font-semibold flex items-center gap-2">
              <Gavel className="h-4 w-4 text-muted-foreground" /> Search by business
            </h2>
            <Field label="Business name">
              <Input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void run('business'); }}
                placeholder="ACME Logistics LLC"
              />
            </Field>
            <Button onClick={() => run('business')} disabled={busy}>
              <Search className="h-4 w-4 mr-1.5" /> {busy ? 'Searching…' : 'Search courts'}
            </Button>
            <p className="text-[11.5px] text-muted-foreground leading-relaxed">
              Entity suffixes are searched with and without — &ldquo;ACME Logistics LLC&rdquo; also tries
              &ldquo;ACME Logistics&rdquo;, because courts index filings inconsistently.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="text-[14px] font-semibold flex items-center gap-2">
              <Gavel className="h-4 w-4 text-muted-foreground" /> Search by person
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <Field label="First name">
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="John" />
              </Field>
              <Field label="Last name">
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void run('person'); }}
                  placeholder="Smith"
                />
              </Field>
            </div>
            <Button onClick={() => run('person')} disabled={busy}>
              <Search className="h-4 w-4 mr-1.5" /> {busy ? 'Searching…' : 'Search courts'}
            </Button>
            <p className="text-[11.5px] text-muted-foreground leading-relaxed">
              New York indexes people as &ldquo;Last, First&rdquo;. A last name is required; the first name
              narrows the results.
            </p>
          </CardContent>
        </Card>
      </div>

      {failed && (
        <Card>
          <CardContent className="p-4 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-[12.5px]">
              <div className="font-medium">
                {result!.status === 'blocked'
                  ? 'The court site refused the request'
                  : result!.status === 'parse_failed'
                    ? 'The court responded, but the results could not be read'
                    : 'The court site could not be reached'}
              </div>
              <p className="text-muted-foreground mt-1 leading-relaxed">
                {result!.error}
                {result!.status === 'blocked' && ' The court rate-limits automated access — wait a few minutes and try again.'}
                {result!.status === 'parse_failed' && ' Their page layout has likely changed. An admin can open /api/court/diagnose to see the current form.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {result && result.status === 'no_results' && (
        <Card>
          <CardContent className="p-6 text-center text-[13px] text-muted-foreground">
            No New York civil cases found for {result.searched.map((s) => `“${s}”`).join(', ')}.
            <div className="text-[11.5px] mt-1">
              This covers the NY state civil index only — not federal court, other states, or UCC filings.
            </div>
          </CardContent>
        </Card>
      )}

      {result && result.status === 'ok' && (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border">
              <h2 className="text-[14px] font-semibold">
                {result.resultCount} case{result.resultCount === 1 ? '' : 's'}
              </h2>
              <span className="text-[11.5px] text-muted-foreground">
                Searched: {result.searched.join(' · ')}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]" style={{ minWidth: 860 }}>
                <thead>
                  <tr className="text-left text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground border-b border-border">
                    <th className="px-3 py-2">Index #</th>
                    <th className="px-3 py-2">Caption</th>
                    <th className="px-3 py-2">Court / county</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Filed</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((c, i) => (
                    <tr key={`${c.indexNumber}-${i}`} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-3 py-2 whitespace-nowrap font-medium">
                        {c.url ? (
                          <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                            {c.indexNumber || '—'} <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (c.indexNumber || '—')}
                      </td>
                      <td className="px-3 py-2 max-w-[320px]"><span className="line-clamp-2">{c.caption || '—'}</span></td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {[c.court, c.county].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{c.caseType || '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{c.filedDate || '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.status || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <Badge variant={c.confidence === 'strong' ? 'destructive' : c.confidence === 'partial' ? 'warning' : 'outline'}>
                          {c.confidence === 'strong' ? 'Exact' : c.confidence === 'partial' ? 'Partial' : 'Weak'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-start gap-2 px-4 py-3 border-t border-border text-[11.5px] text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                A name match is <span className="font-medium text-foreground">not</span> proof the case belongs to
                this merchant — common names collide. Open the case on the court&apos;s site to confirm the party
                before acting on it.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {history.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-[14px] font-semibold">Recent searches</h2>
            </div>
            <ul className="divide-y divide-border">
              {history.slice(0, 10).map((h) => (
                <li key={h.id} className="flex items-center gap-3 px-4 py-2 text-[12.5px]">
                  <span className="font-medium truncate">
                    {h.businessName || [h.lastName, h.firstName].filter(Boolean).join(', ')}
                  </span>
                  <Badge variant={h.status === 'ok' ? 'destructive' : h.status === 'no_results' ? 'success' : 'warning'}>
                    {h.status === 'ok' ? `${h.resultCount} found` : h.status === 'no_results' ? 'Clear' : h.status}
                  </Badge>
                  <span className="ml-auto text-muted-foreground text-[11.5px]">
                    {new Date(h.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
