# cockpit-scap — Session Handoff

---

## Current State

**Version:** v0.9
**Last session:** 2026-05-28
**Deployed to:** rhel10cis.beastmode.localdomain

---

## What Is Built

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
| SELinux `.fc` file | REQ-50, REQ-58 | File contexts for `results/`, `tailoring/`, and `content/` — include v2 path now |
| SELinux install automation | REQ-33 | `semanage fcontext` + `restorecon` at install time — zero manual admin steps |
| Install mechanism | REQ-49 | Makefile with `install` / `uninstall` targets at minimum; RPM spec for community/COPR release |

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

---

## Next Session — Suggested Order

**Goal:** SELinux deliverable + install mechanism + source control

1. Write `selinux/cockpit-scap.fc` — file contexts for `results/`, `tailoring/`, and `content/` (cover v2 path now)
2. Write Makefile with `install` and `uninstall` targets — copies module files, runs `semanage fcontext` + `restorecon`
3. Test a clean install from the Makefile on rhel10cis
4. RPM spec skeleton (needed before community release, not during dev)

**Source control:** Project is now in Gitea at `git.beastmode.localdomain`

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
| `selinux/cockpit-scap.fc` | ✅ Written — pending install test on rhel10cis |
| `Makefile` | ✅ Written — pending install test on rhel10cis |
