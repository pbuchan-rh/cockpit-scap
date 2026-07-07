# V4.1 Scope: Tailoring/Policy Editor Restoration

Status: **planning only — no code written yet.** This document defines scope and
architecture for the next build session. Do not start implementation until this
plan has been reviewed and approved.

## Why

The v4.0 rewrite (`rewrite` branch) replaced the 11,825-line vanilla-JS module
with a ~600-line React + PatternFly v6 module. Six feature cuts were tracked and
accepted (container scan, remediation panel, activity log, content library,
settings tab, scan history) — but a seventh, untracked cut slipped through:
**the real XCCDF tailoring/policy editor**, reduced to a single checkbox +
free-text path input (`ScanSetup.jsx`, "Use tailoring file").

This is the feature that justified the project in the first place — replacing
Red Hat's removed `scap-workbench`, per `ECOSYSTEM.md`'s landscape research and
`WORKBENCH_FEATURES.md`'s gap analysis. Peter's own words: "we haven't fixed
that at all we just made a gui scanner." Restoring it is the #1 priority for
V4.1.

## Scope boundary

**IN — the only thing V4.1 builds:**
- Real tailoring editor: rule tree with checkboxes, value editing, save / update
  in place / save as new / delete / upload external file
- Scan-tab integration: saved tailoring files selectable when scanning, filtered
  to files matching the loaded content

**OUT permanently:**
- Activity log — Peter's call: not core, adds cross-session audit-trail state
  complexity for no real benefit here

**DEFERRED to V4.2 — explicitly not decided, not built in this pass:**
- Scan history
- Content library (upload/manage extra SDS files beyond auto-detected SSG)

Both were flagged as scope-creep risks. Decision: prove the homedir-state
mechanism on tailoring alone, ship it, get real usage, then decide whether
either deferred feature is worth adding on top of a mechanism that's already
working.

**Not in scope, deferred indefinitely (carried over from old `main`, never
built there either):** undo/redo stack, value-to-rules dependency map, profile
shadowing, multi-checklist SDS selector, container-scan tailoring (container
scan itself is cut).

## State model

Confirmed 2026-07-06, not re-litigated here:
- `~/SCAP/tailoring/` — visible homedir directory, not a dotfile path.
- Per-user private (Peter's call) — no cross-user sharing, no `flock` needed.
- Root (Cockpit's superuser bridge) writes files as root, then `chown $USER:$USER`.
  **Tighten from old `main`'s `chmod 644`: use `chmod 700` on the directory and
  `600` on files** — old `main` made these world-readable because
  `/var/lib/cockpit-scap/` was a shared system path; homedir-private data with
  no cross-user reader has no reason to be world-readable, and tailoring files
  can reveal which controls an admin has weakened.
- SELinux: already verified via live `sesearch`/`seinfo` on `cockpit-bootc-test`
  — `cockpit_session_t` (the only domain, used for both normal and
  superuser-escalated sessions) already has full CRUD rules on `user_home_type`,
  with a default type-transition labeling anything created directly under a
  homedir as `user_home_t`. **No custom `.fc` policy needed** — this was the
  main blocker for the old system-wide `/var/lib/cockpit-scap/` path, and it
  does not apply here.

## Reference implementation (old `main`, `~/Projects/cockpit/cockpit-scap`)

The old module's tailoring code (`src/tailoring.js`, 1254 lines, plus a shared
Python extraction script in `src/index.js:77-122`) is a working, portable
reference — not a design to imagine from scratch:

- **Rule tree + value extraction:** `PY_EXTRACT_PROFILE`, an inline Python3
  script run via `cockpit.spawn(['python3', '-c', PY_EXTRACT_PROFILE, profileId, sdsPath])`.
  Uses `xml.etree.ElementTree.iterparse` with an early break on the
  `Benchmark` element to avoid parsing the ~35MB OVAL section. Returns JSON:
  `{profile, groups: [{id, title, groups[], rules[]}], rules[], values[]}`.
  **This script needs zero changes** — it's pure stdlib Python, framework-agnostic,
  directly reusable in the rewrite via the same `cockpit.spawn` call.
- **XML generation:** `generateTailoringXml()` (`tailoring.js:913`) — a plain
  string template, no XML library. Takes `(baseProfileId, newProfileId,
  newProfileTitle, ruleChanges, valueChanges)` and emits standard XCCDF
  `<Tailoring>`/`<Profile extends="...">` with `<select idref=.../>` and
  `<set-value idref=...>` entries for only the deltas. Directly portable as-is.
- **Save workflow** (`onTailorSaveClick`, `tailoring.js:845`): `mkdir -p` the
  target dir (superuser), write `.xml` + a JSON sidecar (metadata: name,
  base_profile_id/title, profile_id, sds_path, path, created timestamp,
  rules_modified count, compliance_threshold) via `cockpit.file().replace()`,
  chmod, then **read the file back and compare to what was written** — this
  catches a known hardened-system failure mode (`cockpit-bridge` under `sudo`
  without a pty silently no-ops the write; old code surfaces a specific error
  telling the admin to add a sudoers `!use_pty` override). Keep this
  write-verification step.
- **Sidecar JSON** exists so the scan-tab dropdown and saved-files list don't
  need to re-parse XML on every page load — read once, cache. Worth keeping in
  V4.1; React state doesn't remove the need for it since the source of truth
  is on disk, not in memory, across page loads.
- **Scan-tab integration:** saved tailoring files filtered to
  `sc.sds_path === currentSdsPath`, passed to
  `oscap xccdf eval --tailoring-file <xml> --profile <id> ...` and
  `oscap xccdf generate fix --tailoring-file <xml> --fix-type ...`.

## Component architecture in the rewrite (React + PF6)

Current `rewrite` structure: `app.jsx`, `components/ScanSetup.jsx`,
`components/ScanProgress.jsx`, `components/ScanResults.jsx`, `lib/oscap.js`,
`lib/results.js`.

Proposed additions:
- `components/TailoringEditor.jsx` — rule tree (nested groups/rules with
  checkboxes) + value editor (dropdown for enumerated values, text input
  otherwise) + inline profile name field + save/update/save-as-new controls.
  Open question: PatternFly `TreeView` vs. nested `DataList` vs. plain nested
  `<details>/<summary>` (what old `main` used, framework-free) — needs a quick
  PF6 spike to see which renders a large rule tree (RHEL SSG profiles run
  hundreds of rules) without performance problems.
- `components/TailoringList.jsx` — saved-files table: load, update-in-place,
  save-as-new, delete, upload external XCCDF tailoring file. Mirrors old
  `renderTailoringList()`.
- `lib/tailoring.js` — non-React logic: `PY_EXTRACT_PROFILE` spawn wrapper,
  `generateTailoringXml()`, `~/SCAP/tailoring/` path helpers, sidecar
  read/write. Keep this separate from the components per the rewrite's existing
  `lib/oscap.js` / `lib/results.js` split.
- `ScanSetup.jsx`: replace the current checkbox + free-text path
  (`tailoringEnabled`/`tailoringPath`, lines 159–172) with a selector wired to
  saved tailoring files, filtered by current content — same UX as old `main`'s
  scan-tab dropdown, not a raw path input.
- New "Tailoring" tab/section in `app.jsx`'s navigation, alongside the existing
  host-scan view.

## Open questions to resolve during the build session (not blocking this plan)

- Rule-tree PF6 component choice (spike needed, see above).
- Whether to keep the `compliance_threshold` field from old `main`'s sidecar —
  it was used for scan-history pass/fail banding, which is deferred; may be
  dead weight in V4.1 without scan history. Lean toward dropping it for now,
  confirm during build.
- Whether inline rule *descriptions* (shown per-rule in old `main`'s expandable
  tree) are worth the extra payload from `PY_EXTRACT_PROFILE`'s output, or
  whether V4.1 should show title + severity only and defer descriptions.

## Next step

Get this plan reviewed and approved. Once approved, open a separate build
session (scaffolding + component code) — per established practice, planning
sessions produce docs only, implementation is a distinct, separately-approved
step.
