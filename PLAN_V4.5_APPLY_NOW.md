# V4.5 Scope: Apply Now (online/live in-app remediation)

Status: **planning only — no code written yet.** This document defines scope
and architecture for the next build session. Do not start implementation
until this plan has been reviewed and approved.

## Why

The 2026-07-15 workbench-parity review (`WORKBENCH_FEATURES.md`) found one
substantive remaining gap between `rewrite` and both scap-workbench and old
`main`: there is no way to actually *run* a remediation fix on the host from
inside the app. `ScanResults.jsx` already lets you preview and download a
bash/ansible/puppet fix script for one or many failing rules — but applying
it means downloading the file and running it yourself, outside Cockpit. Old
`main` had a real "Apply Now" flow (two-gate confirmation, live streaming
output, a persisted log) that never made it into the rewrite. This was
flagged as an open, undecided item back on 2026-07-07 ("remediation panel")
and is now the clearest remaining gap vs. workbench.

## The scope is smaller than it looks — most of the hard part already exists

Read old `main`'s actual implementation (`src/remediation.js`,
`onApplyNowClick`/`onApplyGate1Proceed`/`onApplyGate2Execute`) rather than
guessing at the shape of this feature. Its three-step flow:

1. User checks specific failing rules in a selection UI → **Gate 1**: confirm
   which rules, "Proceed."
2. Gate 1 Proceed generates the actual filtered bash script server-side
   (`python3 -c PY_FILTER_FIX <remediation.sh> bash <rule-ids>`, `superuser:
   'require'`) and shows the full script text + rule list in **Gate 2**:
   "Apply" or "Cancel."
3. Gate 2 Apply writes the script to a temp path as root
   (`cockpit.file(path, {superuser:'require'}).replace(script)`), then runs
   it with `cockpit.spawn(['bash', path], {superuser:'require', err:'out'})
   .stream(...)`, streaming stdout live to the UI. On completion (success or
   failure), persists a log file + fires a `logger -t cockpit-scap` syslog
   entry, then deletes the temp script.

**Steps 1 and most of step 2 are already built and proven in `rewrite`.**
`ScanResults.jsx` already has per-rule checkbox selection
(`selectedRuleIds`, a `Set`), and `lib/oscap.js`'s `generateScopedFix(sdsPath,
tailoringPath, ruleIds, fixType)` already generates a correctly-scoped script
for an arbitrary rule-ID set and fix type — this is the exact same
capability as old `main`'s `PY_FILTER_FIX` step, already live-verified
byte-identical to a reference call (the 2026-07-14 `--rule`-flag bugfix).
**What's actually missing is narrow: an Execute step, a confirmation
sequence, live output display, and a log record.**

The execution mechanism itself also isn't new territory for this codebase —
`lib/oscap.js`'s scan runner already does `cockpit.spawn(args, {superuser:
'require', err: 'out'}); proc.stream(chunk => ...)` for the live scan itself.
Apply Now would reuse the identical pattern against a different script.
`Modal` (PatternFly) is already used in five components for confirmation
dialogs (`ScanHistory.jsx`, `ContentUploadCard.jsx`, `TailoringList.jsx`,
`ScanSetup.jsx`, `TailoringEditor.jsx`) — no new dependency for the two-gate
flow, just two more modals following the existing pattern.

## Proposed flow

Lives in `ScanResults.jsx`, next to the existing per-rule/bulk fix-download
UI — **not** a new tab or panel. Scope: **selective, post-scan only**,
matching old `main` exactly. This is deliberate: Apply Now only ever applies
fixes for rules a real scan just confirmed are actually failing on this
host, never a blind pre-scan "run every fix in this profile" action. That
distinction is a real safety property, not an arbitrary restriction — don't
widen it to `ScanSetup.jsx`'s pre-scan buttons without a separate
conversation.

1. Selecting one or more failing rules (existing checkbox UI) enables a new
   **"Apply Now"** button alongside the existing Download buttons.
2. **Gate 1** (`Modal`): "Apply N fixes to this host?" + the rule titles
   list. Proceed / Cancel.
3. Proceed calls `generateScopedFix(..., 'bash')` (already exists, no new
   `lib/oscap.js` logic needed for this step) and opens **Gate 2**: full
   script text in a `<pre>` (same pattern already used for the per-rule Fix
   preview), same rule list, "Apply" / "Cancel." This is the last point a
   user can back out having actually seen the exact commands about to run.
4. Apply writes the script to a true root-only temp path (see below), runs
   it via the proven `spawn+stream` pattern, streams output live into an
   expandable area (reuse the live-scan-output component/pattern if one
   exists, otherwise a simple auto-scrolling `<pre>`), shows a clear
   success/failure state with exit code on completion, deletes the temp
   script unconditionally (success or failure) in a `finally`-equivalent.
5. Bash only for v1 — old `main`'s Apply Now was bash-only too (Gate 1 always
   requested `'bash'` from `PY_FILTER_FIX`, never ansible/puppet). No reason
   to widen this now; downloading an ansible/puppet script for manual
   apply-elsewhere already covers that use case.

## Temp script location — cleaner than old `main`'s approach

Old `main` wrote the executable script under the shared, root-owned scan
results directory (`remediationDir + 'remediation-apply.sh'`), a holdover
from its pre-homedir-rewrite storage model. That path doesn't exist in
`rewrite`'s architecture. Since the script is root-created, root-executed,
and deleted immediately after in the same flow, **it never needs to touch
`~/SCAP/` at all** — recommend a genuine root-only temp path (`mktemp` under
`/root` or `/tmp`, `superuser: 'require'` for every step touching it, same
pattern `lib/oscap.js`'s `makeTmpdir()` already uses for scan temp files).
Cleaner than old `main`, and adds zero new surface under the user's homedir
— no new SELinux question, no new `~/SCAP/` subdirectory, consistent with
V4.4's "no data footprint" finding for the guide/remediation-download
buttons.

## Open question: what does "audit" mean here, given Activity Log is cut?

This is the one real product decision this plan can't make unilaterally.
Apply Now runs root-privileged commands that **modify live system state** —
categorically different risk from every other feature in `rewrite`, which
are all read-only or write only into the user's own `~/SCAP/`. Old `main`
had three audit layers: a full searchable Activity Log tab (permanently cut,
Peter's own call, staying cut — not up for debate here), a persisted
per-run log file, and a `logger -t cockpit-scap` syslog entry.

**Recommend keeping the latter two, dropping only the Activity Log tab
integration:**
- `logger -t cockpit-scap` — trivial, standard practice for any tool that
  runs privileged commands, lands in `journalctl`/syslog where an admin or
  SIEM would already look for this. No new storage, no new UI.
- A persisted per-run log (script + full output + exit code + timestamp +
  user + which rules) — recommend `~/SCAP/scans/<timestamp>/remediation.log`
  alongside that scan's existing `manifest.json`/`report.html`/`results.xml`
  rather than old `main`'s separate log directory, so it's covered by the
  same delete-the-scan-directory cleanup Scan History already has, no new
  retention question to answer.

This needs Peter's explicit sign-off, not an assumption — dropping *all*
logging would mean a root command ran against production infrastructure
with literally no record beyond whatever's on-screen at the time, which
feels wrong for a compliance tool specifically. But rebuilding the full
Activity Log tab UI just for this one feature would also directly contradict
the standing "we don't need the activity audit log" decision. The proposal
above tries to thread that — flagging it explicitly rather than picking
silently.

## Out of scope, not designed here

- Pre-scan / whole-profile blind apply (workbench's `--remediate` flag) —
  deliberately not restoring this; selective post-scan-only is the safer,
  already-proven-in-old-`main` shape.
- Offline remediation (re-apply a saved ARF without rescanning) — separate
  feature, not addressed by this plan.
- Ansible/puppet execution — download-only for those formats remains
  unchanged; only bash gets an Execute path, matching old `main`.
- Any `src/` code changes — this session is docs-only.
- Container scan integration — container scanning is permanently cut from
  this rewrite; Apply Now is host-scan-only by construction.
- Applying from a scan pulled out of History (vs. a scan just run this
  session) — see open question below.

## Open questions for Peter

1. **Audit logging model** (see above) — syslog + per-scan-directory log
   file, or something else (or nothing)? This is the load-bearing question
   for this whole feature; recommend the approach above but it's a real
   product call given the "no root command runs without a trace" stakes.
2. **Available from Scan History, or only right after a live scan?**
   `generateScopedFix()` operates on static content + tailoring files, not
   stored results, so technically nothing blocks offering Apply Now from a
   history entry too — but re-applying "this scan's" fix set against
   *today's* live host, possibly long after the scan ran, could be
   surprising if the system has drifted since. Recommend: allow it, since
   `sdsPath`/`tailoringPath` resolution already has to handle "content may
   no longer exist" as an error case regardless (same as today's Download
   Fix from History) — but flagging since it's a real behavioral choice, not
   a no-brainer either way.
3. **Live output component** — build a small reusable streaming-output
   component now (bash script output today, could serve a future
   long-running action later), or keep it a one-off inline `<pre>` scoped to
   this feature? No strong recommendation; leaning toward one-off for now
   since there's no second consumer yet, but worth a decision before the
   build session rather than an ad-hoc call mid-build.

## Next step

Get this plan reviewed and approved. Once approved, open a separate build
session (scaffolding + component code) — per established practice, planning
sessions produce docs only, implementation is a distinct, separately-approved
step.
