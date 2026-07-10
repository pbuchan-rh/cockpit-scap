# V4.1.1 Scope: Scan Results + Policy Editor Formatting Restoration

Status: **planning only — no code written yet.** This document defines scope for
the next build session. Do not start implementation until reviewed and approved.

## Why

Direct comparison of `origin/rewrite` against old `main` (2026-07-10 session)
confirmed the "feels unfinished" read is real, concentrated in two places:

- **`ScanResults.jsx`**: each failing rule shows only a severity badge + the raw
  shortened XCCDF ID (`ruleShortId()`), e.g. `enable_fips_mode`. No title, no
  description, no rationale, nothing expandable. Old `main`'s `host-scan.js`
  rendered the human-readable rule title plus an expandable row with
  description/rationale inline.
- **`TailoringEditor.jsx`**: closer to feature-complete than it looks (search,
  severity/status filters, value editing, a modified-count hint are all
  present), but every rule row shows title only — no description, no rationale,
  no expand/collapse-all, no change-summary/export. Old `main`'s tailoring UI
  (`tailoring.js`) had all of these. This is what's producing the "patched in
  as an afterthought" feel vs. 3.9's first-class editor.
- CSS is cut ~85-92% overall (`app.scss` 241 lines vs. old `style.css` 3,098;
  tailoring-specific rules 17 vs. 88) — some of that reduction is legitimately
  dead weight (container-scan/remediation/history styling that's gone for
  good), but some of it is the visual hierarchy/spacing that made the old
  editor feel considered rather than bare.

## Root cause, not just symptom

**`ScanResults.jsx`'s data pipeline never fetches rule metadata.**
`lib/results.js`'s `parseResults()` only reads `<rule-result>` elements from the
XCCDF *results* XML (pass/fail outcome + severity) — title/description/rationale
live in the *Benchmark* definition, a separate part of the SCAP content that
this parser never touches. This isn't a UI oversight, it's a missing join.

The fix already exists elsewhere in the codebase: `lib/tailoring.js`'s
`extractProfile(profileId, sdsPath)` already returns a flat rule list with
`id`, `title`, `severity`, `description` per rule (it's the same `iterparse`
script that early-breaks before the ~35MB OVAL section — see V4.1's plan doc).
It's just never called from the scan-results flow. `app.jsx` currently passes
`ScanResults` only `{ result, tmpdir, onNewScan }` — no profile metadata.

**`TailoringEditor.jsx`'s `RuleRow` already receives `description` in its rule
data and simply doesn't render it** (`extractProfile()` returns it; the
component destructures `rule.title` and drops the rest). This one is a cheap
fix — no new data plumbing needed, just render what's already there.

`rationale` is **not** currently extracted anywhere (only `description`) — the
Python extractor's `proc_rule()` would need one more `el.find(tag("rationale"))`
line, mirroring how it already handles `description`. Shared fix, benefits both
surfaces.

## Scope — IN

**A. ScanResults rule metadata**
- After a scan completes, call `extractProfile(profileId, sdsPath)` (same
  function TailoringEditor already uses) to build an `id → {title, description,
  rationale}` map, using the profile/content already known at that point in
  `app.jsx`'s scan flow (and the tailoring file's base profile, if one was used
  — needs the same base-profile lookup TailoringEditor already does).
- Replace the raw-ID-only rule row with: title as the primary label, severity
  badge, short ID as secondary/muted text (kept — useful for cross-referencing
  a report or ticket), description+rationale behind a click-to-expand (old
  main's `ct-rule-title-expandable` pattern), matching the existing
  expand-per-row convention rather than a wall of always-open text.
- Everything already working (severity filter, per-rule checkbox selection,
  bash/ansible fix download) stays as-is — this is additive, not a rewrite of
  that component.

**B. TailoringEditor polish**
- Wire in the `description` field already present in `RuleRow`'s data (cheap:
  data's already there).
- Add `rationale` to the Python extractor, wire into both A and B.
- Replace the native `<details>` rule tree with PatternFly `TreeView` (see
  Decision 1) — gets expand/collapse-all, selection styling, and severity/
  modified iconography as part of the component rather than hand-rolled.
- Restore a real change-summary panel with export (see Decision 2).
- **Base-profile description side panel** — old main showed a right-hand
  column (`ct-profile-desc-col`, two-column grid, border-left divider,
  collapsing to one column under 900px) with the selected base profile's
  description text, placeholder text before a profile is picked. Confirmed
  entirely absent from `rewrite` — not just from the tailoring editor, from
  *every* surface (grepped `ScanSetup.jsx`, zero hits for "description").
  Peter's explicit ask: bring this back for the tailoring/policy editor.
  Data's already available — `extractProfile()`'s response includes the
  top-level `profile.title`; needs one more field added alongside `rationale`
  (the Benchmark's `<profile>`-level `<description>`, distinct from the
  per-rule one) since the current extractor only captures per-rule
  descriptions, not the profile's own.
  Same pattern applies identically to Scan Setup's profile picker (old main
  had it there too, `cs-profile-desc-card`) — cheap to include since it's the
  same component/data, flagging as an easy add-on rather than assuming it's
  wanted.
- CSS/visual pass on the value-editing grid, description side panel, and
  expanded description/rationale block — use PatternFly's own spacing/border
  tokens (`--pf-v6-global--*`) rather than reintroducing old main's 79 custom
  `--ct-*` variables, so it doesn't regress back toward the old module's
  3,000-line stylesheet.

## Scope — OUT (unchanged from prior decisions, not reopened by this pass)

- No content library, remediation panel, scan history, or activity log —
  those remain separate, already-logged open items. Scan history specifically
  reconfirmed out-of-scope for this pass 2026-07-10 (Peter's call) — stays the
  lean V4.2 effort agreed 2026-07-07, gets its own plan doc, not folded in
  here to avoid growing an already-substantial build session (TreeView
  migration + change-summary/export + description panel is enough for one
  pass).
- No IndexedDB/`viewer.html` revival.
- No cross-tab highlight-sync (explicitly cut in the original rewrite).
- No SELinux or homedir/data-model changes — this pass is UI/rendering only,
  confirmed to have zero interaction with the `~/SCAP/` homedir design or the
  (already-absent) SELinux policy.

## Decisions (2026-07-10, Peter)

1. **Rule tree: move to PatternFly's `TreeView`**, not a styled `<details>`
   tree. Bigger lift than a CSS pass, but gives expand/collapse-all, selection
   styling, and icon conventions for free, and is the "proper" PatternFly way
   to do this — expected to be the single biggest contributor to a
   first-class feel. Build session needs to check `TreeView`'s data-shape
   requirements against the existing `extractProfile()` group/rule nesting
   (groups can nest groups arbitrarily) before committing to a mapping.
2. **Restore a real change-summary panel**, not just the one-line hint —
   diff-style list of changed rules/values from the base profile, matching old
   main's `updateTailorSummary()`/`exportTailorSummary()` shape. "Export" is
   clipboard-copy of a plain-text summary (`navigator.clipboard.writeText()`),
   matching exactly what old main did — confirmed by reading
   `exportTailorSummary()` directly, it never wrote a file. No new files, no
   new homedir footprint (see Data footprint note below).
3. **Description/rationale: click-to-expand**, not always-visible inline —
   avoids clutter on hundred-rule profiles.

## Data footprint

Confirmed unchanged. Everything here is either read-side (parsing more of the
same already-loaded SCAP content XML via `extractProfile()` — no new disk
reads/writes) or purely client-side rendering state (TreeView, description
panel, expand/collapse, change-summary). The "export" action is a clipboard
copy, not a file write. Files under `~/SCAP/` stay exactly `tailoring/*.xml`
+ `*.json` sidecars and the scan results/report/ARF triplet — no new files,
no new directories, no new SELinux surface.

## Deliverable / next step

This doc, reviewed and signed off, followed by a code-only build dispatch
(same split-code-from-deploy-verify convention as every other module feature)
against `rewrite`, then a separate deploy-verify pass on a real host.
