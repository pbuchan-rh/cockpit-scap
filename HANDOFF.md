# cockpit-scap — Session Handoff

---

## Current State

**Version:** v2.0
**Last session:** 2026-05-29
**Deployed to:** rhel10cis.beastmode.localdomain

---

## What Is Built

### Tailoring Tab — UI (v1.1 additions)
- Unified editor: 3 separate cards replaced with 1 card, sticky header shows profile name + Save/Cancel always visible
- Variables section: Collapse/Expand toggle, search/filter input
- Unsaved changes guard: confirmation modal fires before Load Profile or Edit discards in-progress changes
- Base profile description panel: two-column layout matching Scan tab — description updates on profile select, clears on cancel/content change/edit

### Scan Tab
- Auto-detect SSG data stream files from `/usr/share/xml/scap/ssg/content/`
- Human-readable SDS display names
- Profile selection with full description display
- Tailoring file selector (hidden until tailoring files exist, filtered by current SDS)
- Scan execution via `oscap xccdf eval` with cancel support
- Results summary — pass/fail/error/notchecked counts + compliance score
- View Full Report (IndexedDB bridge → viewer.html, CSP-compliant, handles large HTML)
- Download report, bash remediation, ansible remediation from results and history
- Apply Remediation button (visibly stubbed — "Coming in a future release")
- Scan history — last 10 scans retained, auto-pruned, each entry has View Report / Bash / Ansible / Delete
- Confirmation modal on all destructive actions (history delete, tailoring delete)
- Prereq detection: shows install instructions if openscap-scanner / SSG are missing

### Tailoring Tab
- Content + base profile selection, named tailored profile
- Python3 iterparse extracts rule tree + variables from SDS; early break on Benchmark element avoids parsing 35MB OVAL section
- `<details>/<summary>` rule tree with checkboxes and delta tracking (only changes from base profile stored)
- Expand All / Collapse All, rule search (hides non-matching rules + empty groups, auto-opens groups with matches)
- Variable editor: select dropdown for enumerated values, text input otherwise
- Generates valid XCCDF tailoring XML + JSON sidecar — no `autotailor` dependency
- Saved Tailoring Files list: Edit (re-loads into editor with prior changes restored), Download, Delete
- Upload: accepts external XCCDF tailoring XML, writes xml + json sidecar
- After save: editor resets, list refreshes
- Tailoring file delete routes through confirmation modal

---

## What Is NOT Done (Remaining Before Community Release)

| Item | Requirement | Notes |
|---|---|---|
| RPM spec | — | Needed for Fedora/COPR packaging before community release |

---

## Key Architecture Decisions

| Decision | Outcome |
|---|---|
| Tailoring implementation | Pure Python3 iterparse + in-browser XML string generation — no `autotailor` dependency |
| Large SDS parsing | Python iterparse with early break on `Benchmark` element — skips 35MB OVAL section |
| Report delivery | IndexedDB bridge → viewer.html — CSP-compliant, handles arbitrarily large reports |
| Privilege model | `{ superuser: "require" }` scoped to scan execution and file writes only |
| Tailoring storage | `/var/lib/cockpit-scap/tailoring/<name>-<timestamp>.xml` + `.json` sidecar |
| fapolicyd advisory | Struck from requirements (REQ-23) — target audience (security admins) knows their stack |
| Rule results table | Struck (REQ-14/15/16/17) — oscap HTML report covers this better with zero implementation cost |
| `generateRemediation` failure | Non-fatal — logs error, does not block results display; known limitation for tailored scans |

---

## Session History

| Date | Version | Type | Summary |
|---|---|---|---|
| 2026-05-28 | v0.1 | Planning | Full design session — architecture, privilege model, storage layout, all decisions locked |
| 2026-05-28 | v0.2 | Implementation | Module scaffolding — manifest, HTML skeleton, CSS, tab wiring, SDS detection |
| 2026-05-28 | v0.3 | Implementation | Profile loading, description display, scan button enable/disable; PF6 CSS audit |
| 2026-05-28 | v0.4–v0.7 | Implementation | Scan execution, cancel, results display, remediation gen, scan history, report viewer |
| 2026-05-28 | v0.8 | Implementation | Full tailoring tab — rule tree, variables, save/load/edit/delete/upload/download, tailored scans |
| 2026-05-29 | v0.9 | Implementation | Scan history delete, confirmation modal on all destructive actions, README.md |
| 2026-05-29 | v0.9 | Planning | Workbench feature audit (WORKBENCH_FEATURES.md), scap-tui concept (SCAP_TUI_DESIGN.md), v2/v3 roadmap locked, OVAL scanning explicitly out of scope, container scanning deferred to v3 |
| 2026-05-29 | v1.0 | Release | SELinux .fc file, Makefile install/uninstall, clean install test on rhel10cis — all v1 acceptance criteria met, SELinux enforcing mode confirmed, project checked into Gitea |
| 2026-05-29 | v1.1 | UI Polish | Page alignment fix; unified tailoring editor (3 cards → 1 sticky card); variables Collapse/Expand + search; unsaved-changes guard on Load Profile and Edit; base profile description panel on Tailoring tab matching Scan tab pattern; bug fixes: stray div, description state not clearing on Cancel/Edit |
| 2026-05-29 | v2.0 | Feature | Content tab: system content list + user-staged content list with delete; SDS selectors now use optgroups (System Content / Uploaded Content); CPE/OS compatibility detection — cross-version content blocks scan, shows inline alert, tailoring unaffected; getUserContentMeta sidecar for display names; loadProfiles returns raw oscap output |

---

## Next Session — Suggested Order

**Goal:** v2 testing + remaining v2 items

1. **Live test on rhel10cis** — verify Content tab, SDS optgroups, CPE alert with an actual cross-version SDS file (stage an RHEL 8 or 9 SDS into `/var/lib/cockpit-scap/content/` via scp and exercise the full flow)
2. **Cross-version tailoring verification** — confirm tailoring tab loads an RHEL 8/9 profile and produces valid XML when a cross-version SDS is selected (REQ-57)
3. **RPM spec skeleton** — needed before community release (Fedora COPR)

**Upstream engagement (when ready):**
- Comment on cockpit-project/cockpit issue #19691 with link to repo
- Publish to Fedora COPR
- Contact OpenSCAP project about listing as community tool

---

## Backlog (Priority Order)

### v1 — Remaining
1. **SELinux `.fc` file** — REQ-50/REQ-58; include `/var/lib/cockpit-scap/content/` path now for v2 readiness
2. **Makefile install/uninstall** — REQ-49, required for repeatable installs
3. **RPM spec** — parking lot, needed for Fedora/COPR packaging
4. **Silent remediation failure for tailored scans** — `oscap xccdf generate fix` failure is non-fatal; a UI warning would be better than silent failure

### v2 — Multi-Version SDS Content Management
5. **Content directory + upload UI** — REQ-51–54; `/var/lib/cockpit-scap/content/`, upload button, management list
6. **CPE / target OS detection** — REQ-55–56; parse `oscap info`, block scan for cross-version content
7. **Cross-version tailoring** — REQ-57; tailoring tab works identically for RHEL 7/8/9 content
8. **In-place remediation apply** — deferred v2, requires design discussion

### v3 — Container Image Scanning
9. **`oscap-podman` integration** — enabled by v2 content management; scan RHEL 7/8/9 images with matching SSG content; requires Podman installed; image enumeration + OS detection from image metadata

---

## Files in This Project

| File | Status |
|---|---|
| `CLAUDE.md` | ✅ Current |
| `DESIGN.md` | ✅ Current |
| `HANDOFF.md` | ✅ This file — v0.9 |
| `README.md` | ✅ Written for v0.9 |
| `REQUIREMENTS.md` | ✅ Current |
| `PROMPT_DASHBOARD.md` | ✅ Current |
| `manifest.json` | ✅ Complete |
| `index.html` | ✅ v0.9 |
| `index.js` | ✅ v0.9 |
| `style.css` | ✅ v0.9 |
| `viewer.html` | ✅ Complete |
| `selinux/cockpit-scap.fc` | ✅ Complete — tested on rhel10cis, SELinux enforcing confirmed |
| `Makefile` | ✅ Complete — clean install tested on rhel10cis |
