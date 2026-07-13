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

## Decisions from plan review, 2026-07-13

- **List-view placement, settled: not a separate tab.** Matches old `main`'s
  actual layout (confirmed in `index.html`: `ct-history-card` sits directly
  below the `ct-results` card, both on the same Host-scan view, before the
  container-scan section starts). V4.2 follows the same shape: the History
  table lives on the existing **Scan tab**, stacked below Scan
  Setup/Results — always visible, not gated behind running a scan first
  (old `main` showed it with an empty-state when there was no history yet).
  `app.jsx`'s Scan tab gets a third `ScanHistory` table card; no new
  top-level nav entry.
- **"View report", settled: reuse the `ScanResults.jsx` UI**, fed from a
  saved scan's files instead of live `tmpdir` state. Needs that component
  decoupled from assuming a live `tmpdir`/`scanProc` (accept saved-file
  content as an alternate data source) — scope this explicitly in the build
  session.
- **Save-failure UX, settled: surface an alert, not silent.** Peter's call:
  "silently logging and then nothing happens sounds incomplete" — an admin
  who just ran a scan reasonably expects it to show up in History; failing
  that without any visible signal is a worse surprise than a visible error.
  Reverses this plan's earlier silent-best-effort lean. `saveScan()`'s
  caller in `app.jsx` shows a PatternFly `Alert`/banner on failure (doesn't
  block the just-completed results from displaying, but doesn't hide the
  failure either).

## Related bug found during plan review, 2026-07-13 — NOT in V4.2 scope, separate fix needed

**Peter reports the existing "View Report" button (`ScanResults.jsx:250`,
`handleViewReport()`) already opens the oscap-generated `report.html` with
all formatting stripped** — same "totally unstyled" symptom as the
2026-07-13 zero-PatternFly-styling incident, but this is a **different
mechanism** and needs its own root-cause, not assumed to be the same stale-CSS
bug (that bug was about cockpit-scap's own `index.css`; this is oscap's
report, opened via `window.open(URL.createObjectURL(blob), '_blank')` —
a completely separate browsing context that shouldn't touch cockpit-scap's
CSS at all).

Investigation started same session: confirmed via the installed
`xccdf-report-impl.xsl`/`xccdf-resources.xsl` on `rhel10cis` that oscap's
report template embeds CSS as inline `<style><![CDATA[...]]></style>` in
the generated HTML (not an external stylesheet link) — so the generated
file itself should be self-contained regardless of how it's opened. Real
cause not yet confirmed; leading theories to check next: (1) the
`window.open(blob:...)` popup may be silently blocked or opened without
its content actually loading in some browser/session states — worth
checking dev console for popup-blocked warnings; (2) Cockpit's own CSP
(Content-Security-Policy) headers on the parent page might restrict
`blob:` URLs in a way that strips `<style>` execution — untested. **Peter
also asked whether old `main`'s dedicated `viewer.html`/`viewer.js`/
`viewer.css` (a wrapping page for displaying reports, cut in the v4.0
rewrite) needs to come back** — not yet answered; depends on the root
cause. If it's a CSP/blob issue, a dedicated viewer page served from
cockpit-scap's own origin (like old `main` had) may be the fix rather than
a raw blob popup. **This blocks nothing in V4.2** (View Report already
exists today for live scans, independent of history) but should be
root-caused and fixed before or alongside the V4.2 build, since V4.2's
"View report" reuses this same button/handler.

## Next step

Get this plan reviewed and approved. Once approved, open a separate build
session (scaffolding + component code) — per established practice, planning
sessions produce docs only, implementation is a distinct, separately-approved
step.
