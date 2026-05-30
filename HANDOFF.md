# cockpit-scap — Session Handoff

---

## Current State

**Version:** v2.0 (dark mode + UI polish)
**Last session:** 2026-05-29
**Deployed to:** rhel10cis.beastmode.localdomain

---

## What Is Built

### Tailoring Tab — UI (v1.1 additions)
- Unified editor: 3 separate cards replaced with 1 card, sticky header shows profile name + Save/Cancel always visible
- Variables section: Collapse/Expand toggle, search/filter input
- Unsaved changes guard: confirmation modal fires before Load Profile or Edit discards in-progress changes
- Base profile description panel: two-column layout matching Scan tab — description updates on profile select, clears on cancel/content change/edit

### Content Tab (v2.0)
- System Content card: read-only list of files from `/usr/share/xml/scap/ssg/content/`
- Uploaded Content card: list of files from `/var/lib/cockpit-scap/content/` with per-entry Delete (confirmation modal) and Refresh button
- SCP staging instructions shown inline
- All content files in `/var/lib/cockpit-scap/content/` must be root-owned (755 dir, root:root files) — prevents unprivileged overwrite

### Scan Tab
- Auto-detect SSG data stream files from `/usr/share/xml/scap/ssg/content/` **and** `/var/lib/cockpit-scap/content/`
- SDS selector uses `<optgroup>` grouping: "System Content" / "Uploaded Content"
- Human-readable SDS display names (static map covers all standard SSG filenames including RHEL 6–10)
- **CPE / OS compatibility check**: version extracted from filename (`ssg-rhel<N>-ds.xml`), compared against cached `/etc/os-release` `VERSION_ID`. Cross-version content shows inline warning and blocks scan; tailoring unaffected. Check is fully synchronous (host OS version cached at startup) — no race condition.
- Profile selection with full description display (description loads for all profiles including cross-version)
- Tailoring file selector (hidden until tailoring files exist, filtered by current SDS)
- Scan execution via `oscap xccdf eval` with cancel support
- Results summary — pass/fail/error/notchecked counts + compliance score
- **Uploaded content warning** in results card when scan used `/var/lib/cockpit-scap/content/` SDS
- View Full Report (IndexedDB bridge → viewer.html, CSP-compliant, handles large HTML)
- Download report, bash remediation, ansible remediation from results and history
- Apply Remediation button (disabled, tooltip "Coming in a future release" on hover — no label clutter)
- Scan history — last 10 scans retained, auto-pruned, each entry has View Report / Bash / Ansible / Delete
- **"uploaded content" badge** on history rows for scans that used uploaded SDS
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

Nothing blocking. Module is live on Fedora COPR.

### Optional / Future
| Item | Requirement | Notes |
|---|---|---|
| Upload button | REQ-53 | In-browser SDS upload to `/var/lib/cockpit-scap/content/`; deferred, SCP-first works |
| v3 container scanning | — | `oscap-podman` integration; requires its own design session |

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
| CPE detection method | Filename-based (`ssg-rhel<N>-ds.xml` regex) — `oscap info` text output does not include CPE lines for any tested satellite SSG files |
| CPE check timing | `hostOsVersion` cached from `/etc/os-release` at DOMContentLoaded; `checkCpeCompat` is synchronous — eliminates race condition where profile select populated before block fired |
| Content file ownership | Files in `/var/lib/cockpit-scap/content/` must be root:root — directory is already root-owned 755 but files placed by SCP retain the SCP user's ownership; Makefile install target creates the dir as root; admins staging via SCP should `sudo chown root:root` the files |
| Upload button | Deferred (REQ-53) — SCP-first approach; 35MB files through browser upload has unvalidated size limits in Cockpit; admins can scp directly |

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
| 2026-05-29 | v2.0 | Satellite content | 5 SDS files (RHEL 6–10) pulled from satellite.beastmode.localdomain (`scap-security-guide-satellite` package) → staged to local `content/` dir and `/var/lib/cockpit-scap/content/` on rhel10cis; files chowned root:root; `content/` added to .gitignore |
| 2026-05-29 | v2.0 | Bug fixes | Content detection hang: removed eager `oscap info` from `getUserContentMeta` (was parsing 5×20MB files on page load); CPE detection: `oscap info` output has no CPE lines for satellite SSG files — switched to filename regex; CPE race condition: `hostOsVersion` now cached at startup, `checkCpeCompat` is synchronous; profile description suppressed for cross-version content: fixed by separating description load from scan button gate |
| 2026-05-29 | v2.0 | Security | Root-owned content files (chown root:root on rhel10cis); uploaded-content warning in results card; "uploaded content" badge in scan history; documented spoofed-file remediation risk and mitigations |
| 2026-05-29 | v2.0 | Release | RPM spec written, LICENSE (GPL-2.0-or-later) added; built and tested on rhel10cis; GitHub repo (pbuchan-rh/cockpit-scap) created with clean release branch; v2.0 tag + GitHub Release with RPM/SRPM assets |
| 2026-05-29 | v2.0 | Code review | Multi-angle review: 15 findings; fixed concurrent scan guard, remediation null path crash, innerHTML XSS in content lists, NaN score guard, Promise.all returns, DOMParser validation, download error visibility, JSON.parse clarity, Makefile uninstall gap, %post silent failure; openscap-scanner moved to Recommends (spec bug found during clean install test) |
| 2026-05-29 | v2.0 | Clean install test | Fresh RHEL 10 VM (rhel10test, 10.0.0.214) on virt3; RPM install from zero, SELinux labeling confirmed, prereq detection on all 3 tabs, full scan workflow, clean rpm -e uninstall — all passed |
| 2026-05-29 | v2.0 | COPR | Submitted to Fedora COPR (pbuchan-rh/cockpit-scap); build succeeded; publicly installable via `dnf copr enable pbuchan-rh/cockpit-scap && dnf install cockpit-scap` |
| 2026-05-29 | v2.0 | COPR validation | Clean install validated via `dnf copr enable` + `dnf install` on rhel10test — GPG key import, SELinux %post labeling, and full scan workflow all confirmed from COPR |
| 2026-05-29 | v2.0 | UI overhaul | Playwright-assisted layout audit: identified and fixed native Cockpit alignment (PF6 section padding 16px/24px, container margins); removed redundant ct-page-title heading; restructured to single-panel design (transparent container, page background = unified gray panel, cards float on top); tab bar background matches page; removed edge-to-edge tab border-bottom; editor card border-radius fixed to 16px |
| 2026-05-29 | v2.0 | Dark mode | Full dark mode via `@media (prefers-color-scheme: dark)` + `html.pf-v6-theme-dark`; all `--ct-color-*` tokens matched to PF6's own dark token chain (measured via Playwright against native Cockpit modules): bg-page `#151515`, bg-card `#292929`, text `#ffffff`, text-secondary `#c7c7c7`, primary `#b9dafc`, border-dark `#a3a3a3`, danger `#f0561d`, success `#87bb62`, warning `#ffcc17`, info `#b6a6e9` (purple); primary button flips to light bg + dark text per PF6 dark pattern; COPR chroot note: must specify `rhel-10-x86_64` not epel when enabling |
| 2026-05-29 | v2.0 | UI polish | Results card footer: removed "Coming in a future release" label from Apply Remediation; moved text to `title` tooltip; New Scan button pushed to far right with `margin-left: auto` for visual separation |

---

## Next Session — Suggested Order

1. **Community engagement** — comment on cockpit-project/cockpit issue #19691 with link to repo; contact OpenSCAP project about listing as community tool
2. **Upload button** (REQ-53, optional) — in-browser SDS file upload to `/var/lib/cockpit-scap/content/`; validate Cockpit file size limits first
3. **v3 design session** — `oscap-podman` container image scanning; requires Podman, image enumeration, OS detection from image metadata

**Published locations:**
- GitHub: https://github.com/pbuchan-rh/cockpit-scap
- COPR: https://copr.fedorainfracloud.org/coprs/pbuchan-rh/cockpit-scap/
- Gitea: http://git.beastmode.localdomain (internal)

---

## Backlog (Priority Order)

1. **Community engagement** — cockpit-project/cockpit issue #19691, OpenSCAP project listing
2. **Upload button** (REQ-53) — optional but rounds out the content management story
3. **v3 `oscap-podman`** — container image scanning; own design session required

---

## Files in This Project

| File | Status |
|---|---|
| `CLAUDE.md` | ✅ Current |
| `DESIGN.md` | ✅ Current |
| `CLAUDE.md` | ✅ Current |
| `DESIGN.md` | ✅ Current |
| `HANDOFF.md` | ✅ This file — updated v2.0 |
| `README.md` | ✅ Updated — v2.0, COPR install instructions |
| `REQUIREMENTS.md` | ✅ Current |
| `PROMPT_DASHBOARD.md` | ⚠️ Stale — written for v0.9, not critical |
| `WORKBENCH_FEATURES.md` | ✅ Current |
| `ECOSYSTEM.md` | ✅ Current |
| `SCAP_TUI_DESIGN.md` | ✅ Current |
| `manifest.json` | ✅ Complete |
| `index.html` | ✅ v2.0 (code review hardened) |
| `index.js` | ✅ v2.0 (code review hardened) |
| `style.css` | ✅ v2.0 — dark mode, button polish |
| `viewer.html` | ✅ Complete |
| `selinux/cockpit-scap.fc` | ✅ Complete |
| `Makefile` | ✅ Complete — uninstall gap fixed |
| `cockpit-scap.spec` | ✅ Complete — built, tested, submitted to COPR |
| `LICENSE` | ✅ GPL-2.0-or-later |
