# cockpit-scap — Requirements

**Status:** v1 requirements locked  
**Last updated:** 2026-05-28

---

## Functional Requirements — v1

### Content Discovery

- **REQ-01:** The module MUST auto-detect installed SSG data stream files from `/usr/share/xml/scap/ssg/content/`
- **REQ-02:** The module MUST display human-readable names for detected SDS files, not raw filenames
- **REQ-03:** The module MUST gracefully handle the case where no SSG content is installed, displaying a clear message with installation instructions

### Profile Selection

- **REQ-04:** The module MUST populate a profile list by parsing `oscap info` output for the selected SDS file
- **REQ-05:** The module MUST display the full profile description when a profile is selected
- **REQ-06:** The module MUST NOT enable the scan button until a profile is selected

### Scan Execution

- **REQ-07:** The module MUST execute `oscap xccdf eval` with `{ superuser: "require" }` via `cockpit.spawn()`
- **REQ-08:** The module MUST pass both `--report` and `--results` flags to every scan invocation
- **REQ-09:** The module MUST save scan output to `/var/lib/cockpit-scap/results/<TIMESTAMP>/`
- **REQ-10:** The module MUST provide a cancel mechanism that terminates the running `oscap` process
- **REQ-11:** The module MUST display scan progress feedback — at minimum a spinner; live output streaming if LOE is acceptable
- **REQ-12:** The module MUST NOT require elevation for any action prior to scan execution

### Results Display

- **REQ-13:** The module MUST display a result summary banner showing pass, fail, error, and notchecked counts
- ~~**REQ-14:** The module MUST display severity breakdown (Critical, High, Medium, Low, Informational)~~ — **Deferred to v2.** Severity breakdown belongs with the rule table (REQ-15); deferring together.
- ~~**REQ-15:** The module MUST display a rule-by-rule results table with title, severity, and result per rule~~ — **Deferred to v2.** The `oscap` HTML report already provides a rich, standards-compliant rule-by-rule view. An in-page table would be a lower-fidelity duplicate; implementing it at the quality needed (titles from SDS, expandable rows, filters) added disproportionate complexity for no UX gain over "View Full Report." Engineering time better spent on tailoring.
- ~~**REQ-16:** The rule results table MUST be filterable by result status and severity~~ — **Deferred to v2.** See REQ-15 rationale.
- ~~**REQ-17:** Expanding a rule row MUST show the full rule description and fix text~~ — **Deferred to v2.** See REQ-15 rationale.
- **REQ-18:** Result status colors MUST use PatternFly semantic color tokens — no hardcoded hex values
- **REQ-19:** The module MUST provide a "View Full Report" action that opens the `oscap` HTML report in a new browser window

### Remediation

- **REQ-20:** The module MUST generate a bash remediation script using `oscap xccdf generate fix --fix-type bash`
- **REQ-21:** The module MUST generate an Ansible remediation playbook using `oscap xccdf generate fix --fix-type ansible`
- **REQ-22:** Both remediation artifacts MUST be offered as file downloads
- ~~**REQ-23:** The module MUST display a fapolicyd advisory notice wherever remediation downloads are presented~~ — **Struck.** Target audience (security admins) knows their stack; advisory would require equivalent warnings for SELinux, auditd, etc. Removed as UI clutter inconsistent with audience.
- **REQ-24:** The "Apply Remediation" button MUST be present in the v1 UI but clearly disabled/stubbed with a "coming in a future release" indicator

### Scan History

- **REQ-25:** The module MUST persist a `manifest.json` for each completed scan containing: timestamp, SDS path, profile ID, profile title, result-id, pass/fail/error counts, and score
- **REQ-26:** The module MUST display a scan history table showing past scans with date, profile, and result counts
- **REQ-27:** Each history entry MUST provide links to view the report (new window) and download both remediation artifacts
- **REQ-28:** The history view MUST display a PatternFly empty state when no scans have been performed

### Tailoring Tab

- **REQ-29:** The Tailoring tab MUST be present and visible in v1 ✅ — delivered as full editor in v0.8, exceeding original stub scope
- **REQ-30:** ~~The Tailoring tab MUST display a clear, honest placeholder communicating that tailoring is coming in a future release~~ — **Exceeded.** Full tailoring editor delivered in v0.8.
- **REQ-31:** ~~The placeholder MUST describe what tailoring will do so the user understands the roadmap~~ — **Exceeded.** See REQ-30.

---

## Non-Functional Requirements

### Security

- **REQ-32:** The module MUST operate with SELinux in enforcing mode — permissive mode is not a supported configuration
- **REQ-33:** The module install MUST configure the correct SELinux file context for `/var/lib/cockpit-scap/` automatically — no manual admin SELinux steps
- **REQ-34:** The module MUST NOT require any firewall rule changes
- **REQ-35:** The module MUST NOT make any outbound network connections
- **REQ-36:** The module MUST NOT use `eval()` or dynamic script injection anywhere
- **REQ-37:** Privilege elevation MUST be scoped to scan execution only — never broader

### UI Fidelity

- **REQ-38:** The module MUST be visually indistinguishable from a native Cockpit page
- **REQ-39:** All styling MUST use PatternFly components and CSS custom property tokens
- **REQ-40:** All custom CSS classes MUST use the `ct-` prefix
- **REQ-41:** The module MUST use RedHatDisplay and RedHatText fonts — no external font sources
- **REQ-42:** No inline styles are permitted in HTML templates
- **REQ-43:** No inline event handlers are permitted in HTML (`onclick`, `onchange`, etc.)

### CSP Compliance

- **REQ-44:** The module MUST comply with `default-src 'self'` CSP — no external CDN references
- **REQ-45:** Visibility toggling MUST use `classList.add/remove` — never `style.display` manipulation via class names

### Compatibility

- **REQ-46:** The module MUST run on RHEL 10 with Cockpit 344+
- **REQ-47:** The module MUST use vanilla JS only — no Node.js, React, or build toolchain
- **REQ-48:** The module MUST function correctly when `openscap-scanner`, `scap-security-guide`, and `openscap-utils` packages are installed

### Install

- **REQ-49:** The module install MUST be a single, repeatable operation with no manual post-install steps required
- **REQ-50:** The module MUST ship SELinux file context definitions as a formal deliverable

---

---

## v2 Requirements

### Multi-Version SDS Content Management

- **REQ-51:** ✅ The module MUST auto-detect SDS files from both `/usr/share/xml/scap/ssg/content/` (system-managed) and `/var/lib/cockpit-scap/content/` (user-managed) and present them in the SDS selector
- **REQ-52:** ✅ The SDS selector MUST visually distinguish system-installed content from user-uploaded content — implemented as `<optgroup>` grouping ("System Content" / "Uploaded Content")
- **REQ-53:** ⬜ ~~The module MUST provide an upload button~~ — **Deferred.** SCP-first approach; admins stage files to `/var/lib/cockpit-scap/content/` directly. Upload button is an optional future addition pending Cockpit file size limit validation.
- **REQ-54:** ✅ The module MUST provide a content management UI listing all files in `/var/lib/cockpit-scap/content/` with per-entry delete (routed through the confirmation modal)
- **REQ-55:** ✅ Cross-version detection implemented via filename pattern (`ssg-rhel<N>-ds.xml`). Note: `oscap info` text output does not include CPE lines for satellite SSG content; filename-based detection is reliable for all SSG-named files.
- **REQ-56:** ✅ Cross-version SDS disables scan button with inline explanation. Implementation is synchronous (host OS version cached at startup) to prevent race conditions.
- **REQ-57:** ✅ Tailoring tab fully available for cross-version content — verified with RHEL 7/8/9 satellite content on RHEL 10 host.
- **REQ-58:** ✅ `/var/lib/cockpit-scap/content/` covered by `selinux/cockpit-scap.fc` wildcard — confirmed `cockpit_var_lib_t` context on rhel10cis.

**Security note (discovered during implementation):**
Files staged via SCP retain the SCP user's ownership. The directory is root-owned 755 (prevents creating new files without sudo) but existing files owned by the cockpit user can be overwritten without sudo. Files should be `chown root:root` after staging. A compromised unprivileged user who can write to content files could craft a malicious SDS to generate a harmful remediation script. Mitigations: root-owned files, UI warning on remediations from uploaded content, "uploaded content" badge in scan history.

---

## v3 Requirements

### Container Image Scanning (`oscap-podman`)

- **REQ-59:** ✅ Tab layout MUST be updated: "Scan" tab renamed to "Host Scan"; new "Container Scan" tab added between "Host Scan" and "Tailoring"

- **REQ-60:** ✅ Container Scan tab MUST enumerate images from the root Podman store via `podman images --format json` with `{ superuser: "require" }` — no other image stores are enumerated

- **REQ-61:** ✅ Container Scan tab MUST display a graceful prereq empty state for three distinct failure conditions: (a) `oscap-podman` binary not found, (b) Podman not installed, (c) no images exist in root's store — each condition shows a specific message with install or fix instructions

- **REQ-62:** ✅ Container Scan tab MUST support SDS file selection from both system and uploaded content — same sources and `<optgroup>` grouping as Host Scan

- **REQ-63:** ✅ Container Scan tab MUST NOT apply the CPE/OS compatibility check — cross-version scanning of container images is the intended use case and scanning a RHEL 8 image with the RHEL 8 SDS from a RHEL 10 host is correct behavior

- **REQ-64:** ✅ Container Scan tab MUST support profile selection with description display, matching Host Scan behavior

- **REQ-65:** ✅ Container Scan tab MUST support optional tailoring file selection, matching Host Scan behavior

- **REQ-66:** ✅ Scan execution MUST use `oscap-podman <image-id> xccdf eval` with `{ superuser: "require" }` — no new polkit action files, sudoers entries, or system configuration required beyond what Host Scan already uses

- **REQ-67:** ✅ Results card MUST display a contextual note explaining that rules marked `notapplicable` apply only to bare metal and virtual systems, not container images (per RHEL 10 Security Hardening guide §5.2.5) — this count will be significantly higher than in host scans

- **REQ-68:** ✅ Container scan artifacts MUST be identical in format to host scan artifacts: `results.xml`, `report.html`, `remediation.sh`, `remediation.yml`, `manifest.json`

- **REQ-69:** ✅ `manifest.json` MUST include `scan_type: "container"`, `image_name`, and `image_id` fields for container scans; existing host scan manifests without this field MUST be treated as `scan_type: "host"` for backwards compatibility — no migration of old entries required

- **REQ-70:** ✅ Scan history table MUST display a "Container" badge on container scan rows and show the image name where the host scan identifier would appear

- **REQ-71:** ✅ Rootless per-user Podman image stores MUST NOT be enumerated or scanned; the UI MUST display an inline note on the Container Scan tab explaining the limitation and the workaround (`sudo podman pull <image>`) — full rationale documented in DESIGN.md

- **REQ-72:** ✅ Registry image pull during the scan workflow is out of scope — local images in root's store only

- **REQ-73:** ✅ Apply Remediation MUST remain disabled/stubbed for container scans — `oscap-podman` explicitly rejects `--remediate`; container image remediation requires a separate image build workflow outside this tool's scope

**Implementation note:** All container scan logic MUST live in a separate `container-scan.js` file with a single `initContainerScan()` entry point wired from `index.js`. The feature MUST be developed on a dedicated git branch and merged to main only after validation on rhel10test. Full removal surface: delete `container-scan.js`, remove tab/panel from `index.html`, remove one call from `index.js`, delete one CSS block.

---

## Post-v3 Requirements (v3.1)

### Run Again

- **REQ-74:** ✅ Host and container scan history tables MUST each provide a "Run Again" action that pre-fills the scan form (content, profile, tailoring file) from the scan manifest and switches to the correct tab
- **REQ-75:** ✅ `manifest.json` MUST store `tailoring_file` for both host and container scans; Run Again with a tailoring file MUST restore the base SDS profile using `base_profile_id` from the tailoring sidecar, not the tailoring profile ID
- **REQ-76:** ✅ Run Again buttons MUST be disabled while a scan is in progress on their respective tab

### Content Validation

- **REQ-77:** ✅ The Uploaded Content list MUST provide a per-file Validate action that runs `oscap ds sds-validate` and displays inline pass/fail status; on failure a scrollable error modal MUST display the full oscap output

### View Guide

- **REQ-78:** ✅ Host Scan, Container Scan, and Tailoring tabs MUST each provide a "View Guide" button that generates and displays an oscap security guide for the selected content and profile
- **REQ-79:** ✅ View Guide MUST be active when content and profile (or tailoring file) are selected; it MUST NOT be blocked by CPE version mismatch or scan-in-progress state
- **REQ-80:** ✅ Guide generation MUST use `oscap xccdf generate guide` stdout directly — no intermediate file write, no superuser required

### Export CSV

- **REQ-81:** ✅ Host and Container scan history tables MUST each provide an Export CSV action that downloads all manifest fields as a properly escaped CSV file
- **REQ-82:** ✅ Export CSV buttons MUST be disabled when no history entries exist

---

---

## v3.3 Requirements

### Selective Remediation Builder

- **REQ-83:** ✅ After any scan (current or history), a "Remediate" button MUST open a Selective Remediation panel showing all failing rules from `results.xml`, grouped by severity (HIGH/MEDIUM/LOW)
- **REQ-84:** ✅ The HIGH severity group MUST be expanded by default; MEDIUM and LOW collapsed
- **REQ-85:** ✅ Each group MUST show a per-group selected count and "Select all" / "Deselect all" toggle
- **REQ-86:** ✅ Global "Select All" / "Deselect All" shortcuts and a total selected count MUST be present
- **REQ-87:** ✅ "Download Bash Script" MUST filter the existing `remediation.sh` to selected rules only using Python block parsing (`# BEGIN fix` / `# END fix`)
- **REQ-88:** ✅ "Download Ansible Playbook" MUST filter the existing `remediation.yml` to selected rules only by parsing task blocks and matching rule IDs in the tags list
- **REQ-89:** ✅ The Selective Remediation panel MUST be available for both host scans and container image scans; the container panel MUST include a warning that remediation scripts apply to Containerfile/Dockerfile, not a live container
- **REQ-90:** ✅ "Remediate" button MUST be disabled when remediation scripts were not generated for the scan (e.g. oscap generation failure)

### Results XML Download

- **REQ-91:** ✅ A "Download Results XML" button MUST be available on scan results and on each history row for both host and container scans
- **REQ-92:** ✅ The downloaded file MUST be the unmodified `results.xml` produced by `oscap`

### Activity Log

- **REQ-93:** ✅ All user-initiated actions MUST be logged to `/var/lib/cockpit-scap/activity.log` as JSON lines, capped at 1000 entries
- **REQ-94:** ✅ Logged event types MUST include: `scan_start`, `scan_complete`, `scan_cancel`, `scan_error`, `scan_delete`, `guide`, `validate`, `content_delete`, `tailor_upload`, `tailor_load`, `tailor_save`, `tailor_delete`, `tailor_download`, `remediate_download`
- **REQ-95:** ✅ The Activity tab MUST display log entries with semantic badge colors: blue=scan, red=delete/error, orange=remediation, teal=tailoring, yellow=validate
- **REQ-96:** ✅ The Activity tab MUST support filter chips (All / Scans / Guide / Content / Tailoring), a limit selector, Export CSV, and Clear Log with confirmation

### Compliance Dashboard (Preview)

- **REQ-97:** ✅ A Dashboard tab MUST show the latest scan result per host and per container image as status cards with compliance score, pass/fail counts, profile, content, and time since last scan
- **REQ-98:** ✅ The host card MUST display the actual hostname; container cards MUST show the image name
- **REQ-99:** ✅ Score delta vs previous scan MUST be shown (↑/↓) when available and ≥ 0.05% difference
- **REQ-100:** ✅ Dashboard data MUST be cached on first load; a manual Refresh button reloads it; completing a new scan automatically invalidates the cache
- **REQ-101:** ✅ The Dashboard tab MUST be marked as a preview feature

### Tailoring Update-in-place

- **REQ-102:** ✅ When editing an existing tailoring file, an "Update" button MUST overwrite the original XML and JSON sidecar in place
- **REQ-103:** ✅ A "Save as New" button MUST create a new timestamped file, leaving the original unchanged
- **REQ-104:** ✅ An inline editable name field in the editor header MUST allow renaming the profile; both Update and Save as New MUST use this name

---

## v3.4 Requirements (Planned)

### Scheduled Scanning

- **REQ-105:** The module MUST ship a polkit rule (`/usr/share/polkit-1/rules.d/10-cockpit-scap.rules`) that authorizes admin users to run `/usr/libexec/cockpit-scap-scan` as root — no sudoers modification required
- **REQ-106:** A headless scan script (`/usr/libexec/cockpit-scap-scan`) MUST produce output identical to a live scan: `results.xml`, `report.html`, `remediation.sh`, `remediation.yml`, `manifest.json` written to `/var/lib/cockpit-scap/results/TIMESTAMP/`
- **REQ-107:** The headless scan script MUST prune host scan history to 10 entries and append to `activity.log` on completion
- **REQ-108:** Scheduled scans MUST be defined as named schedules stored in `/var/lib/cockpit-scap/schedules/<name>.json` with fields: `sds`, `profile`, `tailoring` (optional), `cron`, `enabled`, `last_run`, `last_status`, `last_error`
- **REQ-109:** The module MUST ship parameterized systemd units `cockpit-scap-scan@.service` and `cockpit-scap-scan@.timer` — one instance per named schedule; no units are enabled automatically at install time
- **REQ-110:** The Host Scan tab MUST include a Schedules section listing all configured schedules with name, profile, cron expression, last run time, last status, and an enable/disable toggle
- **REQ-111:** The schedule create/edit form MUST accept a raw cron expression with an inline example (`0 2 * * 0` = every Sunday at 2am); no dropdown abstraction
- **REQ-112:** Scheduled scan results MUST appear in the normal scan history table with a "Scheduled" badge distinguishing them from manual scans
- **REQ-113:** When a scheduled scan's `last_status` is `error`, a persistent dismissable banner MUST appear on the Host Scan tab; dismissal MUST be written to the schedule JSON so the banner does not reappear for that failure
- **REQ-114:** Activity log MUST record `scan_scheduled_complete` and `scan_scheduled_error` event types
- **REQ-115:** Container scan scheduling is explicitly out of scope for v3.4; the architecture MUST NOT preclude adding it in a future version

---

## v3.4 UI Polish Requirements

### Scan Results Card

- **REQ-116:** ✅ The scan results card MUST display a failing rules summary below the pass/fail/score badges, grouped by severity (HIGH / MEDIUM / LOW) using collapsible `<details>/<summary>` elements; HIGH MUST be expanded by default; empty severity groups MUST be hidden
- **REQ-117:** ✅ The failing rules summary MUST be loaded asynchronously after the results card renders — a spinner MUST display while loading and disappear when complete; failures MUST be silently suppressed (summary is informational)
- **REQ-118:** ✅ The results card MUST display the scan timestamp as a secondary line below the profile title
- **REQ-119:** ✅ The results card "New Scan" button MUST be replaced with "Run Again" — it MUST pre-fill the scan form with the current scan's content, profile, and tailoring file (same behaviour as history row "Run Again")

### Scan History Actions

- **REQ-120:** ✅ Host and container scan history rows MUST provide a "View Scan" action that loads the full results card for that historical scan — setting all scan state vars from the manifest and rendering the results card including the failing rules summary
- **REQ-121:** ✅ "View Scan" and "Run Again" history actions MUST be visually disabled while a scan is in progress; the history table MUST be rebuilt when a scan starts so disabled state is reflected immediately
- **REQ-122:** ✅ "View Scan" MUST guard against concurrent scan state corruption — if a scan is in progress the action MUST be a no-op regardless of button state

### Scan Configuration Layout

- **REQ-123:** ✅ Host Scan and Container Scan configuration MUST use a single unified card with an internal two-column grid — form fields on the left, profile description on the right separated by a vertical border; the previous two-card split layout is replaced

---

## Out of Scope — v1

The following are explicitly NOT requirements for v1. Do not implement without formal design discussion:

- Remote SSH scanning (`oscap-ssh`)
- Container / container image scanning (`oscap-podman`) — implemented in v3; see REQ-59 through REQ-73
- Multi-version SDS content management (REQ-51 through REQ-58) — v2
- One-click in-place remediation application
- Ansible remediation application
- RPM packaging (needed before community release, not during active development)
- OVAL vulnerability scanning — explicitly out of scope; this tool fills the Workbench compliance scanning and tailoring gap, not the vulnerability detection gap. For connected systems, Red Hat Insights and `dnf updateinfo list sec` already serve this need. Adding OVAL scanning changes the tool's identity and audience without solving a problem that isn't already answered.

---

## Prerequisite Packages

The following packages must be installed on the target system. The module MUST detect their absence
and display a clear installation guide rather than failing silently:

| Package | Purpose |
|---|---|
| `openscap-scanner` | Provides the `oscap` binary |
| `scap-security-guide` | Provides SSG data stream files in `/usr/share/xml/scap/ssg/content/` |
| `openscap-utils` | Provides `oscap xccdf generate fix` utilities for remediation generation |

---

## Acceptance Criteria — v1 Complete

v1 is considered complete when all of the following are true:

- [x] Auto-detection and profile selection works end-to-end
- [x] Scan executes successfully and all artifacts are saved to the correct path
- [x] Results summary renders correctly (pass/fail/error/notchecked counts + score)
- [x] HTML report opens in a new window
- [x] Bash and Ansible remediation downloads work
- [x] Scan history persists across Cockpit sessions and renders correctly (with delete)
- [x] Apply Remediation button is visibly stubbed
- [x] Tailoring tab delivered in full (exceeded original stub scope)
- [x] All of the above work with SELinux in **enforcing** mode — tested and confirmed; formal `.fc` deliverable shipped
- [x] Module is visually consistent with native Cockpit pages
- [x] No CSP violations in browser console
- [x] No inline styles or inline event handlers anywhere in the codebase
