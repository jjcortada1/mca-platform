#!/usr/bin/env node
/**
 * UI-stability regression tests — enforce the anti-blink invariants at the
 * source level. Plain Node, no framework. Run: `npm run test:stability`
 * (exit code 0 = pass). These encode the rules that keep background
 * refreshes invisible:
 *
 *  1. No full browser reloads inside the app (window.location.reload).
 *  2. Pages with background auto-refresh must NOT flip a page-level
 *     `setLoading(true)` in their load path — that swaps the whole table
 *     for a skeleton on every tick (the "page blink"). Skeletons are for
 *     the FIRST load only (initial state).
 *  3. The auto-refresh hook must keep its guards: visible-tab-only and
 *     skip-while-typing (prevents clobbering half-filled forms).
 *  4. The sidebar config hook (fetch + tasks poll) is called exactly once
 *     (in AppShell) — a second call site doubles every API request on a
 *     timer.
 *  5. Worksheets' silent refresh must keep its dirty/saving guard so a
 *     background sync can never overwrite unsaved cell edits.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const APP_DIR = join(ROOT, 'src/app/(app)');
let failures = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const appFiles = walk(APP_DIR);
const rel = (p) => p.slice(ROOT.length);

console.log('UI stability invariants');

// 1 — no full browser reloads in app pages.
{
  const offenders = appFiles.filter((p) => readFileSync(p, 'utf8').includes('window.location.reload('));
  check('no window.location.reload() inside the app', offenders.length === 0, offenders.map(rel).join(', '));
}

// 2 — auto-refresh pages keep content visible during refresh.
{
  const offenders = appFiles.filter((p) => {
    const src = readFileSync(p, 'utf8');
    return src.includes('useAutoRefresh(') && src.includes('setLoading(true)');
  });
  check('auto-refresh pages never flip a page-level loading state', offenders.length === 0, offenders.map(rel).join(', '));
}

// 3 — the hook's guards are intact.
{
  const hook = readFileSync(join(ROOT, 'src/lib/use-auto-refresh.ts'), 'utf8');
  check('auto-refresh only ticks on visible tabs', hook.includes("visibilityState"));
  check('auto-refresh skips ticks while the user is typing', hook.includes('userIsTyping'));
}

// 4 — sidebar config fetched once for the whole shell.
{
  const sidebar = readFileSync(join(ROOT, 'src/components/sidebar.tsx'), 'utf8');
  const calls = (sidebar.match(/useSidebarConfig\(user\)/g) ?? []).length;
  check('sidebar config + tasks poll runs exactly once (no duplicate requests)', calls === 1, `found ${calls} call sites`);
}

// 5 — worksheets background sync can't clobber unsaved edits.
{
  const ws = readFileSync(join(ROOT, 'src/app/(app)/worksheets/page.tsx'), 'utf8');
  check('worksheets refresh guarded by dirty/saving state', ws.includes('dirtyRowsRef.current.size > 0') && ws.includes('savingRef.current > 0'));
}

if (failures) {
  console.error(`\n${failures} invariant(s) violated — a change reintroduced visible refresh behavior.`);
  process.exit(1);
}
console.log('\nAll stability invariants hold.');
