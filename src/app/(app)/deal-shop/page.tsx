'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, Badge, PageHeader, Field, Input } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { US_STATES } from '@/lib/constants';
import { Send, ChevronDown, ChevronRight, Mail, Phone, MapPin, Ban, FileText, Zap, Search, X, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MatchResult } from '@/lib/matching/engine';

/**
 * Human labels for short-form exclusion codes. Used by the deal-shop UI to
 * render compact red badges next to each excluded funder so the reason is
 * scannable at a glance — instead of long sentences.
 *
 * The full detailed reason text from the engine is kept on the tooltip
 * (title attribute) so a user can hover for specifics like the exact
 * revenue or credit threshold that failed.
 */
const EXCLUSION_LABELS = {
  restricted_state: 'Restricted State',
  restricted_industry: 'Restricted Industry',
  credit_too_low: 'Credit Too Low',
  revenue_too_low: 'Revenue Too Low',
  positions_too_high: 'Position Count Too High',
  reverse_unsupported: 'No Reverse Consol.',
  inactive: 'Inactive',
} as const;

interface MatchResponse { matched: MatchResult[]; excluded: MatchResult[]; }

interface FunderDetail {
  id: string;
  name: string;
  tiers?: { id: string; name: string }[];
  emails?: string[] | null;
  contacts?: { name: string; email?: string | null; phone?: string | null }[];
  restrictedStates?: string[];
  restrictedIndustries?: string[];
  notes?: string | null;
  submissionMethod?: string;
}

interface MatchOption {
  id: string;
  value: string;
  label: string;
  meta: Record<string, unknown> | null;
}

export default function DealShopPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // If the user came from /active-deals → "Shop this deal", we get a deal id
  // in the URL. Used to pull existing submissions for the deal so we can
  // surface them as an "Already Submitted" bucket and mark recommended
  // funders that have already seen this file.
  const dealId = searchParams?.get('dealId') ?? null;

  // Editable options loaded from server
  const [creditRanges, setCreditRanges] = useState<MatchOption[]>([]);
  const [revenueRanges, setRevenueRanges] = useState<MatchOption[]>([]);
  const [industries, setIndustries] = useState<MatchOption[]>([]);
  const [dealTypes, setDealTypes] = useState<MatchOption[]>([]);
  const [positionOptions, setPositionOptions] = useState<MatchOption[]>([]);
  const [stateOptions, setStateOptions] = useState<MatchOption[]>([]);

  // Form state
  const [revenueOption, setRevenueOption] = useState('');
  const [creditOption, setCreditOption] = useState('unknown');
  const [position, setPosition] = useState('');
  const [industry, setIndustry] = useState('other');
  const [state, setState] = useState('other');
  const [dealType, setDealType] = useState('standard_mca');

  const [results, setResults] = useState<MatchResponse | null>(null);
  const [funderMap, setFunderMap] = useState<Map<string, FunderDetail>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTier, setActiveTier] = useState<string>('all');
  // Same idea but for the no-match manual picker fallback. Tracks which
  // tier chip is active so the broker can scope the manual list to just
  // one tier when they already know they want to shop "A-Paper only."
  const [activeManualTier, setActiveManualTier] = useState<string>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFunders, setSelectedFunders] = useState<Set<string>>(new Set());

  // Already-submitted funders for the current deal (loaded only if dealId present).
  // Map: funderId → { status, submittedAt } — keyed by funder so we can do O(1)
  // lookups while rendering the recommended/excluded buckets.
  const [alreadySubmitted, setAlreadySubmitted] = useState<Map<string, { funderName: string; status: string; submittedAt: string }>>(new Map());

  // Pull this deal's existing submissions when dealId param is present.
  // No-op (empty map) when the user navigates to /deal-shop directly without
  // a deal context — the "Already Submitted" bucket simply doesn't render.
  useEffect(() => {
    if (!dealId) {
      setAlreadySubmitted(new Map());
      return;
    }
    fetch(`/api/deals/${dealId}/submissions`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        const m = new Map<string, { funderName: string; status: string; submittedAt: string }>();
        for (const s of (j.data ?? [])) {
          m.set(s.funderId, { funderName: s.funderName, status: s.status, submittedAt: s.submittedAt });
        }
        setAlreadySubmitted(m);
      })
      .catch(() => setAlreadySubmitted(new Map()));
  }, [dealId]);

  /* ========================================================================
     SEND FORM STATE (inline submit, replaces /submit page handoff)
     The form lives at the bottom of the page and is the only way to ship
     a deal to selected funders. We collect: deal name, notes, attachments,
     rep selector (auto-CCs the rep's email), additional CC, and trigger
     /api/submissions/send. SMTP banner shows the configured sender.
     ======================================================================== */
  const [dealName, setDealName] = useState('');
  const [dealNameLocked, setDealNameLocked] = useState(false);
  const [notes, setNotes] = useState('');

  /* Submission intake — structured "what to tell the funder" context.
     Lives in its own expandable section above Notes on the form. The
     data persists on the deal record (deal.submissionIntake JSONB) so:
       1. Re-shopping to additional funders pre-fills automatically.
       2. The submission record carries the formatted summary in its
          notes field, so submissions display shows it.
     Each subsection is optional — broker fills only what they want. */
  type OpenBal = { id: string; funder: string; amount: string };
  type RecentFund = { id: string; company: string; amount: string; date: string };
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [openBalances, setOpenBalances] = useState<OpenBal[]>([]);
  const [priorHistoryMode, setPriorHistoryMode] = useState<'unset' | 'yes' | 'no'>('unset');
  const [priorHistoryDetails, setPriorHistoryDetails] = useState('');
  const [recentFundings, setRecentFundings] = useState<RecentFund[]>([]);
  const [savingIntake, setSavingIntake] = useState(false);

  // When a deal is loaded into the page (via ?dealId=), hydrate the
  // intake form from deal.submissionIntake. Done lazily so the fetch
  // only fires when the user actually has a deal context.
  useEffect(() => {
    if (!dealId) return;
    fetch(`/api/deals/${dealId}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        const intake = j?.deal?.submissionIntake;
        if (!intake || typeof intake !== 'object') return;
        if (Array.isArray(intake.openBalances)) {
          setOpenBalances(intake.openBalances.map((r: { funder?: string; amount?: string }) => ({
            id: cryptoId(), funder: r.funder ?? '', amount: r.amount ?? '',
          })));
        }
        if (intake.priorHistory) {
          setPriorHistoryMode(intake.priorHistory.has ? 'yes' : 'no');
          setPriorHistoryDetails(intake.priorHistory.details ?? '');
        }
        if (Array.isArray(intake.recentFundings)) {
          setRecentFundings(intake.recentFundings.map((r: { company?: string; amount?: string; date?: string }) => ({
            id: cryptoId(), company: r.company ?? '', amount: r.amount ?? '', date: r.date ?? '',
          })));
        }
        // Notes is part of the same intake blob — kept separate from the
        // existing top-of-email Notes field. We populate the existing
        // notes field if it's empty so the broker doesn't lose context.
        if (intake.notes && typeof intake.notes === 'string') {
          setNotes((prev) => prev || intake.notes);
        }
      })
      .catch(() => {});
  }, [dealId]);
  const [assignedRepId, setAssignedRepId] = useState('');
  const [reps, setReps] = useState<{ id: string; name: string; email: string }[]>([]);
  // Additional CC addresses entered manually. Rep CC auto-pulls from the
  // selected rep's email and is rendered as a removable chip.
  const [extraCc, setExtraCc] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Drag-and-drop visual state. When true, the dropzone shows a highlighted
  // border + tint so the user knows the dragover is being received and they
  // can release the mouse to drop.
  const [dragActive, setDragActive] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResults, setSendResults] = useState<{ funderName: string; toEmails: string[]; success: boolean; message: string }[] | null>(null);
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null);
  const [fromEmail, setFromEmail] = useState<string | null>(null);
  // Post-send "view submissions?" confirmation. Replaces the native
  // browser confirm() popup that used to fire at the top of the page.
  const [showPostSendConfirm, setShowPostSendConfirm] = useState(false);

  /**
   * Manual / ad-hoc funders — typed-in names + emails for one-off sends to
   * funders that aren't (yet) in the directory. These ride along with any
   * directory funder selections on the same Send action. Each entry has a
   * trash icon and isn't persisted anywhere; they live for this send only.
   *
   * The server already accepts entries without a `funderId` (uses
   * `manualFunderName` + `toEmails`), so no API change is needed.
   */
  type ManualFunder = { id: string; name: string; email: string };
  const [manualFunders, setManualFunders] = useState<ManualFunder[]>([]);
  const [manualName, setManualName] = useState('');
  const [manualEmail, setManualEmail] = useState('');

  // Load company users for the rep dropdown + auto-fill rep email into CC.
  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((j) => {
        const list = (j.data ?? j.users ?? []) as { id: string; name: string | null; email: string; role: string }[];
        setReps(list
          .filter((u) => u.role !== 'lead_source')
          .map((u) => ({ id: u.id, name: u.name || u.email, email: u.email }))
          .sort((a, b) => a.name.localeCompare(b.name)));
      }).catch(() => {});
    // SMTP status — informs the user where emails will send from.
    fetch('/api/settings/smtp-status')
      .then((r) => r.json())
      .then((j) => {
        const d = j?.data ?? j;
        setSmtpConfigured(!!d?.hasConfig);
        setFromEmail(d?.from ?? d?.user ?? null);
      })
      .catch(() => {});
  }, []);

  // Auto-fill from existing deal: name + rep
  useEffect(() => {
    if (!dealId) return;
    fetch(`/api/deals/${dealId}`)
      .then((r) => r.json())
      .then((j) => {
        const d = j?.data ?? j?.deal ?? j;
        if (d?.name) {
          setDealName(d.name);
          setDealNameLocked(true);
        }
        if (d?.assignedRepId) setAssignedRepId(d.assignedRepId);
      })
      .catch(() => {});
  }, [dealId]);

  // When a rep is selected, the user can OPTIONALLY add the rep's email to CC.
  // Default OFF so the rep isn't forced onto every send — keeps the prompt's
  // "give option to cc them, don't force cc them" behavior.
  const [ccAssignedRep, setCcAssignedRep] = useState(false);
  // Computed CC list: rep's email (if rep selected AND ccAssignedRep is on)
  // + manual entries, deduped.
  const ccList = useMemo(() => {
    const set = new Set<string>();
    const repEmail = (ccAssignedRep && assignedRepId)
      ? reps.find((r) => r.id === assignedRepId)?.email
      : null;
    if (repEmail) set.add(repEmail.toLowerCase());
    for (const e of extraCc) if (e) set.add(e.toLowerCase());
    return Array.from(set);
  }, [ccAssignedRep, assignedRepId, reps, extraCc]);

  function addCc() {
    const v = ccInput.trim();
    if (!v || !v.includes('@')) return;
    if (extraCc.includes(v)) { setCcInput(''); return; }
    setExtraCc([...extraCc, v]);
    setCcInput('');
  }
  function removeCc(email: string) {
    setExtraCc(extraCc.filter((e) => e !== email));
  }
  function onFilePick(files: FileList | null) {
    if (!files || files.length === 0) return;
    // CRITICAL: snapshot the FileList into a real array RIGHT NOW.
    //
    // FileList is live — it's a reference to `input.files`. Below we'll
    // clear `input.value = ''` (so the same file can be re-selected later
    // after removal), which also EMPTIES input.files. The setAttachments
    // callback runs async (React batches state updates), so by the time
    // it executes, `files` would already be empty and `Array.from(files)`
    // would return `[]` — the picked files would silently vanish.
    //
    // This was the real reason "click to upload" wasn't attaching anything.
    const picked = Array.from(files);
    setAttachments((prev) => {
      const next = [...prev];
      for (const f of picked) {
        if (!next.find((x) => x.name === f.name && x.size === f.size)) next.push(f);
      }
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  /**
   * Send the deal to the currently selected funders.
   *
   * Builds the FunderSubmission array from selectedFunders + the loaded
   * funder details (we need the email addresses per funder). Manual funders
   * (no funderId) aren't supported in this inline flow — they live on the
   * full /submit page if anyone needs to add one. Server is the authority
   * on duplicate-detection + ASCII subject mode + plain-subject funders.
   */
  async function sendNow() {
    // At least one funder selected (directory or manual) is required.
    if (selectedFunders.size === 0 && manualFunders.length === 0) return;
    if (smtpConfigured === false) {
      alert('Email is not configured yet. Set up SMTP first.');
      return;
    }
    if (!dealName.trim() && !dealId) {
      alert('Enter a deal name first.');
      return;
    }
    setSending(true);
    setSendResults(null);

    // Build the funder targets:
    //   1. Directory funders → { funderId, toEmails }
    //   2. Manual one-off funders → { manualFunderName, toEmails } (server
    //      stores these on the submission row without persisting them to the
    //      funder directory — purely for tracking this single send).
    type Target =
      | { funderId: string; toEmails: string[] }
      | { manualFunderName: string; toEmails: string[] };
    const targets: Target[] = [];
    for (const fid of Array.from(selectedFunders)) {
      const f = funderMap.get(fid);
      if (!f) continue;
      const addrs = (f.emails ?? []).filter((e) => e && e.includes('@'));
      // Fallback to a primary contact if no shopping emails are set.
      if (addrs.length === 0) {
        const primary = f.contacts?.find((c) => c.email);
        if (primary?.email) addrs.push(primary.email);
      }
      if (addrs.length > 0) targets.push({ funderId: fid, toEmails: addrs });
    }
    // Append manual funders. We trust the user's email on these (they typed
    // it knowing it's a one-off); the server still validates with a hard
    // regex + header-injection guard before sending.
    for (const m of manualFunders) {
      const trimmedEmail = m.email.trim();
      if (!trimmedEmail.includes('@')) continue;
      targets.push({ manualFunderName: m.name.trim() || trimmedEmail, toEmails: [trimmedEmail] });
    }
    if (targets.length === 0) {
      alert('None of the selected funders have a submission email configured.');
      setSending(false);
      return;
    }

    const fd = new FormData();
    if (dealId) fd.append('dealId', dealId);
    fd.append('dealName', dealName.trim());
    // Prepend the formatted intake summary to the email body so the
    // funder receives the open balances / prior history / recent
    // funding context above the broker's free-form notes. The intake
    // is also persisted on the deal record so re-shopping pre-fills.
    const intakeSummary = formatIntakeMessage(openBalances, priorHistoryMode, priorHistoryDetails, recentFundings);
    const composedBody = intakeSummary ? `${intakeSummary}\n\n${notes}`.trim() : notes;
    fd.append('bodyNotes', composedBody);
    // Best-effort persist of intake on the deal so it's there next time
    // this deal is shopped. Fire-and-forget — submission goes ahead even
    // if the persist call hits a transient error.
    if (dealId) {
      const intake = buildIntakePayload(openBalances, priorHistoryMode, priorHistoryDetails, recentFundings, notes);
      fetch(`/api/deals/${dealId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionIntake: intake }),
      }).catch(() => {});
    }
    fd.append('funders', JSON.stringify(targets));
    if (assignedRepId) fd.append('assignedRepId', assignedRepId);
    fd.append('ccEmails', JSON.stringify(ccList));
    for (let i = 0; i < attachments.length; i++) {
      fd.append(`attachment_${i}`, attachments[i]);
    }

    try {
      // 90-second client-side abort so the user isn't stuck staring at
      // "Sending…" if the server hangs or the network drops. The route's
      // own maxDuration is 60s; this gives a small buffer above that so
      // server-level errors come through before we abort.
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 90_000);

      let res: Response;
      try {
        res = await fetch('/api/submissions/send', {
          method: 'POST',
          body: fd,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(abortTimer);
      }

      const json = await res.json().catch(() => ({ error: 'Server returned an invalid response.' }));
      if (!res.ok) {
        alert(json.error || `Send failed (HTTP ${res.status}).`);
        setSending(false);
        return;
      }
      const rs = (json.results ?? []).map((r: { funderName?: string; toEmails?: string[]; toEmail?: string; success: boolean; error?: string }) => ({
        funderName: r.funderName ?? (Array.isArray(r.toEmails) ? r.toEmails.join(', ') : r.toEmail ?? ''),
        toEmails: r.toEmails ?? (r.toEmail ? [r.toEmail] : []),
        success: r.success,
        message: r.error || (r.success ? 'Sent' : 'Failed'),
      }));
      setSendResults(rs);

      const okCount = rs.filter((r: { success: boolean }) => r.success).length;
      if (okCount > 0 && rs.every((r: { success: boolean }) => r.success)) {
        // Replace the old `confirm()` browser popup with an in-page modal.
        setShowPostSendConfirm(true);
      }
    } catch (err) {
      // AbortError = our 90s timeout. Anything else = network / fetch issue.
      const msg = (err as Error).name === 'AbortError'
        ? 'Send timed out after 90 seconds. The SMTP server may be slow or unreachable. Check your SMTP settings and try again.'
        : 'Network error: ' + (err as Error).message;
      alert(msg);
    } finally {
      setSending(false);
    }
  }

  // Load match options + funder details once
  useEffect(() => {
    fetch('/api/settings/match-options')
      .then((r) => r.json())
      .then((j) => {
        const grouped = j.data ?? {};
        setCreditRanges(grouped.credit_range ?? []);
        setRevenueRanges(grouped.revenue_range ?? []);
        setIndustries(grouped.industry ?? []);
        setDealTypes(grouped.deal_type ?? []);
        setPositionOptions(grouped.position_option ?? []);
        setStateOptions(grouped.state ?? []);
      })
      .catch(() => {});

    fetch('/api/funders', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        const list: FunderDetail[] = j.data ?? j.funders ?? [];
        const m = new Map<string, FunderDetail>();
        list.forEach((f) => m.set(f.id, f));
        setFunderMap(m);
      })
      .catch(() => {});
  }, []);

  function getRevenueValue(): number {
    if (!revenueOption) return 0;
    const opt = revenueRanges.find((r) => r.value === revenueOption);
    if (!opt) return 0;
    const min = Number((opt.meta as any)?.minRevenue ?? 0);
    const max = Number((opt.meta as any)?.maxRevenue ?? min * 2);
    return max ? Math.floor((min + max) / 2) : min;
  }

  function getCreditScoreValue(): number | null {
    const opt = creditRanges.find((r) => r.value === creditOption);
    if (!opt) return null;
    const v = (opt.meta as any)?.minScore;
    return v === undefined || v === null ? null : Number(v);
  }

  async function runMatch(opts: { silent?: boolean } = {}) {
    setError(null);
    // In live/auto mode, missing fields just clear the result instead of
    // raising an error toast. In explicit mode (user clicked the button),
    // we keep the old strict validation so the user sees what's missing.
    const minimumPresent = revenueOption && position;
    if (!minimumPresent) {
      if (!opts.silent) {
        if (!revenueOption) { setError('Pick a revenue range.'); return; }
        if (!position) { setError('Pick number of positions.'); return; }
      }
      // Silent mode: clear any prior results so the right panel falls back
      // to the "all funders" picker. Don't show an error.
      setResults(null);
      return;
    }

    const monthlyRevenue = getRevenueValue();
    const creditScoreValue = getCreditScoreValue();

    setLoading(true);
    try {
      const res = await fetch('/api/deal-shop/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthlyRevenue,
          creditScoreValue,
          positions: parseInt(position) || 0,
          industry,
          state,
          dealType,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (!opts.silent) setError(json.error || 'Match failed');
        setResults(null);
        return;
      }
      setResults(json);
      setActiveTier('all');
      // DON'T clear selections on a silent re-match — the user may have
      // already picked funders and we don't want their checks to drop as
      // the criteria refines. On explicit clicks we DO reset since that's
      // typically "start over."
      if (!opts.silent) {
        setExpanded(new Set());
        setSelectedFunders(new Set());
      }
    } finally {
      setLoading(false);
    }
  }

  // Live matching — auto-trigger when criteria changes. 300ms debounce so
  // dragging through select dropdowns doesn't spam the API. Silent mode so
  // missing fields just blank the right panel instead of showing errors.
  useEffect(() => {
    const t = setTimeout(() => { runMatch({ silent: true }); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revenueOption, creditOption, position, industry, state, dealType]);

  function toggleFunderSel(id: string) {
    setSelectedFunders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllMatched() {
    const all = results?.matched.map((m) => m.funderId) ?? [];
    setSelectedFunders(new Set(all));
  }

  function clearSelection() {
    setSelectedFunders(new Set());
  }

  /**
   * Toggle every matched funder in a single tier on/off in one click.
   *
   * Behavior: if EVERY matched funder in this tier is already selected,
   * deselect them all (toggle off). Otherwise add them all to the
   * selection (without disturbing selections from other tiers). This lets
   * the broker shop a whole tier in one click — "select all A-Paper" —
   * instead of having to check every row individually.
   *
   * Source data:
   *   • `tier` set to a tierGroup.tier value → uses the match engine's
   *     matched list filtered to that tier.
   *   • When no match has run, `manualFunderIds` is supplied (the no-match
   *     fallback view computes its own tier groups from funderMap and
   *     calls this with the funder ids it wants).
   */
  function toggleSelectTier(funderIds: string[]) {
    if (funderIds.length === 0) return;
    setSelectedFunders((prev) => {
      const next = new Set(prev);
      const allAlreadyIn = funderIds.every((id) => next.has(id));
      if (allAlreadyIn) {
        for (const id of funderIds) next.delete(id);
      } else {
        for (const id of funderIds) next.add(id);
      }
      return next;
    });
  }

  // Group results by tier. Each result is already a (funder, tier) pair —
  // matched independently per tier — so a funder can show up under both
  // "A-Paper" (with one verdict) and "Subprime" (with a different verdict).
  const tierGroups = useMemo(() => {
    if (!results) return [];
    const map = new Map<string, { matched: MatchResult[]; excluded: MatchResult[] }>();
    function tierFor(r: MatchResult): string {
      return r.tierName ?? 'Untiered';
    }
    for (const m of results.matched) {
      const t = tierFor(m);
      if (!map.has(t)) map.set(t, { matched: [], excluded: [] });
      map.get(t)!.matched.push(m);
    }
    for (const e of results.excluded) {
      const t = tierFor(e);
      if (!map.has(t)) map.set(t, { matched: [], excluded: [] });
      map.get(t)!.excluded.push(e);
    }
    return Array.from(map.entries()).map(([tier, v]) => ({ tier, ...v })).sort((a, b) => a.tier.localeCompare(b.tier));
  }, [results]);

  // Funder-name text search. Filters BOTH the match results view AND the
  // no-match manual picker view so the broker can narrow down by name in
  // either flow. Case-insensitive substring match. Tier filter (above) and
  // this search compose — tier narrows by category, this narrows by name.
  const [funderSearch, setFunderSearch] = useState('');
  const funderSearchQ = funderSearch.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    const base = activeTier === 'all' ? tierGroups : tierGroups.filter((g) => g.tier === activeTier);
    if (!funderSearchQ) return base;
    // Apply name filter to both matched + excluded inside each tier; drop
    // groups that become empty so the user doesn't see empty section heads.
    return base
      .map((g) => ({
        ...g,
        matched: g.matched.filter((m) => (m.funderName ?? '').toLowerCase().includes(funderSearchQ)),
        excluded: g.excluded.filter((m) => (m.funderName ?? '').toLowerCase().includes(funderSearchQ)),
      }))
      .filter((g) => g.matched.length > 0 || g.excluded.length > 0);
  }, [tierGroups, activeTier, funderSearchQ]);
  const totalMatched = results?.matched.length ?? 0;
  const totalExcluded = results?.excluded.length ?? 0;

  /**
   * Group ALL active funders by tier for the no-match manual picker.
   *
   * Unlike the match-engine tier groups (which are scoped to the match
   * results), this iterates the full funderMap so the broker can sort all
   * known funders by tier even before running a match. A funder belonging
   * to multiple tiers appears in each — same convention as the match view.
   * An "Untiered" bucket captures funders with no tier assignment.
   */
  const manualTierGroups = useMemo(() => {
    if (results) return [];
    const map = new Map<string, FunderDetail[]>();
    for (const f of funderMap.values()) {
      const tiers = (f.tiers ?? []).filter((t) => t && t.name);
      if (tiers.length === 0) {
        if (!map.has('Untiered')) map.set('Untiered', []);
        map.get('Untiered')!.push(f);
      } else {
        for (const t of tiers) {
          if (!map.has(t.name)) map.set(t.name, []);
          map.get(t.name)!.push(f);
        }
      }
    }
    return Array.from(map.entries())
      .map(([tier, funders]) => ({ tier, funders: funders.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.tier.localeCompare(b.tier));
  }, [results, funderMap]);

  const filteredManualGroups = useMemo(() => {
    const base = activeManualTier === 'all' ? manualTierGroups : manualTierGroups.filter((g) => g.tier === activeManualTier);
    if (!funderSearchQ) return base;
    return base
      .map((g) => ({
        ...g,
        funders: g.funders.filter((f) => f.name.toLowerCase().includes(funderSearchQ)),
      }))
      .filter((g) => g.funders.length > 0);
  }, [manualTierGroups, activeManualTier, funderSearchQ]);

  function toggleExpand(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  function clearForm() {
    setRevenueOption('');
    setCreditOption('unknown');
    setPosition('');
    setIndustry('other');
    setState('other');
    setDealType('standard_mca');
    setResults(null);
    setError(null);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shop & Submit"
        description="Enter deal criteria, see matching funders, select the ones you want, then send — all on one page."
      />

      {/* ====================================================================
          SPLIT LAYOUT
          Left column (5/12 ≈ 42%): compact deal profile + send form.
          Right column (7/12 ≈ 58%): match results, ALWAYS visible. When no
          criteria have been entered the right panel shows the full active
          funder list so the user can pick directly without doing intake.
          On narrow screens we stack (single column), preserving order.
          ==================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">

        {/* ============ LEFT COLUMN — DEAL PROFILE + SEND ============ */}
        <div className="lg:col-span-5 space-y-3 min-w-0">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-border">
              <Search className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Deal Profile</h2>
              <span className="text-[10px] text-muted-foreground ml-auto">Live matching — right panel updates as you type</span>
            </div>

            {/* Compact 2-col grid — Revenue/Credit/Position/Industry/State.
                Drop the generous gap-4 + p-6 of the original centered card. */}
            <div className="grid grid-cols-2 gap-2">
              {/* Revenue */}
              <Field label="Monthly Revenue" required>
                <Select value={revenueOption} onChange={setRevenueOption} options={[
                  { value: '', label: '— Pick —' },
                  ...revenueRanges.map((r) => ({ value: r.value, label: r.label })),
                ]} />
              </Field>

              {/* Credit */}
              <Field label="Credit">
                <Select value={creditOption} onChange={setCreditOption} options={
                  creditRanges.map((c) => ({ value: c.value, label: c.label }))
                } />
              </Field>

              {/* Position */}
              <Field label="Positions" required>
                <Select value={position} onChange={setPosition} options={[
                  { value: '', label: '— Pick —' },
                  ...positionOptions.map((p) => ({ value: p.value, label: p.label })),
                ]} />
              </Field>

              {/* Industry */}
              <Field label="Industry">
                <Select value={industry} onChange={setIndustry} options={[
                  ...industries.map((i) => ({ value: i.value, label: i.label })),
                ]} />
              </Field>

              {/* State */}
              <Field label="State" className="col-span-2">
                <Select value={state} onChange={setState} options={[
                  { value: 'other', label: 'Other / N/A' },
                  ...(stateOptions.length > 0
                    ? stateOptions.map((s) => ({ value: s.value, label: s.label }))
                    : US_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }))
                  ),
                ]} />
              </Field>

              {/* Deal type — compact chip row instead of large stacked buttons */}
              <Field label="Deal Type" className="col-span-2">
                <div className="grid grid-cols-2 gap-1.5">
                  {dealTypes.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => setDealType(d.value)}
                      className={cn(
                        'px-2.5 py-1.5 rounded border text-xs font-medium transition',
                        dealType === d.value
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
                      )}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            {error && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <Button variant="ghost" size="sm" onClick={clearForm} type="button">Clear</Button>
              {loading && <span className="text-[11px] text-muted-foreground italic">Matching…</span>}
            </div>
          </CardContent>
        </Card>

        {/* ====================================================================
            SEND TO SELECTED FUNDERS — left column, below intake.
            Becomes interactive only when at least one funder is selected on
            the right panel. The rep CC checkbox makes the rep email opt-in
            rather than auto-CC'd (per spec).
            ==================================================================== */}
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                Send to selected funders
                {selectedFunders.size > 0 && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({selectedFunders.size})
                  </span>
                )}
              </h3>
              {fromEmail && (
                <span className="text-[10px] text-muted-foreground truncate">
                  From: <strong className="text-foreground">{fromEmail}</strong>
                </span>
              )}
            </div>

            {smtpConfigured === false && (
              <div className="text-[11px] bg-amber-50 border border-amber-200 text-amber-900 rounded px-2.5 py-1.5">
                ⚠️ Email not configured. Set up SMTP in Settings.
              </div>
            )}

            <div className="grid grid-cols-1 gap-2">
              <Field label="Deal name">
                <Input
                  value={dealName}
                  onChange={(e) => setDealName(e.target.value)}
                  disabled={dealNameLocked}
                  placeholder="Acme Pizza – 2nd position"
                />
                {dealNameLocked && (
                  <div className="text-[10px] text-muted-foreground mt-1">Locked to existing deal</div>
                )}
              </Field>
              <Field label="Assigned rep (optional)">
                <select
                  value={assignedRepId}
                  onChange={(e) => setAssignedRepId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                >
                  <option value="">— Unassigned —</option>
                  {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                {/* Opt-in CC checkbox — replaces the previous auto-CC behavior
                    so the rep isn't force-added to every send. Only renders
                    when a rep is actually selected. */}
                {assignedRepId && (
                  <label className="flex items-center gap-1.5 mt-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ccAssignedRep}
                      onChange={(e) => setCcAssignedRep(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border accent-[var(--primary,#2563eb)]"
                    />
                    <span className="text-muted-foreground">
                      Also CC this rep ({reps.find((r) => r.id === assignedRepId)?.email})
                    </span>
                  </label>
                )}
              </Field>
            </div>

            {/* Submission intake — expandable section. Collapsed by
                default; broker presses Expand form to open it. Captures
                structured deal context (open balances, prior history,
                recent fundings) that gets formatted into the submission
                message AND persists on the deal record so re-shopping
                pre-fills automatically. */}
            <SubmissionIntakeSection
              expanded={intakeOpen}
              onToggle={() => setIntakeOpen((v) => !v)}
              openBalances={openBalances}
              setOpenBalances={setOpenBalances}
              priorHistoryMode={priorHistoryMode}
              setPriorHistoryMode={setPriorHistoryMode}
              priorHistoryDetails={priorHistoryDetails}
              setPriorHistoryDetails={setPriorHistoryDetails}
              recentFundings={recentFundings}
              setRecentFundings={setRecentFundings}
              dealId={dealId}
              notesPreview={notes}
              saving={savingIntake}
              onSave={async () => {
                if (!dealId) return;
                setSavingIntake(true);
                const intake = buildIntakePayload(openBalances, priorHistoryMode, priorHistoryDetails, recentFundings, notes);
                const res = await fetch(`/api/deals/${dealId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ submissionIntake: intake }),
                });
                setSavingIntake(false);
                // No toast for a silent persist — the in-section "Saved"
                // indicator covers it.
                return res.ok;
              }}
            />

            <Field label="Notes (appears at top of email)">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="$45k 1st position, 14 month tib, 660 fico…"
                className="w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm resize-y"
              />
            </Field>

            <Field label="Additional CC">
              <div className="space-y-1.5">
                <Input
                  value={ccInput}
                  onChange={(e) => setCcInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCc(); } }}
                  placeholder="someone@example.com — Enter to add"
                  type="email"
                />
                {ccList.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {ccList.map((email) => {
                      const isRep = !!(ccAssignedRep && assignedRepId && reps.find((r) => r.id === assignedRepId)?.email.toLowerCase() === email);
                      return (
                        <span key={email} className={cn(
                          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono',
                          isRep ? 'bg-blue-100 text-blue-900' : 'bg-muted text-foreground'
                        )}>
                          {isRep && <span className="text-[8px] uppercase font-sans font-semibold">rep</span>}
                          {email}
                          {!isRep && (
                            <button
                              onClick={() => removeCc(email)}
                              className="hover:text-destructive"
                              title="Remove"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </Field>

            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Attachments (optional)
              </div>
              <div className="space-y-1.5">
                {/*
                  Bulletproof file upload pattern:
                  An <input type="file"> positioned absolutely with opacity:0
                  COVERS the entire dropzone visual. The user clicks the visual,
                  which is actually the invisible input — so the native file
                  picker opens and onChange fires on the SAME element they
                  clicked. No label, no htmlFor, no ref.click() shim, no
                  nested-label conflicts.

                  Bonus: file inputs natively accept drag-drop. Dropping files
                  onto an <input type="file"> populates input.files and fires
                  onChange — no separate drop handler needed. We still call
                  preventDefault on dragover at the container level so the
                  browser doesn't open the file in a new tab if the user
                  misses the input.
                */}
                <div
                  className="relative"
                  onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
                  onDrop={() => setDragActive(false)}
                >
                  <div
                    className={cn(
                      'flex flex-col items-center justify-center gap-1 px-3 py-4 rounded-md border-2 border-dashed pointer-events-none transition-colors',
                      dragActive
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-muted/20'
                    )}
                  >
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                    <div className="text-xs text-muted-foreground text-center">
                      {dragActive
                        ? 'Drop files here'
                        : <><span className="font-medium text-foreground">Click to upload</span> or drag &amp; drop</>}
                    </div>
                    <div className="text-[10px] text-muted-foreground/70">PDF, images, docs — up to 25MB each</div>
                  </div>
                  {/* Transparent input layered on top — receives the click
                      directly so the browser's "user gesture" guarantee for
                      file pickers always holds. */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={(e) => onFilePick(e.target.files)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    title="Click to attach files"
                  />
                </div>
                {attachments.length > 0 && (
                  <div className="space-y-1">
                    {attachments.map((f, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-[11px] bg-muted/30 rounded px-2 py-1">
                        <span className="truncate flex-1">{f.name}</span>
                        <span className="text-muted-foreground tabular-nums">{(f.size / 1024).toFixed(0)} KB</span>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setAttachments(attachments.filter((_, x) => x !== i));
                          }}
                          className="text-muted-foreground hover:text-destructive shrink-0"
                          title="Remove"
                          type="button"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/*
              ───────── Manual / ad-hoc funders ─────────
              For one-off sends to a funder that isn't in the directory.
              The user types a name (optional — falls back to email) + an
              email; we tack it onto the targets array at send time. Not
              persisted — these don't get auto-added to /funders. If you
              shop the same off-directory funder repeatedly, add them to
              the directory the normal way.
            */}
            <div className="flex flex-col gap-1.5 pt-2 border-t border-border">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                One-off funder (not in directory)
              </div>
              {manualFunders.length > 0 && (
                <div className="space-y-1">
                  {manualFunders.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-2 py-0.5 px-2 rounded bg-amber-50 border border-amber-200 text-[11px]">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{m.name || '(no name)'}</div>
                        <div className="text-muted-foreground truncate break-all">{m.email}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setManualFunders(manualFunders.filter((x) => x.id !== m.id))}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
                <Input
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="Funder name"
                  className="h-8 text-xs"
                />
                <Input
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  placeholder="email@funder.com"
                  type="email"
                  className="h-8 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const email = manualEmail.trim();
                      if (!email.includes('@')) return;
                      setManualFunders([...manualFunders, { id: Math.random().toString(36).slice(2), name: manualName.trim(), email }]);
                      setManualName('');
                      setManualEmail('');
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const email = manualEmail.trim();
                    if (!email.includes('@')) { alert('Enter a valid email.'); return; }
                    setManualFunders([...manualFunders, { id: Math.random().toString(36).slice(2), name: manualName.trim(), email }]);
                    setManualName('');
                    setManualEmail('');
                  }}
                  className="h-8 px-2.5 rounded-md border border-input bg-card text-xs font-medium hover:bg-muted/40"
                >
                  + Add
                </button>
              </div>
            </div>

            <Button
              onClick={sendNow}
              disabled={sending || (selectedFunders.size === 0 && manualFunders.length === 0) || smtpConfigured === false}
              className="w-full"
            >
              <Send className="h-4 w-4 mr-2" />
              {sending
                ? 'Sending…'
                : (selectedFunders.size === 0 && manualFunders.length === 0)
                  ? 'Pick funders →'
                  : `Send to ${selectedFunders.size + manualFunders.length} funder${(selectedFunders.size + manualFunders.length) === 1 ? '' : 's'}`}
            </Button>

            {sendResults && (
              <div className="space-y-1 pt-2 border-t border-border">
                <div className="text-[11px] font-semibold">Send results</div>
                {sendResults.map((r, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex items-center justify-between gap-2 py-1 px-2 rounded border-l-2 text-[11px]',
                      r.success ? 'border-emerald-500 bg-emerald-50' : 'border-rose-500 bg-rose-50'
                    )}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{r.funderName}</div>
                      <div className="text-[9px] text-muted-foreground font-mono truncate">{r.toEmails.join(', ')}</div>
                    </div>
                    <div className={cn('shrink-0 text-[10px] font-medium', r.success ? 'text-emerald-700' : 'text-rose-700')}>
                      {r.success ? '✓ Sent' : `✗ ${r.message}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        </div>
        {/* ============ END LEFT COLUMN ============ */}

        {/* ============ RIGHT COLUMN — FUNDER MATCHES, ALWAYS VISIBLE ============ */}
        <div className="lg:col-span-7 space-y-3 lg:sticky lg:top-4 lg:self-start min-w-0">

      {/* Results section */}
      {results && (
        totalMatched === 0 && totalExcluded === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-sm text-muted-foreground">
              No funders configured yet. Add some in the <a href="/funders" className="text-primary hover:underline">Funders</a> tab.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1 gap-3 flex-wrap">
              <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground/80">
                Results — {totalMatched} qualifying, {totalExcluded} excluded
              </div>
              {totalMatched > 0 && (
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">
                    {selectedFunders.size > 0 ? `${selectedFunders.size} selected` : 'None selected'}
                  </span>
                  <button onClick={selectAllMatched} className="text-primary hover:underline font-medium">
                    Select all
                  </button>
                  {selectedFunders.size > 0 && (
                    <button onClick={clearSelection} className="text-muted-foreground hover:text-foreground">
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Funder name search — narrows the visible rows AFTER the tier
                filter, so tier counts stay accurate while typing a name.
                Useful when the broker knows the funder name and wants to
                jump directly to it without scanning. Empty = show all. */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={funderSearch}
                onChange={(e) => setFunderSearch(e.target.value)}
                placeholder="Search a funder by name…"
                className="h-8 w-full rounded-md border border-input bg-card pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring/60"
              />
              {funderSearch && (
                <button
                  type="button"
                  onClick={() => setFunderSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  title="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Tier filter + tier-select chips.
                Each chip is a split control:
                  • Left half (label + count badges) filters the view to
                    only show that tier.
                  • Right half (✓ button) selects/deselects every matched
                    funder in that tier in one click. Lets the broker
                    "shop everyone in A-Paper" without ticking each row.
                The "All tiers" chip's right button selects every matched
                funder across all tiers (same as the header "Select all"). */}
            <div className="flex flex-wrap gap-1.5">
              <div className={cn(
                'inline-flex items-stretch rounded-full border overflow-hidden text-xs font-medium transition-colors',
                activeTier === 'all'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
              )}>
                <button
                  onClick={() => setActiveTier('all')}
                  className="flex items-center gap-1.5 pl-2.5 pr-2 py-1"
                  title="Filter to show all tiers"
                >
                  All tiers
                  <span className={cn('tabular-nums px-1 rounded text-[10px]',
                    activeTier === 'all' ? 'bg-primary-foreground/20' : 'bg-muted')}>{totalMatched + totalExcluded}</span>
                </button>
                <button
                  onClick={selectAllMatched}
                  title={`Select all ${totalMatched} matched funders`}
                  className={cn(
                    'px-2 border-l flex items-center justify-center text-sm',
                    activeTier === 'all'
                      ? 'border-primary-foreground/30 hover:bg-primary-foreground/15'
                      : 'border-border hover:bg-muted'
                  )}
                >
                  ✓
                </button>
              </div>
              {tierGroups.map((g) => {
                const tierIds = g.matched.map((m) => m.funderId);
                const allInTierSelected = tierIds.length > 0 && tierIds.every((id) => selectedFunders.has(id));
                return (
                  <div
                    key={g.tier}
                    className={cn(
                      'inline-flex items-stretch rounded-full border overflow-hidden text-xs font-medium transition-colors max-w-[240px]',
                      activeTier === g.tier
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                    )}
                  >
                    <button
                      onClick={() => setActiveTier(g.tier)}
                      title={`Filter to ${g.tier} only`}
                      className="flex items-center gap-1.5 pl-2.5 pr-2 py-1 min-w-0"
                    >
                      <span className="truncate">{g.tier}</span>
                      <span className="flex items-center gap-0.5 shrink-0">
                        {g.matched.length > 0 && <Badge variant="success" className="text-[9px]">{g.matched.length}</Badge>}
                        {g.excluded.length > 0 && <Badge variant="default" className="text-[9px]">{g.excluded.length}</Badge>}
                      </span>
                    </button>
                    {tierIds.length > 0 && (
                      <button
                        onClick={() => toggleSelectTier(tierIds)}
                        title={allInTierSelected
                          ? `Deselect all ${tierIds.length} funders in ${g.tier}`
                          : `Select all ${tierIds.length} matched funders in ${g.tier}`}
                        className={cn(
                          'px-2 border-l flex items-center justify-center text-sm',
                          activeTier === g.tier
                            ? 'border-primary-foreground/30 hover:bg-primary-foreground/15'
                            : 'border-border hover:bg-muted',
                          allInTierSelected && (activeTier === g.tier ? 'bg-primary-foreground/15' : 'bg-emerald-50 text-emerald-700')
                        )}
                      >
                        {allInTierSelected ? '✓' : '+'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div>
              {/* Results table */}
              <div className="space-y-4 min-w-0">
                {/* Already-submitted bucket — only when the user navigated
                    here with a deal context (?dealId=). Shows EVERY funder
                    this deal has already been sent to so the user doesn't
                    accidentally re-shop the same funder. Server-side dedupe
                    still applies as a backstop. */}
                {dealId && alreadySubmitted.size > 0 && (
                  <Card className="border-blue-200 bg-blue-50/30">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Send className="h-3.5 w-3.5 text-blue-700" />
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-900">
                          Already submitted ({alreadySubmitted.size})
                        </h3>
                      </div>
                      <div className="space-y-1">
                        {Array.from(alreadySubmitted.values())
                          .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
                          .map((s) => {
                            // Match the per-funder status look to the rest of the app.
                            const statusLabel =
                              s.status === 'approved' ? 'Approved' :
                              s.status === 'declined' ? 'Declined' :
                              'Pending';
                            const statusTone =
                              s.status === 'approved' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                              s.status === 'declined' ? 'bg-rose-100 text-rose-800 border-rose-200' :
                              'bg-amber-100 text-amber-800 border-amber-200';
                            return (
                              <div key={s.funderName + s.submittedAt} className="flex items-center justify-between gap-2 text-xs py-1">
                                <span className="font-medium text-foreground truncate flex-1">{s.funderName}</span>
                                <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium border', statusTone)}>
                                  {statusLabel}
                                </span>
                                <span className="text-muted-foreground tabular-nums text-[10px] w-20 text-right shrink-0">
                                  {new Date(s.submittedAt).toLocaleDateString()}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {filteredGroups.map((g) => (
                  <div key={g.tier}>
                    {activeTier === 'all' && (
                      <div className="flex items-baseline gap-3 mb-2 px-1">
                        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/80">{g.tier}</h3>
                        <span className="text-xs text-muted-foreground">
                          {g.matched.length} qualifying · {g.excluded.length} excluded
                        </span>
                      </div>
                    )}

                    {g.matched.length > 0 && (
                      <Card className="overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-muted/40 border-b border-border">
                              <th className="w-10 px-3 py-2"></th>
                              <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-2">Funder</th>
                              <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Submission</th>
                              <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Primary email</th>
                              <th className="w-8"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {g.matched.map((m) => {
                              const f = funderMap.get(m.funderId);
                              const shoppingEmails: string[] = (f?.emails ?? []).filter(Boolean);
                              const primary = f?.contacts?.find((c) => c.email);
                              const displayEmail = shoppingEmails[0] ?? primary?.email ?? null;
                              const extraCount = shoppingEmails.length > 1 ? shoppingEmails.length - 1 : 0;
                              const isExpanded = expanded.has(m.funderId);
                              const isSelected = selectedFunders.has(m.funderId);
                              // Cross-reference against already-submitted list for THIS deal.
                              // If found, render a small "Already submitted" pill and gray
                              // the row so the user is much less likely to re-select it.
                              const sub = alreadySubmitted.get(m.funderId);
                              return (
                                <>
                                  <tr key={m.funderId} className={cn('hover:bg-muted/30', isSelected && 'bg-primary/5', sub && 'opacity-60')}>
                                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleFunderSel(m.funderId)}
                                        className="h-4 w-4 rounded border-border cursor-pointer accent-[var(--primary,#2563eb)]"
                                        title={sub ? 'Already submitted to this funder — selecting will be blocked server-side' : 'Select to shop this funder'}
                                      />
                                    </td>
                                    <td className="px-2 py-2.5 cursor-pointer" onClick={() => toggleExpand(m.funderId)}>
                                      <div className="flex items-center gap-2">
                                        <div className="h-2 w-2 rounded-full bg-emerald-500" />
                                        <span className="font-medium">{m.funderName}</span>
                                        {sub && (
                                          <span
                                            className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200"
                                            title={`Submitted ${new Date(sub.submittedAt).toLocaleDateString()} — status: ${sub.status}`}
                                          >
                                            Already sent
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2.5 cursor-pointer" onClick={() => toggleExpand(m.funderId)}>
                                      <Badge variant="outline" className="text-[10px]">{f?.submissionMethod ?? 'email'}</Badge>
                                    </td>
                                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground truncate max-w-[220px] cursor-pointer" onClick={() => toggleExpand(m.funderId)}>
                                      {displayEmail ?? '—'}
                                      {extraCount > 0 && (
                                        <span className="ml-1.5 text-[10px] not-italic font-sans px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                          +{extraCount}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-2 py-2.5 text-muted-foreground cursor-pointer" onClick={() => toggleExpand(m.funderId)}>
                                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </td>
                                  </tr>
                                  {isExpanded && f && (
                                    <tr className="bg-muted/20">
                                      <td colSpan={5} className="px-4 py-3">
                                        <FunderDetailRow funder={f} />
                                      </td>
                                    </tr>
                                  )}
                                </>
                              );
                            })}
                          </tbody>
                        </table>
                      </Card>
                    )}

                    {g.excluded.length > 0 && (
                      <details className="mt-2 group">
                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground py-1.5 px-2 flex items-center gap-1.5">
                          <ChevronRight className="h-3 w-3 group-open:rotate-90 transition-transform" />
                          {g.excluded.length} not qualifying
                        </summary>
                        <Card className="mt-1">
                          <CardContent className="p-0 divide-y divide-border/60">
                            {g.excluded.map((e) => (
                              <div key={e.funderId} className="px-4 py-2 flex items-center justify-between gap-2 text-xs">
                                <span className="font-medium text-muted-foreground truncate">{e.funderName}</span>
                                {/* Compact short-form reason badges. The full
                                    sentence-form text from the engine is kept
                                    in the title attribute so a user can hover
                                    to see e.g. "Min revenue $50,000, deal has
                                    $42,000" instead of just "Revenue Too Low". */}
                                <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[70%]">
                                  {(e.reasonCodes && e.reasonCodes.length > 0
                                    ? e.reasonCodes
                                    : ['restricted_state'] // never empty for an excluded row
                                  ).map((code) => {
                                    const label = EXCLUSION_LABELS[code as keyof typeof EXCLUSION_LABELS] ?? 'Restricted';
                                    // Pull the matching detailed reason for the tooltip
                                    const detail = e.reasons.find((r) => !r.includes('OK')) ?? '';
                                    return (
                                      <span
                                        key={code}
                                        title={detail}
                                        className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200"
                                      >
                                        {label}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      )}

      {/* Manual funder picker — shown when no match has been run (criteria
          incomplete). Lets the broker who already knows where to shop just
          pick funders directly without entering deal info. The same
          selectedFunders state drives the send form on the left.

          Tier chips work exactly like the matched view: left half filters
          to that tier, right half selects/deselects every funder in it. */}
      {!results && (
        <Card>
          <CardContent className="p-3 space-y-3">
            <div className="flex items-baseline justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
                Active funders ({funderMap.size})
              </h3>
              <span className="text-[10px] text-muted-foreground italic">
                Enter criteria for matching · or pick directly
              </span>
            </div>

            {funderMap.size === 0 ? (
              <div className="text-xs text-muted-foreground py-6 text-center">
                No funders configured yet. Add some in the <a href="/funders" className="text-primary hover:underline">Funders</a> tab.
              </div>
            ) : (
              <>
                {/* Funder name search — same control as the matched view.
                    Visible regardless of tier count so the broker can pick
                    a specific funder by name when nothing has matched yet. */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={funderSearch}
                    onChange={(e) => setFunderSearch(e.target.value)}
                    placeholder="Search a funder by name…"
                    className="h-8 w-full rounded-md border border-input bg-card pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring/60"
                  />
                  {funderSearch && (
                    <button
                      type="button"
                      onClick={() => setFunderSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      title="Clear search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Tier chip row — same split-control UX as the matched
                    view. Empty tier rosters get no chip. */}
                {manualTierGroups.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    <div className={cn(
                      'inline-flex items-stretch rounded-full border overflow-hidden text-xs font-medium transition-colors',
                      activeManualTier === 'all'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                    )}>
                      <button
                        onClick={() => setActiveManualTier('all')}
                        className="flex items-center gap-1.5 pl-2.5 pr-2 py-1"
                        title="Show all funders, grouped by tier"
                      >
                        All tiers
                        <span className={cn('tabular-nums px-1 rounded text-[10px]',
                          activeManualTier === 'all' ? 'bg-primary-foreground/20' : 'bg-muted')}>{funderMap.size}</span>
                      </button>
                      <button
                        onClick={() => toggleSelectTier(Array.from(funderMap.keys()))}
                        title={`Select all ${funderMap.size} active funders`}
                        className={cn(
                          'px-2 border-l flex items-center justify-center text-sm',
                          activeManualTier === 'all'
                            ? 'border-primary-foreground/30 hover:bg-primary-foreground/15'
                            : 'border-border hover:bg-muted'
                        )}
                      >
                        ✓
                      </button>
                    </div>
                    {manualTierGroups.map((g) => {
                      const tierIds = g.funders.map((f) => f.id);
                      const allInTierSelected = tierIds.length > 0 && tierIds.every((id) => selectedFunders.has(id));
                      return (
                        <div
                          key={g.tier}
                          className={cn(
                            'inline-flex items-stretch rounded-full border overflow-hidden text-xs font-medium transition-colors max-w-[240px]',
                            activeManualTier === g.tier
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                          )}
                        >
                          <button
                            onClick={() => setActiveManualTier(g.tier)}
                            title={`Filter to ${g.tier} only`}
                            className="flex items-center gap-1.5 pl-2.5 pr-2 py-1 min-w-0"
                          >
                            <span className="truncate">{g.tier}</span>
                            <span className={cn('tabular-nums px-1 rounded text-[9px]',
                              activeManualTier === g.tier ? 'bg-primary-foreground/20' : 'bg-muted')}>
                              {g.funders.length}
                            </span>
                          </button>
                          <button
                            onClick={() => toggleSelectTier(tierIds)}
                            title={allInTierSelected
                              ? `Deselect all ${tierIds.length} funders in ${g.tier}`
                              : `Select all ${tierIds.length} funders in ${g.tier}`}
                            className={cn(
                              'px-2 border-l flex items-center justify-center text-sm',
                              activeManualTier === g.tier
                                ? 'border-primary-foreground/30 hover:bg-primary-foreground/15'
                                : 'border-border hover:bg-muted',
                              allInTierSelected && (activeManualTier === g.tier ? 'bg-primary-foreground/15' : 'bg-emerald-50 text-emerald-700')
                            )}
                          >
                            {allInTierSelected ? '✓' : '+'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="max-h-[calc(100vh-260px)] overflow-y-auto space-y-3">
                  {filteredManualGroups.map((g) => (
                    <div key={g.tier}>
                      {/* Only render the tier header when "all tiers" is
                          active. When the user has filtered to a single
                          tier the header is redundant with the chip. */}
                      {activeManualTier === 'all' && (
                        <div className="flex items-baseline gap-2 mb-1 px-1">
                          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-foreground/70">{g.tier}</h4>
                          <span className="text-[10px] text-muted-foreground">{g.funders.length}</span>
                        </div>
                      )}
                      <div className="divide-y divide-border/60 rounded border border-border/60 overflow-hidden">
                        {g.funders.map((f) => {
                          const shoppingEmails: string[] = (f.emails ?? []).filter(Boolean);
                          const primary = f.contacts?.find((c) => c.email);
                          const displayEmail = shoppingEmails[0] ?? primary?.email ?? null;
                          const isSelected = selectedFunders.has(f.id);
                          const sub = alreadySubmitted.get(f.id);
                          return (
                            <label
                              key={`${g.tier}-${f.id}`}
                              className={cn(
                                'flex items-center gap-2 py-1.5 px-2 cursor-pointer hover:bg-muted/30',
                                isSelected && 'bg-primary/5',
                                sub && 'opacity-60'
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleFunderSel(f.id)}
                                className="h-4 w-4 rounded border-border accent-[var(--primary,#2563eb)]"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate flex items-center gap-1.5">
                                  {f.name}
                                  {sub && (
                                    <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-blue-100 text-blue-800">
                                      Already sent
                                    </span>
                                  )}
                                </div>
                                {displayEmail && (
                                  <div className="text-[10px] text-muted-foreground font-mono truncate">{displayEmail}</div>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

        </div>
        {/* ============ END RIGHT COLUMN ============ */}

      </div>
      {/* ============ END SPLIT LAYOUT ============ */}

      {/* Post-send confirmation — replaces the old browser-top confirm popup */}
      <ConfirmDialog
        open={showPostSendConfirm}
        title="All emails sent successfully"
        description="Want to head over to the Submissions page to track responses?"
        confirmLabel="View Submissions"
        cancelLabel="Stay here"
        onConfirm={() => router.push('/submissions')}
        onCancel={() => setShowPostSendConfirm(false)}
      />
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function FunderDetailRow({ funder }: { funder: FunderDetail }) {
  const submissionEmails = (funder.emails ?? []).filter((e) => e && e.includes('@'));
  const contacts = funder.contacts ?? [];
  const phoneContacts = contacts.filter((c) => c.phone || c.name);
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
      {submissionEmails.length > 0 && (
        <div>
          <div className="font-semibold uppercase tracking-wider text-[9px] text-muted-foreground mb-1.5 flex items-center gap-1">
            <Mail className="h-3 w-3" /> Submission emails ({submissionEmails.length})
          </div>
          <div className="space-y-0.5">
            {submissionEmails.map((e, i) => <div key={i} className="font-mono text-foreground">{e}</div>)}
          </div>
        </div>
      )}
      {phoneContacts.length > 0 && (
        <div>
          <div className="font-semibold uppercase tracking-wider text-[9px] text-muted-foreground mb-1.5 flex items-center gap-1">
            <Phone className="h-3 w-3" /> Contact
          </div>
          <div className="space-y-0.5">
            {phoneContacts.map((c, i) => (
              <div key={i}>
                <span className="font-medium">{c.name}</span>{' '}
                {c.phone && <span className="text-muted-foreground">{c.phone}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {((funder.restrictedStates?.length ?? 0) > 0 || (funder.restrictedIndustries?.length ?? 0) > 0 || funder.notes) && (
        <div className="bg-amber-50 border border-amber-200 rounded p-2.5 text-amber-900 space-y-1">
          {(funder.restrictedStates ?? []).length > 0 && (
            <div className="flex items-start gap-1">
              <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
              <span>Not in: {funder.restrictedStates!.join(', ')}</span>
            </div>
          )}
          {(funder.restrictedIndustries ?? []).length > 0 && (
            <div className="flex items-start gap-1">
              <Ban className="h-3 w-3 mt-0.5 shrink-0" />
              <span>No: {funder.restrictedIndustries!.join(', ')}</span>
            </div>
          )}
          {funder.notes && (
            <div className="flex items-start gap-1">
              <FileText className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{funder.notes}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * Submission intake section
 * ─────────────────────────────────────────────────────────────────────
 * Expandable form embedded on /deal-shop that captures the structured
 * "what to send the funder" context. Sits between the merchant info
 * inputs and the Notes field. The output is a formatted message block
 * that gets prepended to the email body when shopping AND persists on
 * the deal record so re-shopping starts from the same context.
 *
 * Sections (all optional):
 *   • Open balances    — list of (funder, amount) rows. Output:
 *                          Open Balances:
 *                            LG $150K
 *                            XYZ $50K
 *   • Prior history    — yes / no toggle. "No" prints "No prior history
 *                        to current positions." "Yes" prints "Has prior
 *                        history to current positions" + optional detail
 *                        text (e.g. "merchant is paying for a few years").
 *   • Recent funding   — list of (company, amount, date) rows. Output:
 *                          Recent Funding:
 *                            LG funded $150K on 5/29
 *
 * Closed by default — broker presses Expand form to open. Each subsection
 * has its own + button to add rows; trash icon per row to remove.
 * ───────────────────────────────────────────────────────────────────── */

function SubmissionIntakeSection({
  expanded,
  onToggle,
  openBalances,
  setOpenBalances,
  priorHistoryMode,
  setPriorHistoryMode,
  priorHistoryDetails,
  setPriorHistoryDetails,
  recentFundings,
  setRecentFundings,
  dealId,
  notesPreview,
  saving,
  onSave,
}: {
  expanded: boolean;
  onToggle: () => void;
  openBalances: { id: string; funder: string; amount: string }[];
  setOpenBalances: React.Dispatch<React.SetStateAction<{ id: string; funder: string; amount: string }[]>>;
  priorHistoryMode: 'unset' | 'yes' | 'no';
  setPriorHistoryMode: React.Dispatch<React.SetStateAction<'unset' | 'yes' | 'no'>>;
  priorHistoryDetails: string;
  setPriorHistoryDetails: React.Dispatch<React.SetStateAction<string>>;
  recentFundings: { id: string; company: string; amount: string; date: string }[];
  setRecentFundings: React.Dispatch<React.SetStateAction<{ id: string; company: string; amount: string; date: string }[]>>;
  dealId: string | null;
  notesPreview: string;
  saving: boolean;
  onSave: () => Promise<boolean | undefined>;
}) {
  const [savedFlash, setSavedFlash] = useState(false);

  function addOpenBalance() {
    setOpenBalances((arr) => [...arr, { id: cryptoId(), funder: '', amount: '' }]);
  }
  function removeOpenBalance(id: string) {
    setOpenBalances((arr) => arr.filter((r) => r.id !== id));
  }
  function updateOpenBalance(id: string, patch: Partial<{ funder: string; amount: string }>) {
    setOpenBalances((arr) => arr.map((r) => r.id === id ? { ...r, ...patch } : r));
  }
  function addRecentFunding() {
    setRecentFundings((arr) => [...arr, { id: cryptoId(), company: '', amount: '', date: '' }]);
  }
  function removeRecentFunding(id: string) {
    setRecentFundings((arr) => arr.filter((r) => r.id !== id));
  }
  function updateRecentFunding(id: string, patch: Partial<{ company: string; amount: string; date: string }>) {
    setRecentFundings((arr) => arr.map((r) => r.id === id ? { ...r, ...patch } : r));
  }

  // Live preview — same format that ends up prepended to the email body.
  const preview = formatIntakeMessage(openBalances, priorHistoryMode, priorHistoryDetails, recentFundings);

  async function handleSave() {
    const ok = await onSave();
    if (ok) {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    }
  }

  return (
    <div className="border border-border rounded-md bg-card/50">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/30 rounded-t-md"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2">
          <span className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>▸</span>
          <span>Submission intake</span>
          <span className="text-[10px] text-muted-foreground font-normal">
            (optional — open balances, prior history, recent funding)
          </span>
        </span>
        <span className="text-[11px] text-primary">
          {expanded ? 'Collapse' : 'Expand form'}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-4 border-t border-border">
          {/* Open balances */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Open balances</div>
              <button type="button" onClick={addOpenBalance} className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">
                <span className="text-base leading-none">+</span> Add position
              </button>
            </div>
            {openBalances.length === 0 ? (
              <div className="text-[11px] text-muted-foreground italic">No positions added.</div>
            ) : (
              <div className="space-y-1.5">
                {openBalances.map((row) => (
                  <div key={row.id} className="flex items-center gap-2">
                    <input
                      value={row.funder}
                      onChange={(e) => updateOpenBalance(row.id, { funder: e.target.value })}
                      placeholder="Funder name (e.g. LG)"
                      className="h-8 flex-1 rounded-md border border-input bg-card px-2 text-xs"
                    />
                    <input
                      value={row.amount}
                      onChange={(e) => updateOpenBalance(row.id, { amount: e.target.value })}
                      placeholder="$150K"
                      className="h-8 w-28 rounded-md border border-input bg-card px-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => removeOpenBalance(row.id)}
                      className="text-muted-foreground hover:text-destructive p-1 text-xs"
                      title="Remove"
                      aria-label="Remove position"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Prior history toggle */}
          <div className="space-y-2 pt-3 border-t border-border">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Prior history to current positions</div>
            <div className="inline-flex rounded-md border border-input bg-card p-0.5" role="radiogroup" aria-label="Prior history">
              <button
                type="button"
                role="radio"
                aria-checked={priorHistoryMode === 'unset'}
                onClick={() => setPriorHistoryMode('unset')}
                className={`h-8 px-3 rounded text-xs font-medium ${priorHistoryMode === 'unset' ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Not specified
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={priorHistoryMode === 'no'}
                onClick={() => setPriorHistoryMode('no')}
                className={`h-8 px-3 rounded text-xs font-medium ${priorHistoryMode === 'no' ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                No
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={priorHistoryMode === 'yes'}
                onClick={() => setPriorHistoryMode('yes')}
                className={`h-8 px-3 rounded text-xs font-medium ${priorHistoryMode === 'yes' ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Yes
              </button>
            </div>
            {priorHistoryMode === 'yes' && (
              <textarea
                value={priorHistoryDetails}
                onChange={(e) => setPriorHistoryDetails(e.target.value)}
                rows={2}
                placeholder="e.g. merchant is paying for a few years"
                className="w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-xs resize-y"
              />
            )}
          </div>

          {/* Recent funding */}
          <div className="space-y-2 pt-3 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Recent funding</div>
              <button type="button" onClick={addRecentFunding} className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">
                <span className="text-base leading-none">+</span> Add position
              </button>
            </div>
            {recentFundings.length === 0 ? (
              <div className="text-[11px] text-muted-foreground italic">No recent funding added.</div>
            ) : (
              <div className="space-y-1.5">
                {recentFundings.map((row) => (
                  <div key={row.id} className="flex items-center gap-2">
                    <input
                      value={row.company}
                      onChange={(e) => updateRecentFunding(row.id, { company: e.target.value })}
                      placeholder="Company (e.g. LG)"
                      className="h-8 flex-1 rounded-md border border-input bg-card px-2 text-xs"
                    />
                    <input
                      value={row.amount}
                      onChange={(e) => updateRecentFunding(row.id, { amount: e.target.value })}
                      placeholder="$150K"
                      className="h-8 w-24 rounded-md border border-input bg-card px-2 text-xs"
                    />
                    <input
                      value={row.date}
                      onChange={(e) => updateRecentFunding(row.id, { date: e.target.value })}
                      placeholder="5/29"
                      className="h-8 w-20 rounded-md border border-input bg-card px-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => removeRecentFunding(row.id)}
                      className="text-muted-foreground hover:text-destructive p-1 text-xs"
                      title="Remove"
                      aria-label="Remove recent funding"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live preview + save */}
          <div className="pt-3 border-t border-border space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Preview</div>
              {dealId && (
                <div className="flex items-center gap-2">
                  {savedFlash && <span className="text-[10px] text-emerald-700">Saved with deal</span>}
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="h-7 px-3 rounded-md bg-foreground text-background text-xs font-medium hover:opacity-90 disabled:opacity-50"
                    title="Save the intake on this deal so it pre-fills next time you shop it"
                  >
                    {saving ? 'Saving…' : 'Save intake on deal'}
                  </button>
                </div>
              )}
            </div>
            <pre className="text-[11px] font-mono whitespace-pre-wrap bg-muted/30 border border-border rounded-md px-3 py-2 max-h-48 overflow-y-auto">
              {preview || <span className="text-muted-foreground italic">Fill in the sections above to generate a message.</span>}
              {notesPreview && (
                <>
                  {preview ? '\n\n' : ''}
                  <span className="text-muted-foreground">[Notes below auto-included when sending]</span>
                </>
              )}
            </pre>
            {!dealId && (
              <div className="text-[11px] text-muted-foreground italic">
                Open this page from an active deal (Shop this deal) to persist the intake — without a deal context, the intake is only used for the current submission.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Format the intake into the human-readable block that gets prepended
 * to the email body. Each section is skipped if empty so the output
 * stays clean when the broker only fills part of the form.
 */
function formatIntakeMessage(
  openBalances: { funder: string; amount: string }[],
  priorHistoryMode: 'unset' | 'yes' | 'no',
  priorHistoryDetails: string,
  recentFundings: { company: string; amount: string; date: string }[],
): string {
  const lines: string[] = [];

  const validBalances = openBalances.filter((r) => r.funder.trim() && r.amount.trim());
  if (validBalances.length > 0) {
    lines.push('Open Balances:');
    for (const r of validBalances) {
      lines.push(`  ${r.funder.trim()} ${r.amount.trim()}`);
    }
  }

  if (priorHistoryMode === 'no') {
    if (lines.length > 0) lines.push('');
    lines.push('No prior history to current positions.');
  } else if (priorHistoryMode === 'yes') {
    if (lines.length > 0) lines.push('');
    if (priorHistoryDetails.trim()) {
      lines.push(`Has prior history to current positions — ${priorHistoryDetails.trim()}`);
    } else {
      lines.push('Has prior history to current positions.');
    }
  }

  const validFundings = recentFundings.filter((r) => r.company.trim() && r.amount.trim());
  if (validFundings.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('Recent Funding:');
    for (const r of validFundings) {
      const dateSuffix = r.date.trim() ? ` on ${r.date.trim()}` : '';
      lines.push(`  ${r.company.trim()} funded ${r.amount.trim()}${dateSuffix}`);
    }
  }

  return lines.join('\n');
}

/**
 * Convert the form state into the JSON shape stored in
 * deals.submissionIntake. Empty rows are stripped so the persisted
 * blob stays compact and re-hydration ignores half-filled noise.
 */
function buildIntakePayload(
  openBalances: { funder: string; amount: string }[],
  priorHistoryMode: 'unset' | 'yes' | 'no',
  priorHistoryDetails: string,
  recentFundings: { company: string; amount: string; date: string }[],
  notes: string,
) {
  return {
    openBalances: openBalances
      .filter((r) => r.funder.trim() || r.amount.trim())
      .map((r) => ({ funder: r.funder.trim(), amount: r.amount.trim() })),
    priorHistory: priorHistoryMode === 'unset' ? null : {
      has: priorHistoryMode === 'yes',
      details: priorHistoryMode === 'yes' ? priorHistoryDetails.trim() : '',
    },
    recentFundings: recentFundings
      .filter((r) => r.company.trim() || r.amount.trim() || r.date.trim())
      .map((r) => ({ company: r.company.trim(), amount: r.amount.trim(), date: r.date.trim() })),
    notes: notes.trim(),
  };
}

/**
 * Stable opaque id for an intake row. crypto.randomUUID isn't universally
 * available (older browsers/jsdom); fall back to a timestamp + random
 * suffix combo. Only used as a React key — uniqueness within siblings
 * is the only requirement.
 */
function cryptoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
