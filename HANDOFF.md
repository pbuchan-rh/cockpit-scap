# cockpit-scap — Session Handoff

---

## Current State

**Version:** v3.8-dev (in progress, not tagged)
**Last session:** 2026-06-02
**Last commit:** 62a9644 (feat: full profile remediation download on all three scan tabs)
**Git tag:** v3.6 on both remotes — v3.7 and v3.8 not yet tagged
**Deployed to:** rhel10cis.beastmode.localdomain — user-space install at `~/.local/share/cockpit/cockpit-scap/`
**Published:** COPR build 10534383 (v3.6, el10)
**RPM test host:** 10.0.0.214 on v3.6 — needs upgrade after v3.8 release
**GitHub release:** https://github.com/pbuchan-rh/cockpit-scap/releases/tag/v3.6
**Gitea release:** http://git.beastmode.localdomain:3000/admin/cockpit-scap/releases/tag/v3.6

**Status:** v3.8 implemented and deployed to rhel10cis. Scan results panel layout still needs final polish — user said "super close." Not tagged. MODULE_VERSION still says v3.6 — needs bump before release.

**rhel10cis state:**
- PCI-DSS partial remediation still applied (sysctl hardening, sudoers fixed)
- User-space deploy takes precedence: `~/.local/share/cockpit/cockpit-scap/`
- 20+ scan results in `/var/lib/cockpit-scap/results/`
- settings.json: host_retention=10, container_retention=10, dashboard_enabled=true

---

## What Is Built

### Host Scan Tab
- Auto-detect SSG data stream files (system + uploaded content)
- SDS selector with `<optgroup>` grouping, human-readable display names, cross-version filtering
- Profile selection with full description display
- Tailoring file selector with sidecar auto-fill
- Scan execution via `oscap xccdf eval` with cancel support
- **Dry-run command preview** — collapsible "View oscap command" in scan config card
- **Full profile remediation** — "Full Profile — Bash" / "Full Profile — Ansible" buttons in scan footer; generates `oscap xccdf generate fix` for entire profile without a prior scan; disabled until content + profile selected; filename uses visible profile name (e.g. `profile-remediation-pci-dss.sh`); tailoring tab includes active tailoring file if loaded, appends `-tailored` to filename
- **Scan ETA** — during scan, shows `1m 20s · ∼55s remaining` based on previous matching scan's `scan_duration_s`
- Results summary: pass/fail/error/notchecked badges + compliance score donut (animates in on scan complete)
- **Full-width action bar** — severity counts (HIGH/MEDIUM/LOW) left, Quick Fix + Review All right; separated from score row by border; loads automatable count async
- **Score delta in history** — inline ↑/↓ vs previous same-profile scan
- **Failing rules search** — appears after rules load, filters by title or CCE, auto-expands groups
- **Scan duration + ScanID** — `scan_duration_s` and `scan_id` stored in manifest; shown right-aligned in results card title
- View Full Report (IndexedDB bridge → viewer.html), Download report/XML
- View Guide, Run Again, Remediate, Close in results footer
- Regression/improvement banners; scan diff
- Better scan error logging (streams output, collapsible on failure)

### Selective Remediation — Drawer
- **Drawer pattern** — `ct-rem-drawer` fixed right overlay; slides in with backdrop; scan results stay fully visible
- Closes with Esc, Close button, or backdrop click
- Context bar: Profile, Score, Failing count, Content, Scanned
- Select All / Deselect All + count; search by title or rule ID
- Groups collapsed by default; per-group "Select all" toggle
- Download Bash / Ansible filtered to selected rules
- Apply Now: two-gate danger confirmation, live streaming output, full audit trail
- **Quick Fix mode** — pre-selects only automatable critical/high rules (`pendingQuickFix` flag)
- **Eager rule reuse** — `eagerRemRules` pre-loaded in `showResults()`, reused if same dir

### Container Scan Tab
- Full `oscap-podman` workflow; Action Board with Quick Fix (download-only, no Apply Now)
- **Drawer remediation** — same drawer pattern as host tab
- History "Remediate" loads scan AND opens drawer (parallel to host tab behavior)
- **Scan ETA** — matches by profile + SDS + image_id for per-image accuracy
- All scan, history, remediation, guide, CSV features parallel to host tab

### Policy Tailoring Tab
- Full XCCDF tailoring editor: rule tree, variable adjustment, search
- Saved Tailoring Files: Edit / Download / Delete / Upload

### Settings Tab
- **2-card side-by-side layout**: Settings card (Module Features, Retention, Data Management, Manual Scheduling) | Content Library card (System Content + Uploaded Content)
- Module Features: tab visibility toggles
- Scan Result Retention: configurable per type
- Data Management: disk usage + Clear All Data (modal confirmation)
- Manual Scheduling: cron command from most recent scan with Copy button
- Content Library: system SDS (read-only) + uploaded SDS (upload, validate, delete)

### Compliance Dashboard Tab (Preview)
- **Score trend chart** — full-width SVG in host card body; last 10 same-profile scans; color-coded by trend direction; hover tooltips (native SVG title) showing date + score
- **Unified Critical Findings** — single section replacing separate Priority Fixes + Critical Findings; header row with label + Quick Fix link; each rule listed with Automatable tag; Quick Fix button navigates to host scan + triggers Quick Fix
- **Rule detail drawer** — clicking a HIGH rule in Critical Findings opens a drawer showing full description, rationale, CCE, severity, and "View in Scan" button
- Host compliance hero card: score, risk score, severity breakdown
- Quick Scan, View Last Scan buttons
- Staleness badges, regression/attention banner
- Compact per-image container cards
- Preview badge stays until user is genuinely impressed

### Activity Log Tab
- Real-time timestamped record; filter by type; Export CSV; Clear Log

---

## What Is NOT Done (Next Session Priority)

### 1. Scan Results Panel — Final Polish

User said "super close but not quite there." The action bar layout (severity left, Quick Fix + Review All right, full-width) is the right approach. The remaining issue is likely the visual relationship between the score row (badges + donut) and the action bar below it. Possibly: the gap/spacing between the two rows, or the donut size/position still feeling off.

**Do NOT redesign from scratch** — the current approach is correct. Fine-tune CSS spacing only.

### 2. v3.8 Release Sequence

- ⬜ Bump `MODULE_VERSION` to v3.8 in `src/index.js`
- ⬜ Add v3.8 changelog entry to `cockpit-scap.spec`
- ⬜ Update README roadmap table + version line
- ⬜ Build RPM on rhel10cis → COPR → test on 10.0.0.214
- ⬜ Tag v3.8 on both remotes + GitHub release

### 3. v3.9 Candidates

| Item | Notes |
|---|---|
| **Scan results panel final polish** | CSS spacing/proportions; close to done |
| **CIS Level 1/2 weighting** | Group hierarchy traversal in XCCDF; more intelligent than weight alone |
| **Compliance Debt** | Rules failing N+ consecutive scans; needs cross-scan XML analysis; non-trivial |
| **Dashboard wow** | Remove Preview badge once user is genuinely impressed; depends on polish |
| **Cockpit applications page** | Pre-requisites: EPEL 10 listed, Dashboard Preview removed, no rough edges |
| **EPEL 10 submission** | rpmlint clean; file Bugzilla review request, find sponsor |
| **Scheduled scanning** | Deliberately deferred; systemd units + helper script; changes operating model |
| **Ansible Apply Now** | Deferred; requires ansible-playbook dependency |
| **ScanID surfacing** | ID generated and stored; not yet shown in history table or activity log |
| **Playwright test updates** | Drawer tests, action bar, score chart, rule detail drawer, ETA display |

### 4. Architecture Notes Added This Session

| Decision | Outcome |
|---|---|
| Drawer remediation | `ct-rem-drawer` class on panel divs. CSS `transform: translateX(100%)` default, `ct-drawer-open` class slides to 0. Shared `ct-drawer-backdrop`. ESC/backdrop/Close button all close. `openRemDrawer()` / `closeRemDrawer()` helpers in index.js; `openCsRemDrawer()` / `closeCsRemDrawer()` in container-scan.js; `openRuleDetailDrawer()` / `closeRuleDetailDrawer()` for the dashboard drawer. |
| Rule detail drawer | Third drawer `ct-rule-detail-drawer`. Populated by `populateRuleDetailDrawer(rule, manifest)` in dashboard.js. Rules stored in `dbInsightRules` from `loadHostInsights()`. |
| Scan ETA | `_estSecs` captured at scan start from most recent matching manifest `scan_duration_s`. Timer shows `elapsed · ~Ns remaining`. After elapsed > estSecs, shows `finishing…`. After elapsed > estSecs × 1.5, drops estimate. |
| ScanID format | `'scan-' + Date.now().toString(36) + Math.random().toString(36).substr(2,4)` → e.g. `scan-mpwvxw014zzb`. Stored in `manifest.scan_id`. |
| Score chart | `buildScoreChart(hostManifests, latest)` in dashboard.js. Returns SVG string. Filters to same profile+SDS, last 10, chronological. Uses SVG `<title>` for native hover tooltips. |
| Action bar | `ct-action-board` is now a flex row: `ct-action-board-left` (severity badges + auto count text) | `ct-action-board-actions` (buttons). `border-top` separator from score row. `justify-content: space-between`. |
| Keyboard shortcuts | `/` focuses visible failing-rules search. `Q` triggers Quick Fix on visible action board. `Esc` closes all drawers. Wired in single `keydown` listener in DOMContentLoaded. |
| Donut animation | `buildScoreDonut(score, failCount, animate)`. When `animate=true`: sets `stroke-dashoffset` to full circle, sets CSS transition, then two `requestAnimationFrame` calls trigger the draw-in. Pass `animate=true` only from `showResults()` and `csShowResults()`. |

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
| 2026-06-02 | v3.6 | UX + Release | Clear All Data, Gate 2 rule list, groups collapsed, scan timer, contextual activity, View Guide; COPR build 10534383 |
| 2026-06-02 | v3.7-dev | Feature | Action Board, weight field, shared renderer, history score delta, Content Library → Settings, Manual Scheduling, dry-run preview, better scan errors |
| 2026-06-02 | v3.8-dev | UX + Feature | Drawer remediation, action bar, donut animation, keyboard shortcuts, failing rules search, scan duration+ScanID, dashboard score chart, rule detail drawer, scan ETA, settings 2-card layout, full profile remediation on all tabs |

---

## Published Locations
- GitHub: https://github.com/pbuchan-rh/cockpit-scap
- COPR: https://copr.fedorainfracloud.org/coprs/pbuchan-rh/cockpit-scap/
- Gitea: http://git.beastmode.localdomain (internal) — remote name is `origin`
