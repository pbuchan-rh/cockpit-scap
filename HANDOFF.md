# cockpit-scap — Session Handoff

---

## Current State

**Version:** v3.4 (v3.5 feature-complete, not yet tagged)
**Last session:** 2026-06-01
**Last commit:** see git log
**Git tag:** v3.4 on both remotes (github + origin/Gitea)
**Deployed to:** rhel10cis.beastmode.localdomain — user-space install at `~/.local/share/cockpit/cockpit-scap/` (takes precedence over system install — always deploy here, no sudo)
**Published:** COPR build 10529631 (v3.4, el10)
**RPM test host:** 10.0.0.214 upgraded to v3.4 — clean install confirmed
**GitHub release:** https://github.com/pbuchan-rh/cockpit-scap/releases/tag/v3.4
**Gitea release:** http://git.beastmode.localdomain:3000/admin/cockpit-scap/releases/tag/v3.4

---

## What Is Built

### Host Scan Tab
- Auto-detect SSG data stream files from `/usr/share/xml/scap/ssg/content/` and `/var/lib/cockpit-scap/content/`
- SDS selector uses `<optgroup>` grouping: "System Content" / "Uploaded Content"
- Human-readable SDS display names (static map covers all standard SSG filenames including RHEL 6–10)
- Cross-version content filtering — host scan dropdown shows only SDS files matching the host OS version; incompatible files silently excluded; no warning banner; CPE alert and `cpeBlocksScan` removed entirely
- Profile selection with full description display
- Tailoring file selector always visible; selecting a tailoring file auto-fills content + profile dropdowns from sidecar `base_profile_id` / `sds_path`
- Scan execution via `oscap xccdf eval` with cancel support; server-side XML parsing (fixes 15–18 MB WebSocket limit)
- Results summary — pass/fail/error/notchecked/notapplicable counts + compliance score
- View Full Report (IndexedDB bridge → viewer.html, CSP-compliant)
- Download report HTML, Download Results XML (XCCDF results.xml for auditors)
- Apply Remediation button (disabled stub, tooltip on hover)
- **View Guide** link alongside Run Scan — generates oscap security guide to viewer tab
- Scan history — last 10 host scans retained independently, auto-pruned per type
- **Run Again** button on each history row — pre-fills content, profile, tailoring file
- **View Scan** button on each history row — loads that scan's full results card (sets all current* vars from manifest); replaces separate View Report + Download XML actions
- **Export CSV** link on history card — exports all manifest fields
- Prereq detection: shows install instructions if openscap-scanner / SSG are missing
- History table: full-width layout, Actions column `width:1px` trick, profile CSS ellipsis truncation
- **Failing rules summary** — async-loaded below scan badges; HIGH/MEDIUM/LOW collapsible groups; each rule: title + CCE + right-aligned Automated/Manual annotation + expandable description/rationale (`<details>/<summary>`); `PY_EXTRACT_FAILING_RULES` extended with desc, rat, automated fields; remediation cross-reference via `# BEGIN fix` block parsing
- **Results card** — SVG arc score donut (0 fail=green, 1–10=yellow, 11+=red); timestamp + profile title; regression banner (yellow) or improvement banner (green) when fail count changes vs previous same-profile scan; "See what changed" button on either banner triggers `PY_SCAN_DIFF` diff of two results.xml files showing Fixed/Regressed/New groups; Close button bottom-right; Run Again pre-fills from `currentManifest`; `loadScanFromHistory()` loads any historical scan
- **Scan configuration** — single unified card with internal two-column grid (`ct-scan-body-grid`); form fields left, profile description right with border divider; eliminates layout shift vs results/history cards
- History rows disabled during scan — `loadHistory()` called in `showScanProgress()` so View Scan + Run Again are visually disabled; `loadScanFromHistory()` also guards `if (currentScanProc) return`
- **`rerunHostScan(manifest, autoStart=false)`** — autoStart flag added; when true, clicks `ct-scan-btn` after profile loads; used by Dashboard Quick Scan

### Container Scan Tab
- Full `oscap-podman` workflow: prereq check → image selection → content/profile/tailoring → scan → results → history
- Image enumeration from root Podman store (`sudo podman images --format json`)
- Eager prereq checks: `which oscap-podman` + `podman --version` run in parallel at module init so tab feels instant
- Three-state prereq empty state: `oscap-podman` not found / Podman not installed / no images in root store
- Version mismatch detection from image name regex vs SDS filename — shows warning and blocks scan button
- Results XML parsed server-side via Python (avoids 15–18 MB WebSocket limit)
- `notapplicable` contextual note per RHEL 10 Security Hardening guide §5.2.5
- **View Guide** link alongside Run Scan
- Download report HTML, Download Results XML
- History: Date / Image / Content / Profile / Pass / Fail / Score / Actions
- **Run Again** button on each history row — pre-fills image, content, profile, tailoring file
- **View Scan** button on each history row — loads that scan's full results card; replaces separate View Report + Download XML
- **Export CSV** link on history card — exports all manifest fields including image info
- Apply Remediation permanently stubbed — `oscap-podman` rejects `--remediate`
- All logic in `container-scan.js` — single `initContainerScan()` entry point; fully removable
- **`csRerunScan(manifest, autoStart=false)`** — same autoStart pattern as host; clicks `cs-scan-btn` after profile loads
- **Limited access mode** — "Administrative access required" empty state with actionable guidance when `podman images` fails; detected via `/not permitted|permission denied/i` on error message
- Tailoring file selection auto-fills profile dropdown from sidecar `base_profile_id` via `onCsTailorFileChange()`

### Selective Remediation (v3.3) — Host + Container
- After any scan (current or history), "Remediate" button opens the Selective Remediation panel
- Failing rules extracted from `results.xml` via Python, grouped HIGH / MEDIUM / LOW
- HIGH group expanded by default; MEDIUM and LOW collapsed
- Per-group "X of Y selected" counts with "Select all" / "Deselect all" toggle
- Global "Select All" / "Deselect All" shortcuts + total count
- Context bar: Profile, Score, Failing count, Content, Scanned timestamp (container also shows Image)
- "Download Bash Script" → filters existing `remediation.sh` to selected rules only
- "Download Ansible Playbook" → filters existing `remediation.yml` to selected rules only
- Bash filter: parses `# BEGIN fix` / `# END fix` block comments
- Ansible filter: parses task blocks by 4-space indent, matches rule ID in tags list
- Download filename: `selective-remediation-TIMESTAMP.sh` (host) / `container-selective-remediation-TIMESTAMP.sh`
- Container panel includes warning: "scripts apply to Containerfile/Dockerfile, not live container"
- Activity logged: `{ type: 'remediate_download', tab: 'host'|'container', fix_type, rules_selected: N }`
- `PY_EXTRACT_FAILING_RULES` and `PY_FILTER_FIX` constants in index.js (shared globals)
- Scan results buttons: View Full Report / Download Report / Download Results XML / Remediate / New Scan
- History row actions: Run Again / View Report / Download XML / Remediate / Delete
- **IMPORTANT:** Each tab has its own duplicate panel HTML with prefixed IDs (`ct-rem-` host, `cs-rem-` container). Shared page-level panels were tried and broke everything. Do not attempt again.

### Policy Tailoring Tab
- Content + base profile selection, named tailored profile
- Python3 iterparse extracts rule tree + variables from SDS; early break on Benchmark element avoids parsing 35MB OVAL section
- `<details>/<summary>` rule tree with checkboxes and delta tracking
- Expand All / Collapse All, rule search, variable editor
- Generates valid XCCDF tailoring XML + JSON sidecar — no `autotailor` dependency
- Saved Tailoring Files list: Edit, Download, Delete, Upload
- **View Guide** link alongside Load Profile
- **Update button** — when editing an existing file, shows "Update" (primary) + "Save as New" (secondary). Update overwrites original XML + JSON sidecar in place. Save as New creates new timestamped file as before.
- **Inline name field** — editor header shows ✏ icon + editable name input (bold, matches card title font). Populated when editor opens. Both Update and Save as New read name from this field. Pencil icon focuses/selects on click.
- `tailorEditingSidecar` module var tracks which file is being edited; cleared on resetTailorForm
- **Unified setup card** — matches Host/Container Scan layout: `ct-scan-body-grid` single card, form left, profile description right with border separator

### Content Library Tab
- System Content card: read-only list from `/usr/share/xml/scap/ssg/content/`
- Uploaded Content card: Name / File / Size / Modified / Actions columns
- **Upload SDS File button** — browser file picker → FileReader → `cockpit.file().replace()`; stat check before write; confirm dialog if file exists (shows existing size + date vs new size); Checking…/Uploading… button states; confirmed working at 26 MB
- **Validate** link runs `oscap ds sds-validate`; shows ✓ Valid / ✗ Invalid inline; error details in scrollable modal
- Size and Modified columns populated via `stat --format=%s %Y` per file

### Admin Gate (v3.4)
- `adminPermission = cockpit.permission({ admin: true })` with `typeof` guard (some Cockpit versions lack this API)
- `updateAdminControls()` queries all `.ct-requires-admin` buttons and disables/enables them; called on `changed` event and at end of each render function that creates privileged buttons
- Gated buttons: Content upload + delete; tailoring upload + delete; host history delete; container history delete; Activity Log Clear (also requires entries)
- Default: allowed when `adminPermission` null (API unavailable) — `{ superuser: 'require' }` on operations is the real enforcement boundary

### Compliance Dashboard Tab (v3.4 — Preview)
- One card per profile+SDS combo for host; one card per image for containers
- Score delta compares two most recent scans of same profile (was comparing most recent overall — bug fixed)
- **Score sparkline** — plain SVG `<polyline>`, green trending up / red trending down; only shown for 2+ scans
- **Quick Scan button** — calls `rerunHostScan(m, true)` / `csRerunScan(m, true)`; navigates to tab and auto-starts scan
- **View Last Scan** — navigates to tab AND loads results card
- **Needs Attention banner** — lists profiles with regressions and stale scans; green "all current" when clean
- **Staleness badges** — yellow at 7+ days, red at 14+ days; `STALE_WARN_DAYS` / `STALE_ERR_DAYS` constants
- All logic in `dashboard.js`; `dbManifests` module var for click handler lookup; `groupManifests(manifests, keyFn)` utility
- Preview badge stays until user feels confident — do not remove without discussion

### Activity Log Tab
- Real-time log of all user actions
- Semantic badge colors: blue=scan, red=deletes/errors, orange=remediation, teal=tailoring, yellow=validate, green=guide
- Full type→CSS class map (`ACTIVITY_BADGE_CLASS`) — not prefix-based
- Logs: scan_start/complete/cancel/error/delete, guide, validate, content_delete, tailor_upload/load/save/delete/download, remediate_download
- Written to `/var/lib/cockpit-scap/activity.log` as JSON lines; capped at 1000 entries
- Auto-refreshes every 3 seconds; poll starts/stops on tab activate/leave
- Filter chips: All / Scans / Guide / Content / Tailoring
- Limit selector: Last 50 / 100 / 250
- **Export CSV**, **Clear Log** with confirmation

---

## What Is NOT Done (Next Session Priority)

### 1. v3.5 — REMAINING (blocking tag)

1. **Version bump** — `MODULE_VERSION` in `src/index.js` still says `v3.4`. Change to `v3.5`.
2. **README** — version string + add v3.5 row to roadmap table + screenshots refresh (dashboard and settings look different)
3. **Full test suite run** — last clean run was 38/40 before today's session changes. Run `npm test` to confirm still clean with all session fixes in place.

### 2. v3.5 — COMPLETED THIS SESSION ✓

- ✓ **Remediation audit logging** — `/var/lib/cockpit-scap/remediation-logs/TIMESTAMP-PROFILE.log`, journal via `logger -t cockpit-scap`, modal footer "View in Activity tab" link, "View Log" button on activity rows with log viewer modal
- ✓ **System journal logging** — `buildJournalMessage()` in `appendActivityLog()` covers: scan start/complete/cancel/error/delete, remediation apply, content upload/delete, tailoring save/delete, settings change, activity clear
- ✓ **Admin gate audit** — tailoring save + update buttons got `ct-requires-admin`; Run Again on both results cards got `ct-requires-admin`; activity clear dual-gated (admin + has entries) confirmed correct
- ✓ **Stale cache fixes** — `csDetectTailoringFiles()` called after all 4 tailoring operations; `csDetectContent()` called after content upload/delete; `dbInvalidate()` called after host scan delete
- ✓ **Container scan limited access** — history card moved outside `cs-scan-section`; View Scan + Remediate from history call `csHidePrereq()` so results replace admin banner; Close returns banner; `csShowSetup()` re-shows banner for limited users
- ✓ **Remediate from history loads results first** — host scan Remediate button now calls `loadScanFromHistory` + `openRemediationPanel` together (consistent with container scan)
- ✓ **Download large files** — `downloadArtifact()` now uses `cockpit.file(path, { max_read_size: -1 })` — bypasses 15MB Cockpit bridge limit cleanly
- ✓ **Test regression scripts** — `tools/test-regression.sh` / `tools/test-regression-restore.sh` apply/remove 8 safe sysctl failures for Apply Now testing
- ✓ **Playwright dashboard reporter** — ASCII progress bar with per-file grouping, live `[████░░] N/40` counter, PASSED/FAILED summary

### 2. v3.4 — SHIPPED
COPR build 10529631, GitHub + Gitea tagged v3.4, 10.0.0.214 confirmed clean upgrade from v3.3.

### 3. Future / Parking Lot
| Item | Notes |
|---|---|
| **Scheduled scanning** | Deferred — requires systemd units + helper script in /usr/libexec/, which changes the operating model from pure Cockpit module to system service. Full rationale in DESIGN.md §"Scheduled Scanning — Deliberately Deferred". Revisit as companion sub-package or after Cockpit provides a background execution mechanism. |
| **Ansible remediation apply** | Bash Apply Now shipped in v3.5. Ansible apply still deferred — requires `ansible-playbook` installed on target, adds a dependency not guaranteed present. Ansible download remains available. Revisit if user base requests it. |
| **EPEL 10 submission** | Pre-work complete: `%check` section added, all rpmlint errors fixed (description line lengths, `%%post` macro-in-comment). Only false-positive spelling errors remain (`oscap`, `podman`, `optgroup`). Next steps: file Bugzilla package review request, ping Red Hat colleague for sponsor. User is RH employee — sponsor path straightforward. |
| **Dashboard — next wow features** | Current state: single host hero card (score, risk score, severity, critical findings by name), compact container cards. Not yet wowing. Next ideas to pursue: (1) Compliance Debt panel — rules failing N+ consecutive scans, days open, cross-profile; (2) Real 30/60/90-day trend chart per profile; (3) "Fix This Week" — filtered priority remediation download for HIGH failures only; (4) Collapsible last-scan summary row on Host Scan and Container Scan tabs (cards belong there, not dashboard). Dashboard stays Preview until one of these lands and the user is genuinely impressed. |
| **Dashboard Preview badge** | Do not remove until user is wowed by the dashboard. Current state does not meet that bar. |
| **Multi-host** | RHEL 10.2 deprecates Cockpit host switcher. Research Cockpit Client flatpak as sanctioned multi-host model before pursuing. |
| **Vulnerability scanning** | Trivy or similar — see Ecosystem Watch below. Explicitly out of scope today but natural next step. |
| **Security appliance** | Image mode bootable container, bake in openscap/SSG/Cockpit/cockpit-scap, MCP capabilities for AI-accessible compliance engine. Red Hat publishes an official hardened OpenSCAP container image (`registry.access.redhat.com/hi/openscap:latest`) — this is a natural scanner engine building block. Instead of requiring oscap installed on every host, the appliance pulls this image and runs scans via `podman run hi/openscap`, giving a consistent/signed oscap version everywhere. For multi-host scanning: central appliance pulls the image, SSHes to targets or mounts filesystems, runs scans, ships XCCDF results back. The orchestration + aggregation + UI layer is essentially what cockpit-scap already builds — the appliance is the next step up. |
| **Per-user settings** | Currently all settings (retention, tab visibility) are system-wide via `/var/lib/cockpit-scap/settings.json`. If a multi-user environment needs personal preferences (e.g. one user wants container scan hidden, another doesn't), per-user settings in `~/.config/cockpit-scap/` would be the path. Compliance policy settings (retention) should stay system-wide; only UI preferences would be per-user. Scope carefully before implementing. |
| **Cockpit applications page listing** | `jelly` from the cockpit team replied to the GitHub issue on 2026-06-01: "if you want to be featured on the cockpit website's application page make a PR to cockpit-project/cockpit-project.github.io". Hold until module is production-ready and polished enough to represent well in the enterprise Linux ecosystem. Pre-requisites: EPEL 10 listed, Dashboard Preview badge removed, sparkline polish complete, no known UX rough edges. |
| **External API / integration** | No outward-facing REST API story today — Cockpit is WebSocket/bridge, not HTTP. File-based data at `/var/lib/cockpit-scap/` is already an implicit API (manifests are JSON, results are standard XCCDF). Near-term: companion query script (`cockpit-scap-query --format json`) ships with RPM, ~2-3h work. Medium-term: D-Bus interface for Ansible/Prometheus/systemd integration. Long-term: REST microservice as separate systemd unit (changes operating model — same concern as scheduled scanning). Scope when a concrete integration request arrives. |
| **Activity log user field — extend to manifests** | `user` field added to activity log entries (v3.5). Natural follow-on: add `user` to scan manifest JSON at scan completion so history table and dashboard can show "run by pbuchan". Deferred — history table already dense. Revisit when multi-user display is explicitly requested. |
| **Admin gate / activity log audit** | ✓ Fixed in 2026-06-01 session — tailoring save/update, Run Again (both tabs), activity clear all properly gated. |
| **Stale cache after delete/add operations** | ✓ Fixed in 2026-06-01 session — all 6 one-liners applied. |

**Playwright test backlog** (tracked in `tests/TESTING.md`):

| Test | What to cover |
|---|---|
| Regression / improvement banners | Assert `#ct-regression-alert` or `#ct-improvement-alert` visible after loading a scan with a prior same-profile result; skip if only 1 result exists |
| Scan diff ("See what changed") | Click banner trigger, assert `#ct-scan-diff` shows Fixed/Regressed/New groups |
| Activity log user field | After an action, assert User column shows Cockpit login name (not "—") |
| Export CSV (history + activity) | Playwright download event; validate header rows |

### 3. Ecosystem Watch — gen-y-labs/cockpit-security
Discussion: https://github.com/cockpit-project/cockpit/discussions/22951  
Repo: https://github.com/gen-y-labs/cockpit-security (branch: feature/security)

A prototype Cockpit module combining Security Updates + Vulnerability Scan (Trivy) + Compliance (OpenSCAP). Posted to Cockpit maintainers for feedback. Built with TypeScript/Node.js toolchain. SCAP is one shallow tab among three — no tailoring, no history, no container scanning.

Their three-column security posture dashboard (patches + vulns + compliance) is where our long-term vision is heading. They built the frame without depth; we built deep on compliance and are growing outward. Worth revisiting to track maintainer response and whether Trivy integration makes sense for us.

---

## Key Architecture Decisions

| Decision | Outcome |
|---|---|
| Selective remediation panel | MUST be duplicated per-tab with prefixed IDs. Shared page-level panels break Cockpit's tab show/hide architecture. Tried and failed badly. |
| Scan config card | Single `pf-v6-c-card` with `ct-scan-body-grid` (CSS grid, 1fr 1fr). Left col: form fields. Right col: profile description with left border. Replaces two-card flex layout that caused layout shift. |
| View Scan / loadScanFromHistory | Sets all `current*` vars from manifest, hides scan row, calls `showResults`. Guarded by `if (currentScanProc) return`. `loadHistory()` called in `showScanProgress()` so rows rebuild with `disabled` state during scan. |
| Run Again on results card | `currentManifest` stored in `showResults`. Results card "Run Again" calls `rerunHostScan(currentManifest)`. `rerunHostScan` now calls `showScanSetup()` at top — works from both history and results card. |
| Failing rules summary | `renderFailingSummary(xmlPath, groupsId, loadingId)` — shared function, called from both `showResults` and `csShowResults`. Async, non-blocking. Uses existing `PY_EXTRACT_FAILING_RULES`. Silent catch — summary is informational. |
| Score donut | `buildScoreDonut(score, failCount)` in index.js — plain SVG, no library. Arc = compliance %, color = failure count (0=green, 1–10=yellow, 11+=red). Shared global, called from both `showResults` and `csShowResults`. Replaces plain score text and the earlier Compliant/Non-Compliant badge. |
| Regression/improvement detection | `findPreviousScan(manifest, history)` finds most recent scan with same profile_id + sds_file with older timestamp. Compares fail counts. One of three states: improvement (green banner), regression (yellow banner), or neither (both hidden). Container adds image_id to comparison. |
| Scan diff | `PY_SCAN_DIFF` parses two results.xml files, returns `{fixed, regressed, new_failures}` JSON. `loadScanDiff(newXml, oldXml, containerId)` renders collapsible groups inline below the banner. Triggered by "See what changed" button wired at banner-show time. `prevXml` derived from `prev.timestamp`. |
| Automated/Manual annotation | `PY_EXTRACT_FAILING_RULES` accepts optional `sys.argv[2]` (bash remediation path). Parses `# BEGIN fix (N / TOTAL) for 'rule_id'` blocks to build `auto_rules` set. Adds `automated: true/false` to each rule. Annotation hidden when remediation file absent. |
| Inline rule description/rationale | `PY_EXTRACT_FAILING_RULES` extracts `desc` and `rat` via `itertext()` (handles `<html:pre>` children). Rules with description rendered as `<details>` with summary row + expand body. Rules without description stay as plain `<div>`. |
| SDS upload overwrite check | `uploadContent(file)` stats dest path first. Non-zero exit = file absent → proceed directly. Zero exit = file exists → show confirm modal with existing size+date vs new size. Write only happens in `doWriteContent()` after confirmation. |
| Admin gate | `adminPermission = cockpit.permission({ admin: true })` wrapped in `typeof` guard. `updateAdminControls()` queries `.ct-requires-admin` selectors. Called from `changed` event AND at end of each render function that creates privileged buttons. Default: allowed when API unavailable. |
| Dashboard grouping | Host: `profile_id + sds_file` key. Container: `image_id \|\| image_name` key (image only — profile+image combos create too many cards). `groupManifests(manifests, keyFn)` utility in dashboard.js. |
| Settings scope | `settings.json` lives at `/var/lib/cockpit-scap/settings.json` — system-wide, applies to all Cockpit users on the host. Intentional: compliance tool configuration should be uniform per host, not per-user. If per-user settings are ever needed (e.g. personal UI preferences separate from compliance policy), they would go in `~/.config/cockpit-scap/` — but that is a different concern and should be scoped and discussed before implementing. |
| Quick Scan | `autoStart` boolean added to `rerunHostScan` and `csRerunScan`. When true, clicks the Run Scan button inside the Promise.all `.then()` after profile is loaded — timing is safe because profile select + dispatchEvent happen synchronously just before. |
| Dashboard sparkline | `buildSparkline(scores)` — `scores` array ascending (oldest first). SVG `<polyline>` with `preserveAspectRatio="none"`, `viewBox="0 0 200 28"`, `width="100%"`. Green if `scores[last] >= scores[0]`, red otherwise. Omitted for < 2 scores. |
| normalizePath() | Resolves `..` and `.` in a path string without filesystem access. Applied before every `startsWith(BASE)` path guard so a path like `BASE + '../../../etc/target'` is correctly rejected. Lives in index.js near the escape helpers. |
| TIMESTAMP_RE | `/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/` — module constant in index.js; `CS_TIMESTAMP_RE` same pattern in container-scan.js. Re-validated on every `manifest.timestamp` before use in path construction or `rm -rf`. Directory listing regex and manifest field validation are now consistent. |
| File.name validation | `uploadContent()` guards `file.name.includes('/')` before constructing `CONTENT_BASE + file.name`. Browser APIs already prevent `/` in File.name but code validates explicitly. |
| oscap-podman imageArg | `csImageId \|\| csImageName` stored in `imageArg` and validated `!imageArg \|\| imageArg.startsWith('--')` before passing to oscap-podman to prevent option confusion with crafted image tags. |
| Container scan modularity | All logic in `container-scan.js`; single `initContainerScan()` entry point; removable by deleting file + 3 references |
| Dashboard modularity | `dashboard.js` + single `initDashboard()` entry point — same pattern |
| History pruning | `pruneHistoryByType(scanType)` — host and container pruned independently to `HISTORY_MAX=10` each |
| Results parsing | Python3 `iterparse` server-side via `cockpit.spawn` — avoids 15–18 MB WebSocket limit for both scan types |
| oscap-podman invocation | Uses `csImageId` (stable 12-char ID) not tag name — immune to tag mutations |
| Manifest tools key | Must be `"index"` not `""` — empty string causes nav highlight loss |
| Activity log badge | `ACTIVITY_BADGE_CLASS` map in index.js maps full event type → CSS class. Not prefix-based. |
| Tailoring update | `tailorEditingSidecar` var tracks loaded file. `doUpdateTailoringFile()` overwrites in place. `resetTailorForm()` clears it and restores button state. |
| Cross-version content filtering | `detectSdsVersion(path)` extracts RHEL version from filename. `detectContent()` builds two filtered arrays for scan select — only files matching `hostOsVersion` appear. Tailor select always receives all files. `cpeBlocksScan`, `checkCpeCompat`, `showCpeAlert`, `clearCpeAlert` removed entirely. |
| Tailoring auto-fill | `onTailorFileSelectChange()` reads `tailoringFilesMap[path]` sidecar. If content differs from `sidecar.sds_path`, sets content select + calls `loadProfiles().then(setProfile)`. Container scan: `onCsTailorFileChange()` sets `cs-profile-select` then calls `csUpdateScanBtn()`. |
| Playwright test harness | `tests/` (gitignored). `npm test` runs 40 tests (~38 pass, 2 skip conditionally). `globalTeardown` auto-removes `playwright-*` artifacts after every run. Module loaded via direct URL — no iframe wrapper. Admin elevated on Cockpit SHELL overview page BEFORE navigating to module (critical: container scan renders blank otherwise). `requestAdmin()` uses `waitFor()` not `isVisible()` — do not revert. Settings tests must `await expect(saveBtn).toBeEnabled()` before clicking save (admin state is async). See `tests/TESTING.md` for full reference and test backlog. |
| RPM builds | MUST be built on rhel10cis — local Fedora produces `fc39` dist tag |
| Dev deploy target | rhel10cis has TWO locations. User-space `~/.local/share/cockpit/cockpit-scap/` takes precedence over system `/usr/share/cockpit/cockpit-scap/`. Always deploy to user-space (no sudo). System location is what the RPM uses — leave it alone. |
| Hardened build environment | rhel10cis had PCI-DSS remediation applied (121 rules, 2026-06-01). `requiretty` sudoers rule was backed out for dev convenience. Future rebuild WILL be fully hardened — all tooling and test scripts must work within `requiretty` and related constraints. Non-interactive `sudo` via SSH will not work on a hardened host. |
| Cockpit bridge restart | Optional — browser refresh sufficient for user-space deploys |
| Git identity | `Peter Buchan <pbuchan@redhat.com>` |
| Gitea remote | Named `origin` — use `git push origin main` |

---

## Session History

| Date | Version | Type | Summary |
|---|---|---|---|
| 2026-05-28 | v0.1 | Planning | Full design session — architecture locked |
| 2026-05-28 | v0.2–v0.8 | Implementation | Scaffolding → scan → tailoring tab complete |
| 2026-05-29 | v1.0 | Release | SELinux, Makefile, clean install test, Gitea |
| 2026-05-29 | v1.1 | UI Polish | Unified tailoring editor, variables panel, unsaved-changes guard |
| 2026-05-29 | v2.0 | Feature | Content tab, multi-version SDS, CPE detection |
| 2026-05-29 | v2.0 | Release | RPM, COPR, GitHub, code review (15 findings fixed) |
| 2026-05-29 | v2.1 | Release | Dark mode, UI polish, COPR build 10525374 |
| 2026-05-29 | v3.0-dev | Implementation | Container Scan tab, oscap-podman workflow, server-side XML parsing |
| 2026-05-30 | v3.0 | Release | Git/repo cleanup, code review (6 findings fixed), nav highlight fix, per-type history pruning, COPR + GitHub + Gitea |
| 2026-05-30 | v3.1 | Release | Run Again, View Guide (all 3 tabs), Export CSV, Content Validation; COPR build 10526904 |
| 2026-05-30 | v3.2 | Feature | Activity tab; src/ restructure; Dashboard stub; UI consistency polish |
| 2026-05-31 | v3.3 | Release | Selective Remediation Builder (host + container); Results XML download; Activity log badge colors + modal confirm; Dashboard (hostname, delta, cache); Tailoring Update-in-place + inline name; code review (9 findings); docs + screenshots refresh; COPR build 10528640 |
| 2026-05-31 | v3.4-dev | UI Polish | Unified scan config card; View Scan from history; results card persistence + timestamp + Close button; Run Again on results card; score donut (failure-count thresholds); CCE identifiers; Automated/Manual annotation; inline rule description/rationale expansion; regression + improvement banners; scan diff (See what changed); README + DESIGN.md overhaul; scheduled scanning deliberately deferred |
| 2026-05-31 | v3.4-dev | Features | SDS file upload (browser → cockpit.file, 26MB confirmed); overwrite confirmation with stat; admin gate (ct-requires-admin + cockpit.permission); container tab admin error state; dashboard overhaul (per-profile cards, sparkline, Quick Scan, attention banner, staleness badges, delta fix); Content Library size+modified columns; Policy Tailoring unified card layout |
| 2026-05-31 | v3.4-dev | Polish | Full code review (21 findings, 18 fixed); deep security audit (path traversal hardening, TIMESTAMP_RE validation, file.name guard, oscap-podman option confusion guard, startsWith bypass fix with normalizePath); dead code removal (~60 lines); screenshots refreshed; README curated to 4-shot narrative |
| 2026-05-31 | v3.4 | Release | COPR build 10529631 (el10); GitHub + Gitea release v3.4; 10.0.0.214 confirmed clean upgrade from v3.3 |
| 2026-06-01 | v3.4 | Polish | Cross-version content filtering: host scan shows only host-OS-compatible SDS; CPE alert removed. Tailoring auto-fill: selecting tailoring file populates content + profile (host + container). EPEL prep: `%check` section, rpmlint fixes. Playwright test harness: 19 passing, `npm test`, tests/ gitignored |
| 2026-06-01 | v3.5 | Features | Dashboard hero card: single full-width host compliance card, weighted risk score, async HIGH failure names. Settings tab: retention + tab visibility + admin gate + activity log. Table scroll caps (history + saved policies). Severity counts in manifest. Dashboard per-profile card grouping removed. |
| 2026-06-01 | v3.5 | Features | Selective Remediation Apply Now: two-gate confirmation (danger modal → script review), live streaming bash output, admin-gated, activity log. Remediation search (title + rule ID). Rule detail expansion (description + rationale). Policy editor name field: pf-v6-c-form-control + decorative pencil. Button hierarchy fix. Settings label fix. |
| 2026-06-01 | v3.5 | Testing + Polish | Playwright test suite expanded 29→40 tests covering all v3.5 features (settings tab visibility, Apply Now gate, remediation search, rule detail expansion, dashboard hero card, critical findings). Fixed 4 race conditions (requestAdmin used isVisible not waitFor; history-dependent tests used isVisible; dashboard async timing; tailoring auto-fill detectTailoringFiles rebuild race). globalTeardown auto-cleans playwright-* tailoring artifacts after each run. Activity log user field: cockpit.user() fetched at init, user: field on every log entry, User column in table and CSV. README items 1-5 done; items 6-8 (version bump, roadmap, screenshots) held pending user go-ahead to tag. |
| 2026-06-01 | v3.5 | Security + Polish | Remediation audit logging: structured log file + systemd journal via logger(1) + modal footer + Activity View Log button. System journal logging via buildJournalMessage() for all significant events. Admin gate audit: tailoring save/update + Run Again buttons gated. Stale cache: 6 cross-notify one-liners (csDetectTailoringFiles, csDetectContent, dbInvalidate). Container scan limited access: history always visible, View Scan/Remediate replace admin banner, Run Again gated. Remediate from history loads results card first (host scan parity with container). downloadArtifact max_read_size: -1 fixes 18MB XML download. Test regression scripts in tools/. Playwright ASCII dashboard reporter. PCI-DSS remediation accidentally applied to rhel10cis (121 rules, 99.6% score). requiretty + use_pty hardening backed out for dev. GitHub repo description + topics updated. README broadened to RHEL / CentOS Stream 10. |
| 2026-05-30 | v3.2 | Release | COPR build 10527341; GitHub release; RPM test host upgraded |
| 2026-05-31 | v3.3-dev | Feature | Selective Remediation (host + container); Dashboard (hostname, delta, cache, preview); activity badge colors; tailor_download log; results XML download; history table layout; tailoring Update-in-place + inline name field |

---

## Published Locations
- GitHub: https://github.com/pbuchan-rh/cockpit-scap
- COPR: https://copr.fedorainfracloud.org/coprs/pbuchan-rh/cockpit-scap/
- Gitea: http://git.beastmode.localdomain (internal) — remote name is `origin`
