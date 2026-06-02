# cockpit-scap — Session Handoff

---

## Current State

**Version:** v3.7-dev (in progress, not tagged)
**Last session:** 2026-06-02
**Last commit:** 9d22f56 (feat: v3.7 — Action Board, Recommended section, Content in Settings, dry-run)
**Git tag:** v3.6 on both remotes — v3.7 not yet tagged
**Deployed to:** rhel10cis.beastmode.localdomain — user-space install at `~/.local/share/cockpit/cockpit-scap/` (takes precedence over system install)
**Published:** COPR build 10534383 (v3.6, el10)
**RPM test host:** 10.0.0.214 upgraded to v3.6 — clean install confirmed, SELinux enforcing
**GitHub release:** https://github.com/pbuchan-rh/cockpit-scap/releases/tag/v3.6
**Gitea release:** http://git.beastmode.localdomain:3000/admin/cockpit-scap/releases/tag/v3.6

**Status:** v3.7 is implemented and deployed to rhel10cis. Ready for user acceptance testing. Not yet tagged or published to COPR.

**rhel10cis state:**
- PCI-DSS partial remediation still applied (sysctl hardening, sudoers fixed)
- User-space deploy takes precedence: `~/.local/share/cockpit/cockpit-scap/`
- 20+ scan results in `/var/lib/cockpit-scap/results/`
- settings.json: host_retention=10, container_retention=10, dashboard_enabled=true

---

## What Is Built

### Host Scan Tab
- Auto-detect SSG data stream files from `/usr/share/xml/scap/ssg/content/` and `/var/lib/cockpit-scap/content/`
- SDS selector uses `<optgroup>` grouping: "System Content" / "Uploaded Content"
- Human-readable SDS display names (static map covers all standard SSG filenames including RHEL 6–10)
- Cross-version content filtering — host scan dropdown shows only SDS files matching host OS version
- Profile selection with full description display
- Tailoring file selector always visible; selecting a tailoring file auto-fills content + profile from sidecar
- Scan execution via `oscap xccdf eval` with cancel support; server-side XML parsing
- **Dry-run command preview** — collapsible "View oscap command" section in scan config card; reactive to content/profile/tailoring selections; Copy button; both host and container tabs
- Results summary — pass/fail/error/notchecked counts + compliance score donut
- **Action Board** — below score donut: severity counts (HIGH/MEDIUM/LOW) from manifest immediately; automatable count loaded async; "Quick Fix — N rules" button pre-selects only automatable critical/high rules; "Review all N failures →" opens full panel
- **Score delta in history** — inline ↑+X% (green) or ↓-X% (red) vs previous same-profile scan in Score column
- View Full Report (IndexedDB bridge → viewer.html, CSP-compliant)
- Download report HTML, Download Results XML
- **View Guide** — generates oscap security guide; loading page shown during delay
- Scan history — configurable retention, auto-pruned per type
- Run Again / View Scan / Export CSV on history
- Prereq detection: install instructions if openscap-scanner / SSG missing
- Failing rules summary — HIGH/MEDIUM/LOW collapsible groups with CCE + Automated/Manual + expandable description/rationale
- Regression + improvement banners; "See what changed" scan diff
- **Better scan error logging** — streams oscap output; shows raw output in collapsible "View output" section on failure

### Container Scan Tab
- Full `oscap-podman` workflow; eager prereq checks at module init
- Image enumeration from root Podman store
- Version mismatch detection; three-state prereq empty state
- All scan, history, remediation, guide, CSV features parallel to host tab
- **Dry-run command preview** — `oscap-podman <image> xccdf eval …` command; reactive; Copy button
- **Better scan error logging** — same as host tab
- Limited access mode — history visible without admin; actionable guidance shown
- Apply Remediation permanently stubbed — container remediation is download-only

### Selective Remediation — Host + Container
- Failing rules extracted from results.xml via Python; grouped HIGH/MEDIUM/LOW
- **`buildRemPanelDOM(container, rules, updateCountFn, opts)`** — shared renderer eliminating ~80 lines of duplication between host and container panels
- **Recommended section** — at top of panel above severity groups; shows automatable critical/high rule count; own Download Bash / Download Ansible / Apply Now buttons (host) acting on that subset regardless of checkbox state; container shows Download only
- **XCCDF `weight` field** — extracted by `PY_EXTRACT_FAILING_RULES`; used to sort recommended rules (highest weight = most important)
- All severity groups collapsed by default; per-group "Select all" toggle
- Global Select All / Deselect All + total count; search by title or rule ID
- Download Bash / Ansible filtered to selected rules
- Apply Now: two-gate danger confirmation, live streaming bash output, full audit trail
- Context bar: Profile, Score, Failing count, Content, Scanned timestamp
- **Quick Fix mode** — when Action Board "Quick Fix" is clicked, panel opens with only recommended rules pre-selected (uncheck all, check recommended only); `pendingQuickFix` flag
- **Panel rule reuse** — `eagerRemRules` pre-loaded in `showResults()`; panel reuses them if same dir, skipping Python spawn

### Policy Tailoring Tab
- Full XCCDF tailoring editor: rule tree with enable/disable, variable adjustment, search
- Update-in-place or Save as New; inline name field; View Guide
- Saved Tailoring Files list: Edit / Download / Delete / Upload

### Settings Tab (expanded v3.7)
- Scan result retention per type; tab visibility toggles; admin-gated; audit-logged
- **Content Library** — moved from own tab into Settings: System Content card (read-only) + Uploaded Content card (upload, validate, delete with Size/Modified columns); refreshes on Settings tab open
- Clear All Data — wipes all scan results, tailoring files, uploaded content, remediation logs, activity log; confirmation modal; `data_clear` activity entry + journal
- **Manual Scheduling** — shows exact `oscap xccdf eval` command from most recent scan; Copy button; no systemd required
- Disk usage for full `/var/lib/cockpit-scap/` tree

### Compliance Dashboard Tab (Preview)
- Host compliance hero card: score, weighted risk score, severity breakdown, HIGH failure names
- Quick Scan, View Last Scan; Needs Attention banner; staleness badges
- Compact per-image container cards
- Preview badge stays until user is genuinely impressed — do not remove without discussion

### Activity Log Tab
- Real-time timestamped record; filter by type; Export CSV; Clear Log
- Semantic badge colors; `data_clear` activity type (red/danger)
- Auto-refresh every 3s; capped at 1000 entries

---

## What Is NOT Done (Next Session Priority)

### 1. v3.7 UAT + Release

- ⬜ User acceptance testing on rhel10cis — Action Board, Quick Fix, Recommended section, score delta, dry-run preview, error logging, Content in Settings
- ⬜ Bump `MODULE_VERSION` to v3.7 in `src/index.js`
- ⬜ Add v3.7 changelog entry to `cockpit-scap.spec`
- ⬜ Update README roadmap table + version line
- ⬜ Build RPM on rhel10cis, push to COPR, test install on 10.0.0.214
- ⬜ Tag v3.7 on both remotes + create GitHub release

### 2. UX Feedback — "Still reads linearly"

User noted during v3.7 implementation that the UI "reads very linearly." The Action Board helps but the results experience may still feel like a sequential report rather than an outcome dashboard. Discuss after UAT — possible next moves:
- Drawer/slide-in remediation panel (right long-term answer per design doc)
- Collapsible last-scan summary row on scan tabs
- Richer Dashboard as the real landing experience

### 3. v3.8 Candidates

| Item | Notes |
|---|---|
| **CIS Level 1/2 weighting** | Extract group hierarchy from XCCDF to differentiate Level 1 (must-do baseline) vs Level 2 rules within CIS profiles. More intelligent than weight alone but requires group hierarchy traversal. Park for v3.8 after weight-based recommendations are validated. |
| **Dashboard wow features** | Compliance Debt panel (rules failing N+ consecutive scans); 30/60/90-day trend chart; "Fix This Week" filtered priority download. Dashboard stays Preview until one lands. |
| **Scheduled scanning** | Deliberately deferred — requires systemd units + helper script in /usr/libexec/, changes operating model. Cron hint in Settings covers the immediate need. |
| **Ansible Apply Now** | Download works; apply deferred — requires `ansible-playbook` installed, adds dependency not guaranteed present. |
| **EPEL 10 submission** | rpmlint clean, `%check` section added. Only false-positive spelling errors remain. Next: file Bugzilla review request, find sponsor. |
| **Drawer remediation** | Right long-term answer for remediation UX. Scope after Action Board proves value. |
| **Cockpit applications page** | Hold until module is production-ready. Pre-requisites: EPEL 10 listed, Dashboard Preview badge removed, no known UX rough edges. |

### 4. Playwright Test Backlog

| Test | What to cover |
|---|---|
| Action Board | Assert `#ct-action-board` visible after scan; Quick Fix button enabled when automatable rules exist |
| Recommended section | After opening remediation panel, assert `ct-rem-recommended` visible with Apply Now and download buttons |
| Score delta | Assert ↑/↓ delta spans visible in history Score column after 2+ same-profile scans |
| Dry-run command | Assert `ct-scan-cmd-details` shows after profile selected; command contains profile ID and SDS path |
| Error output | Assert `ct-scan-error-details` visible after a forced scan error |
| Content in Settings | Already covered by updated content-library.spec.js |
| Regression/improvement banners | Assert `#ct-regression-alert` or `#ct-improvement-alert` visible |
| Scan diff | Click banner trigger, assert Fixed/Regressed/New groups |
| Activity user field | After action, assert User column shows Cockpit login |

---

## Key Architecture Decisions

| Decision | Outcome |
|---|---|
| Selective remediation panel | MUST be duplicated per-tab with prefixed IDs. Shared page-level panels break Cockpit tab show/hide. Tried and failed. |
| `buildRemPanelDOM` | Shared JS renderer, separate DOM per tab. Defined in index.js (global scope), called from container-scan.js. Takes `(container, rules, updateCountFn, opts)`. `opts.showApplyNow` controls Apply Now visibility. `opts.onRec*` callbacks for Recommended section buttons. |
| Recommended section actions | Act on precomputed `recRules` subset — do NOT read checkbox state. `onRecApply` → `applyRecommendedRules(rec)`, downloads → `generateSelectiveFix(type, ids, btn)` with optional override params. |
| Action Board eager load | `showResults()` runs `PY_EXTRACT_FAILING_RULES` eagerly and stores result in `eagerRemRules`. `openRemediationPanel()` reuses `eagerRemRules` if `resultsDir === currentResultsDir`, skipping a second Python spawn. |
| Quick Fix pre-select | `pendingQuickFix` flag set before `openRemediationPanel()` call. `renderRemediationRules()` checks flag after building DOM — unchecks all, re-checks recommended only, clears flag. |
| Score delta | `findPreviousScan(manifest, currentHostHistory)` called inside `buildHistoryRow()`. Delta computed per-row at render time. `ct-score-delta-up` / `ct-score-delta-down` CSS classes use PF6 success/danger color tokens. |
| Dry-run command | `updateHostScanCmd()` called from `setScanButtonEnabled()` — fires whenever profile/content/tailoring changes. Hidden until profile + content both selected. Same pattern in `csUpdateScanBtn()` → `updateCsScanCmd()`. |
| Scan error output | `cockpit.spawn().stream(data => scanOutput += data)` during scan. Passed to `onScanError(msg, output)`. Shown in collapsible `<details>` only when output is non-empty. Both host and container. |
| Content Library in Settings | Removed `panel-content` tab panel and `tab-btn-content` nav item. Cards moved into `panel-settings`. `onSettingsTabOpen()` calls `renderContentTab()` + `detectContent()` so content refreshes on each Settings tab open. |
| RPM builds | MUST be built on rhel10cis — local Fedora produces wrong dist tag. Workflow: `git archive` tarball → scp to rhel10cis `~/rpmbuild/SOURCES/` → `rpmbuild -ba` → COPR from rhel10cis. |
| Dev deploy target | rhel10cis user-space `~/.local/share/cockpit/cockpit-scap/` takes precedence. Deploy via `scp src/` files there — no sudo, no make. |
| Scan config card | Single `pf-v6-c-card` with `ct-scan-body-grid` (CSS grid 1fr 1fr). Left: form fields. Right: profile description with border. |
| Score donut | `buildScoreDonut(score, failCount)` — plain SVG, no library. Color: 0 fail=green, 1–10=yellow, 11+=red. |
| Regression/improvement | `findPreviousScan(manifest, history)` finds most recent with same profile_id + sds_file + older timestamp. One of three states. |
| Admin gate | `updateAdminControls()` queries `.ct-requires-admin`. Called on `changed` event AND after any render that creates privileged buttons. Default: allowed when API unavailable. |
| XCCDF weight | Extracted in `PY_EXTRACT_FAILING_RULES` as `float(rule.get("weight", "1.0"))`. Default 1.0. SSG sets higher on important rules. Used to sort recommended set descending. |
| normalizePath() | Resolves `..` in path strings before `startsWith(BASE)` guards — prevents path traversal. |
| TIMESTAMP_RE | `/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/` — validated on every manifest.timestamp before use in path construction. |
| Git identity | `Peter Buchan <pbuchan@redhat.com>` |
| Gitea remote | Named `origin` — use `git push origin main` |

---

## Session History

| Date | Version | Type | Summary |
|---|---|---|---|
| 2026-05-28 | v0.1 | Planning | Full design session — architecture locked |
| 2026-05-28 | v0.2–v0.8 | Implementation | Scaffolding → scan → tailoring tab complete |
| 2026-05-29 | v1.0 | Release | SELinux, Makefile, clean install test, Gitea |
| 2026-05-29 | v1.1–v2.1 | Feature + Release | Content tab, multi-version SDS, dark mode, COPR |
| 2026-05-29 | v3.0–v3.2 | Feature + Release | Container scan, oscap-podman, activity tab, src/ restructure |
| 2026-05-31 | v3.3–v3.4 | Feature + Release | Selective Remediation, Apply Now, scan diff, SDS upload, admin gate, dashboard, COPR |
| 2026-06-01 | v3.5 | Feature + Release | Apply Now two-gate, Settings tab, dashboard hero card, Playwright tests (40), COPR build 10533906 |
| 2026-06-02 | v3.6 | UX + Release | Clear All Data, Gate 2 rule list, groups collapsed, download feedback, scan timer, contextual activity, View Guide loading page; COPR build 10534383; RPM on 10.0.0.214 confirmed |
| 2026-06-02 | v3.7-dev | Feature | Action Board, Recommended section, weight field, shared renderer, history score delta, Content Library → Settings, Manual Scheduling, dry-run command preview, better scan errors |

---

## Published Locations
- GitHub: https://github.com/pbuchan-rh/cockpit-scap
- COPR: https://copr.fedorainfracloud.org/coprs/pbuchan-rh/cockpit-scap/
- Gitea: http://git.beastmode.localdomain (internal) — remote name is `origin`
