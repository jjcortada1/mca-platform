---
name: Next.js SWC binary corruption & security firewall block
description: What happens when npm install partially runs and corrupts @next/swc-* binaries, and how next@14.2.18 is blocked by deployment firewall
---

# Next.js SWC Binary Corruption & Firewall Block

## The Rule
Any partial `npm install` run (e.g. installing a new package that also upgrades next) can corrupt the `@next/swc-*` native `.node` binaries, causing SIGBUS during `next build` and `next dev`. Additionally, `next@14.2.18` is permanently blocked by Replit's supply-chain security firewall and cannot be deployed.

**Why:** The failed `npm install dotenv` (June 2026) corrupted two SWC binaries by partially downloading newer versions. It also caused a version drift: next@14.2.35 in node_modules but package-lock.json still referencing 14.2.18 (blocked).

## How to Apply

### If SIGBUS occurs during next dev or next build:
1. Check for corrupted `.node` files: `for f in $(find node_modules/@next -name "*.node"); do file "$f"; done`
2. Look for "missing section headers" in output — those are corrupted
3. Check hidden backup dirs: `ls node_modules/@next/.swc-*/` — npm keeps good copies there
4. Copy good binaries over corrupted ones: `cp node_modules/@next/.swc-linux-x64-gnu-*/next-swc.*.node node_modules/@next/swc-linux-x64-gnu/`
5. Do the same for musl: `cp node_modules/@next/.swc-linux-x64-musl-*/next-swc.*.node node_modules/@next/swc-linux-x64-musl/`

### If deployment fails with "next-14.2.18.tgz - Blocked by Security Policy":
1. Update `package.json`: bump `next` and `eslint-config-next` to `14.2.35`
2. Update `package-lock.json` programmatically (node script) with correct integrity hashes:
   - next@14.2.35: `sha512-KhYd2Hjt/O1/1aZVX3dCwGXM1QmOV4eNM2UTacK5gipDdPN/oHHK/4oVGy7X8GMfPMsUTUEmGlsy0EY1YGAkig==`
   - @next/env@14.2.35: `sha512-DuhvCtj4t9Gwrx80dmz2F4t/zKQ4ktN8WrMwOuVzkJfBilwAwGr6v16M5eI8yCuZ63H9TTuEU09Iu2HqkzFPVQ==`
   - eslint-config-next@14.2.35: `sha512-BpLsv01UisH193WyT/1lpHqq5iJ/Orfz9h/NOOlAmTUq4GY349PextQ62K4XpnaM9supeiEn3TaOTeQO07gURg==`
   - @next/eslint-plugin-next@14.2.35: `sha512-Jw9A3ICz2183qSsqwi7fgq4SBPiNfmOLmTPXKvlnzstUwyvBrtySiY+8RXJweNAs9KThb1+bYhZh9XWcNOr2zQ==`
   - @next/swc-* packages → version 14.2.33 (next@14.2.35's actual SWC dependency)
3. Note: next@14.2.35 uses `@next/env@14.2.35` and `@next/swc-*@14.2.33`
4. Re-deploy

### If `node_modules/.bin/next` is missing:
`ln -sf ../next/dist/bin/next node_modules/.bin/next`

### SWC version mismatch warning is harmless:
"Mismatching @next/swc version, detected: 14.2.18 while Next.js is on 14.2.33" — the hidden backup dir binaries (14.2.18) work fine with next@14.2.35.
