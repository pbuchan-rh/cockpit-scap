# V4.2 Scope: Lean Scan History

Status: **planning only — no code written yet.** This document defines scope and
architecture for the next build session. Do not start implementation until this
plan has been reviewed and approved.

## Why

Scan history was one of six feature cuts tracked and accepted when the v4.0
rewrite shipped (alongside container scan, remediation panel, activity log,
content library, settings tab). It was deliberately deferred rather than
reconsidered — the 2026-07-06 call was "prove the homedir-state mechanism on
tailoring alone first, decide on history/content-library later with real
usage" (see `PLAN_V4.1_TAILORING.md`).

V4.1 shipped and got real usage. On 2026-07-07, mid-testing, Peter reversed
the deferral: "i really like having it [scan history]... just enough to be
functional but not over the top." Content library stays undecided/deferred —
this plan is scan history only.

Today (`rewrite`, post-V4.1.2) a scan's `results.xml`/`report.html`/`arf.xml`
live only in a root-owned `/tmp/cockpit-scap-XXXXXX` tmpdir
(`lib/oscap.js:makeTmpdir`/`startScan`/`readResults`), read once into React
state, then deleted the moment the user clicks "New Scan" or navigates away
(`app.jsx:handleNewScan`/`cleanupTmpdir`). There is currently no way to see a
past scan again — this plan fixes that.

## Scope boundary

**IN — the only thing V4.2 builds:**
- Persist each completed scan's `results.xml`, `report.html`, `results.arf`
  (gzipped, matching `readResults()`'s existing shape) plus a small
  `manifest.json` to `~/SCAP/scans/<timestamp>/`.
- A simple list view: one row per scan, sorted newest first.
- Exactly three actions per row: **View report** (open the saved
  `report.html`), **Download** (the saved results/ARF, reusing the existing
  download plumbing), **Delete** (`rm -rf` that scan's directory — no
  retention engine, no confirmation-count logic beyond a normal "are you
  sure").

**OUT permanently (Peter's call, 2026-07-07 — do not re-litigate):**
- Retention / auto-pruning policy (old `main`'s `pruneHistoryByType()`,
  `hostRetention`/`containerRetention` limits) — the whole point of "lean" is
  no policy engine. Disk usage is the user's own problem, same as
  `~/Downloads`.
- Activity-log integration (`appendActivityLog()` calls throughout old
  `main`) — activity log itself is permanently cut, not being resurrected
  for this.
- CSV export.
- Cross-tab/cross-scan highlight-sync and score-delta-vs-previous-scan
  banding (old `main`'s `findPreviousScan()`, `syncHostHistoryHighlight()`,
  `buildPersistenceCache()`/`PY_BUILD_PERSISTENCE` rule-level pass/fail
  trend cache). This is the single biggest chunk of complexity in old
  `main`'s history code (`host-scan.js` lines ~140-300) and has no place in
  a lean v1.
- Remediation-panel linkage (`Remediate` button on each history row,
  `openRemediationPanel()`) — remediation panel itself is permanently cut.
- Container-scan history — container scan itself is permanently cut.

**Not in scope, not discussed:** re-running a past scan's exact
profile+tailoring combination as a one-click action (old `main` didn't have
this either — `View Scan` just redisplayed cached results, it didn't re-scan).

## State model

Follows the pattern already proven and shipped in V4.1's
`lib/tailoring.js` — reuse it directly, do not invent a new one:

- `~/SCAP/scans/<timestamp>/` — one directory per scan, sibling to the
  existing `~/SCAP/tailoring/`. Visible homedir path, not a dotfile.
- Per-user private, same as tailoring — no cross-user sharing, no `flock`.
- Root (Cockpit's superuser bridge) writes as root, then `chown
  $USER:$USER`, `chmod 700` on the directory and `600` on files — identical
  reasoning to tailoring: scan results reveal exactly what's vulnerable on
  the box, must not be world-readable. This is a **tightening** vs. old
  `main`, which used `chmod 755`/`644` (`relaxResultsPerms()`) because
  `/var/lib/cockpit-scap/` was a shared system path; homedir-private data
  has no reason to be world-readable.
- SELinux: already confirmed clear for this exact pattern (live
  `sesearch`/`seinfo` check on `cockpit-bootc-test`, 2026-07-06,
  `[[project_cockpit_scap]]`) — `cockpit_session_t` has full CRUD on
  `user_home_type` with correct default labeling. No new policy work
  needed; this is the same directory tree tailoring already writes to.
- Timestamp format: reuse tailoring's `makeTimestamp()`
  (`lib/tailoring.js:135`, `YYYY-MM-DDTHH-MM-SS`) so both subtrees sort
  identically and old `main`'s `TIMESTAMP_RE` convention is preserved if
  ever cross-referenced.

## Reference implementation (old `main`)

Old `main`'s `host-scan.js` history code (lines ~140-300, ~648-830,
~1083-1230) is the working reference, **read for the manifest schema and
directory-write pattern only** — most of its logic is explicitly out of
scope per above:

- **Manifest fields worth keeping**, trimmed from old `main`'s full schema
  (which also carried `scan_type`, used only to distinguish host vs.
  container — not needed here since container scan is cut):
  ```json
  {
    "timestamp": "2026-07-13T14-30-00",
    "profile_id": "xccdf_org.ssgproject.content_profile_e8",
    "profile_title": "Essential Eight",
    "sds_file": "/usr/share/xml/scap/ssg/content/ssg-rhel10-ds.xml",
    "tailoring_file": null,
    "score": 80,
    "counts": { "pass": 61, "fail": 23 }
  }
  ```
  `score`/`counts` map directly from `lib/results.js:parseResults()`'s
  existing return shape (`scorePercent`, `pass`, `fail` — already computed
  for `ScanResults.jsx`, no new parsing needed). `tailoring_file` is the
  saved tailoring sidecar's `name` if one was used, else `null` — lets the
  list show what policy a scan ran against without re-reading XML.
- **Explicitly dropped from old `main`'s schema**: `scan_type` (no
  container scans), anything feeding the persistence cache or retention
  (`result_id` was only used to key remediation-panel state, which is
  cut).
- **Write pattern**: old `main` wrote `manifest.json` via
  `cockpit.file(...).replace()` then `chmod`, same as tailoring's
  `writeTailoringFiles()`. **Add the write-verification readback** that
  `writeTailoringFiles()` already does (read `manifest.json` back, compare)
  — old `main` didn't do this for scan manifests, but it's a real
  hardened-system failure mode worth guarding against here too, consistent
  with the pattern this repo has already standardized on for tailoring.

## Component architecture in the rewrite (React + PF6)

Current relevant surface: `app.jsx`'s `handleScan()` (persist hook point),
`lib/oscap.js` (`readResults()`/`cleanupTmpdir()`), `components/ScanResults.jsx`
(where "View Report"/"Results XML"/"ARF" download buttons already exist for
the *current* in-memory scan — reuse this download logic for saved scans
too, not reimplement it).

Proposed additions:
- `lib/scanHistory.js` — new file, mirrors `lib/tailoring.js`'s shape:
  `getScanHistoryDir()` (same `cockpit.user().home` pattern), `ensureDir`
  equivalent (mkdir/chown/chmod 700 — consider factoring the now-duplicated
  ensure-dir/chown/chmod logic out of `tailoring.js` into a tiny shared
  homedir-helper at this point, since it'll exist in two files), `saveScan()`
  (copies the tmpdir's three result files + writes+verifies manifest.json),
  `listScans()` (read all manifests, sort newest-first — mirrors
  `listTailoringFiles()`), `deleteScan()` (`rm -rf` one scan dir, with the
  same path-prefix safety check `deleteTailoringFile()` uses).
- `components/ScanHistory.jsx` — new component, list view. PatternFly
  `Table` (plain rows, no expand/collapse needed — that's what made old
  `main`'s history heavy): columns Date, Profile, Score, Pass/Fail, Tailoring
  used, Actions (View report / Download / Delete). Reuses
  `ScanResults.jsx`'s existing download-button logic against the saved
  files instead of the live tmpdir's.
- `app.jsx`: call `saveScan()` right after `readResults(dir)` resolves and
  `parsed` is computed (currently line ~88-90, before `setPhase('results')`)
  — persist happens automatically on every completed scan, not gated behind
  a user action, so a scan isn't lost if the user never clicks anything
  else. Best-effort (`.catch()` + console error, same as every other
  fire-and-forget write in this codebase) — a persistence failure must not
  block showing the just-completed scan's results.
- New "History" tab/section in `app.jsx`'s navigation, alongside Scan and
  Tailoring.

## Open questions to resolve during the build session (not blocking this plan)

- Exact list-view placement: own top-level tab (like Tailoring) vs. folded
  into the existing Scan tab as a sub-section below the setup form. Leaning
  toward its own tab for consistency with Tailoring, but not decided.
- Whether "View report" opens the saved `report.html` in a new browser tab
  directly, or re-uses `ScanResults.jsx`'s existing in-app results view
  fed from the saved files instead of live `tmpdir` state — the latter is
  more consistent (same severity-grouped/CCE/fix-preview UI V4.1.2 just
  built) but needs `ScanResults.jsx` decoupled from assuming a live
  `tmpdir`/`scanProc`. Worth a build-session spike.
- Whether `saveScan()` should be allowed to fail loudly (a toast/alert) or
  stay silent-best-effort — leaning silent per above, but worth confirming
  since silently losing a scan an admin expected to be saved is its own
  bad surprise.

## Next step

Get this plan reviewed and approved. Once approved, open a separate build
session (scaffolding + component code) — per established practice, planning
sessions produce docs only, implementation is a distinct, separately-approved
step.
