# cockpit-scap — Requirements

**Status:** v1 requirements locked  
**Last updated:** 2026-06-10

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

### Compliance Dashboard (Preview) — ~~CUT in v3.9~~

> These requirements were implemented (v3.3–v3.8) and then removed in v3.9. No clear UX direction emerged. Kept here as a record of what was tried. If a dashboard is revisited, start from a fresh UX proposal rather than restoring this implementation.

- **REQ-97:** ~~A Dashboard tab MUST show the latest scan result per host and per container image as status cards with compliance score, pass/fail counts, profile, content, and time since last scan~~
- **REQ-98:** ~~The host card MUST display the actual hostname; container cards MUST show the image name~~
- **REQ-99:** ~~Score delta vs previous scan MUST be shown (↑/↓) when available and ≥ 0.05% difference~~
- **REQ-100:** ~~Dashboard data MUST be cached on first load; a manual Refresh button reloads it; completing a new scan automatically invalidates the cache~~
- **REQ-101:** ~~The Dashboard tab MUST be marked as a preview feature~~

### Tailoring Update-in-place

- **REQ-102:** ✅ When editing an existing tailoring file, an "Update" button MUST overwrite the original XML and JSON sidecar in place
- **REQ-103:** ✅ A "Save as New" button MUST create a new timestamped file, leaving the original unchanged
- **REQ-104:** ✅ An inline editable name field in the editor header MUST allow renaming the profile; both Update and Save as New MUST use this name

---

## Scheduled Scanning Requirements (Deferred — not v3.4)

> **Status: Deliberately deferred.** Scheduled scanning requires shipping systemd units and a helper script in `/usr/libexec/`, which changes cockpit-scap from a pure Cockpit module into a system-level service. This conflicts with the module's operating model. Full rationale in DESIGN.md §"Scheduled Scanning — Deliberately Deferred". Requirements preserved here for future reference.

- **REQ-105:** ⬜ The module MUST ship a polkit rule (`/usr/share/polkit-1/rules.d/10-cockpit-scap.rules`) that authorizes admin users to run `/usr/libexec/cockpit-scap-scan` as root — no sudoers modification required
- **REQ-106:** ⬜ A headless scan script (`/usr/libexec/cockpit-scap-scan`) MUST produce output identical to a live scan: `results.xml`, `report.html`, `remediation.sh`, `remediation.yml`, `manifest.json` written to `/var/lib/cockpit-scap/results/TIMESTAMP/`
- **REQ-107:** ⬜ The headless scan script MUST prune host scan history to 10 entries and append to `activity.log` on completion
- **REQ-108:** ⬜ Scheduled scans MUST be defined as named schedules stored in `/var/lib/cockpit-scap/schedules/<name>.json` with fields: `sds`, `profile`, `tailoring` (optional), `cron`, `enabled`, `last_run`, `last_status`, `last_error`
- **REQ-109:** ⬜ The module MUST ship parameterized systemd units `cockpit-scap-scan@.service` and `cockpit-scap-scan@.timer` — one instance per named schedule; no units are enabled automatically at install time
- **REQ-110:** ⬜ The Host Scan tab MUST include a Schedules section listing all configured schedules with name, profile, cron expression, last run time, last status, and an enable/disable toggle
- **REQ-111:** ⬜ The schedule create/edit form MUST accept a raw cron expression with an inline example (`0 2 * * 0` = every Sunday at 2am); no dropdown abstraction
- **REQ-112:** ⬜ Scheduled scan results MUST appear in the normal scan history table with a "Scheduled" badge distinguishing them from manual scans
- **REQ-113:** ⬜ When a scheduled scan's `last_status` is `error`, a persistent dismissable banner MUST appear on the Host Scan tab; dismissal MUST be written to the schedule JSON so the banner does not reappear for that failure
- **REQ-114:** ⬜ Activity log MUST record `scan_scheduled_complete` and `scan_scheduled_error` event types
- **REQ-115:** ⬜ Container scan scheduling is explicitly out of scope; the architecture MUST NOT preclude adding it in a future version

---

## v3.4 Requirements (UI Polish Release)

### Scan Results Card

- **REQ-116:** ✅ The scan results card MUST display a failing rules summary below the pass/fail/score badges, grouped by severity (HIGH / MEDIUM / LOW) using collapsible `<details>/<summary>` elements; HIGH MUST be expanded by default; empty severity groups MUST be hidden
- **REQ-117:** ✅ The failing rules summary MUST be loaded asynchronously after the results card renders — a spinner MUST display while loading and disappear when complete; failures MUST be silently suppressed (summary is informational)
- **REQ-118:** ✅ The results card MUST display the scan timestamp as a secondary line below the profile title
- **REQ-119:** ✅ The results card "New Scan" button MUST be replaced with "Run Again" — it MUST pre-fill the scan form with the current scan's content, profile, and tailoring file (same behaviour as history row "Run Again")
- **REQ-124:** ✅ The results card MUST display a compliance score donut (plain SVG arc) replacing the bare score text — arc length represents the compliance percentage; arc color is based on failure count: 0 failures=green, 1–10=yellow, 11+=red; score percentage shown in center; applies to both host and container scan results
- **REQ-126:** ✅ The results card footer MUST include a Close button at the far right that dismisses the results card and returns to the scan configuration form without pre-filling fields
- **REQ-125:** ✅ Each failing rule in the summary MUST display its CCE identifier (e.g. CCE-80537-8) as secondary gray text below the rule title when available; rules without a CCE identifier show title only; no bullet points

### Scan History Actions

- **REQ-120:** ✅ Host and container scan history rows MUST provide a "View Scan" action that loads the full results card for that historical scan — setting all scan state vars from the manifest and rendering the results card including the failing rules summary
- **REQ-121:** ✅ "View Scan" and "Run Again" history actions MUST be visually disabled while a scan is in progress; the history table MUST be rebuilt when a scan starts so disabled state is reflected immediately
- **REQ-122:** ✅ "View Scan" MUST guard against concurrent scan state corruption — if a scan is in progress the action MUST be a no-op regardless of button state

### Scan Configuration Layout

- **REQ-123:** ✅ Host Scan and Container Scan configuration MUST use a single unified card with an internal two-column grid — form fields on the left, profile description on the right separated by a vertical border; the previous two-card split layout is replaced

### Failing Rules — Inline Detail

- **REQ-127:** ✅ Each failing rule in the summary MUST be expandable via `<details>/<summary>` to reveal the rule description and rationale extracted from results.xml; rules without description data MUST render as plain non-expandable rows
- **REQ-128:** ✅ Each failing rule MUST display a right-aligned remediation type annotation — "Automated" (green) when the rule ID appears in the generated bash remediation script, "Manual" (gray) otherwise; annotation MUST be omitted if no remediation script was generated

### Regression and Improvement Detection

- **REQ-129:** ✅ After any scan (current or historical), if the failure count is higher than the most recent previous scan of the same profile and content, a persistent warning banner MUST appear showing the exact delta and previous scan timestamp (e.g. "7 more failing rules than your previous scan on [date] (213 → 220)")
- **REQ-130:** ✅ If the failure count is lower than the most recent previous scan of the same profile and content, a green improvement banner MUST appear with the same format; regression and improvement banners are mutually exclusive
- **REQ-131:** ✅ Both regression and improvement banners MUST include a "See what changed" button that diffs the two results.xml files and displays Fixed / Regressed / New failures as collapsible groups inline; Fixed and Regressed MUST be expanded by default

### SDS File Upload (v3.4)

- **REQ-132:** ✅ The Content Library tab MUST provide an Upload SDS File button that opens a browser file picker and writes the selected file to `/var/lib/cockpit-scap/content/` via `cockpit.file().replace()`; confirmed working up to 26 MB
- **REQ-133:** ✅ Before writing an uploaded file, the module MUST stat the destination path; if the file already exists, a confirmation dialog MUST display the existing file's size and modification date alongside the new file size before overwriting
- **REQ-134:** ✅ The Upload button MUST show "Checking…" during the stat and "Uploading…" during the write; success and failure states MUST be shown inline below the help text; button MUST be re-enabled on completion or error
- **REQ-135:** ✅ The Uploaded Content table MUST include Size and Modified columns populated via `stat`

### Admin Gate (v3.4)

- **REQ-136:** ✅ All upload and delete buttons MUST be disabled for non-administrative Cockpit sessions; `cockpit.permission({ admin: true })` MUST be used with a typeof guard for older Cockpit versions; buttons MUST carry a tooltip "Administrative access required" when disabled
- **REQ-137:** ✅ The admin gate MUST apply to: Content Library upload and delete; tailoring file upload and delete; host and container scan history delete; Activity Log Clear; the gate MUST update reactively when the user elevates mid-session
- **REQ-138:** ✅ The Container Scan tab MUST display "Administrative access required" with actionable guidance when `podman images` fails due to limited Cockpit session, rather than a generic error

### Compliance Dashboard (v3.4)

- **REQ-139:** ✅ The Dashboard MUST show one card per unique profile+SDS combination for host scans, and one card per unique container image for container scans
- **REQ-140:** ✅ Each dashboard card MUST include a score sparkline — plain SVG polyline showing compliance score trend over all scans in that group; green if trending up, red if trending down; omitted for single-scan groups
- **REQ-141:** ✅ Dashboard score delta MUST compare the two most recent scans of the same profile and content, not the two most recent scans overall
- **REQ-142:** ✅ Each dashboard card MUST include a Quick Scan button that navigates to the appropriate tab and auto-starts a scan using the most recent scan's exact configuration (content, profile, tailoring file)
- **REQ-143:** ✅ View Last Scan MUST navigate to the appropriate tab AND load the results card, not just switch tabs
- **REQ-144:** ✅ Cards where the last scan is 7+ days old MUST show a yellow Stale badge; 14+ days MUST show a red Stale badge
- **REQ-145:** ✅ A Needs Attention banner MUST appear at the top of the dashboard listing profiles with regressions and stale scans; when all profiles are current a green confirmation message MUST be shown

### Policy Tailoring Layout (v3.4)

- **REQ-146:** ✅ The Policy Tailoring tab configuration section MUST use the same unified single-card two-column grid layout as the Host Scan and Container Scan tabs

### Content Compatibility (v3.5 session)

- **REQ-147:** ✅ The Host Scan content dropdown MUST only show SDS files whose RHEL version matches the current host OS version — cross-version files MUST be silently excluded; no warning banner is shown
- **REQ-148:** ✅ The Policy Tailoring and Container Scan content selectors MUST continue to show all available SDS files regardless of host OS version

### Tailoring UX (v3.5 session)

- **REQ-149:** ✅ Selecting a tailoring file on the Host Scan tab MUST automatically populate the content and profile dropdowns from the tailoring file's sidecar metadata (`base_profile_id`, `sds_path`)
- **REQ-150:** ✅ Selecting a tailoring file on the Container Scan tab MUST automatically populate the profile dropdown from the sidecar `base_profile_id`

### EPEL Submission Prep (v3.5 session)

- **REQ-151:** ✅ The RPM spec file MUST include a `%check` section explaining why no automated build-time tests are possible for a vanilla JS Cockpit module
- **REQ-152:** ✅ The RPM spec MUST pass `rpmlint` with no ERROR or WARNING findings other than known false-positive spelling errors for technical terms (`oscap`, `podman`, `optgroup`)

### Selective Remediation — Apply Now (v3.5 session)

- **REQ-153:** ✅ The Selective Remediation panel MUST include an Apply Now button for host scans that executes the filtered bash remediation script on the local host
- **REQ-154:** ✅ Apply Now MUST present a two-gate confirmation flow: Gate 1 = danger warning modal ("changes cannot be automatically reversed"); Gate 2 = scrollable script preview with rule count; execution only proceeds after both gates are confirmed
- **REQ-155:** ✅ Apply Now MUST be disabled (admin-gated with tooltip) in limited Cockpit sessions — identical to upload and delete operations
- **REQ-156:** ✅ Apply Now MUST stream live bash output to an inline panel and display exit code and success/error status on completion
- **REQ-157:** ✅ Apply Now MUST log a `remediate_apply` entry to the activity log with rule count and exit code
- **REQ-158:** ✅ Container scan selective remediation MUST NOT include an Apply Now button — `oscap-podman` rejects `--remediate`; container remediation is permanently download-only
- **REQ-159:** ✅ The Selective Remediation panel MUST include a search bar filtering rules by title OR short rule ID; non-matching rules and empty severity groups MUST be hidden; Select All / Deselect All MUST respect the active search filter
- **REQ-160:** ✅ Each rule in the Selective Remediation panel MUST include a collapsible Details section showing the rule description and rationale inline

### Dashboard (v3.5 session) — ~~CUT in v3.9~~

- **REQ-161:** ~~The Dashboard MUST display a single full-width host compliance hero card showing the most recent host scan regardless of profile — not grouped per profile~~
- **REQ-162:** ~~The host compliance card MUST display a weighted risk score: `(high × 10) + (medium × 3) + (low × 1)`, color-coded red/yellow/green~~
- **REQ-163:** ~~The host compliance card MUST async-load and display the human-readable titles of all HIGH severity failing rules; each title MUST be clickable and navigate to View Last Scan; a loading state MUST be shown while the Python script runs~~

### Settings Tab (v3.5 session)

- **REQ-164:** ✅ A Settings tab MUST appear left of Activity providing system-wide module configuration; settings MUST be stored in `/var/lib/cockpit-scap/settings.json` and apply to all Cockpit users on the host
- **REQ-165:** ✅ Settings MUST include configurable scan result retention (1–50 scans, per scan type) and module feature toggles (Enable Container Scanning, Enable Policy Tailoring); disabling a tab MUST hide it immediately and redirect if it is currently active; all controls MUST be admin-gated *(Enable Dashboard toggle removed in v3.9)*

### v3.5 Release (2026-06-01)

- **REQ-166:** ✅ Remediation audit log — Apply Now MUST write a structured log to `/var/lib/cockpit-scap/remediation-logs/` containing timestamp, user, profile, rules applied, exit code, and full bash output; Activity tab MUST show a View Log button linking to a modal log viewer
- **REQ-167:** ✅ All significant events MUST be dispatched to the systemd journal via `logger -t cockpit-scap` with the authenticated username included
- **REQ-168:** ✅ Activity log entries MUST record the authenticated Cockpit username in a `user` field
- **REQ-169:** ~~Dashboard MUST be disabled by default on fresh installs; Settings checkbox defaults to unchecked; existing installs with saved settings are unaffected~~ *(cut in v3.9)*
- **REQ-170:** ✅ `/var/lib/cockpit-scap/remediation-logs/` MUST be created by the RPM install and Makefile with correct SELinux context inherited from the wildcard fcontext rule

---

### v3.6 UX Refinement (shipped 2026-06-02)

- **REQ-171:** ✅ Gate 2 shows structured rule title list; script accessible via collapsible toggle
- **REQ-172:** ✅ Remediation panel groups default to collapsed with counts visible (host + container)
- **REQ-173:** ✅ Download buttons show "✓ Downloaded" for 2s after click (report, XML, bash, ansible)
- **REQ-174:** ✅ Scan progress shows elapsed timer in seconds/minutes (host + container)
- **REQ-175:** ✅ Activity empty state is contextual per active filter chip
- **REQ-176:** ✅ Settings disk usage sums all subdirs; label updated to "Storage used"
- **REQ-177:** ✅ Clear All Data button in Settings — admin-gated, confirmation modal, journal entry
- **REQ-178:** ✅ View Guide popup shows loading message immediately on all three tabs

---

### v3.7 Action Board & Intelligent Remediation (designed 2026-06-02)

> **Design goal:** shift from process-oriented to outcome-oriented. Scan results must immediately answer: what are my highest-risk failures, which ones have automated fixes, and how do I apply them right now — all within the native Cockpit aesthetic.

- **REQ-179:** ✅ The results card MUST include an Action Board section showing CRITICAL / HIGH / MEDIUM failure counts immediately from manifest data (no async required), with automatable count filled in progressively once `PY_EXTRACT_FAILING_RULES` completes

- **REQ-180:** ✅ The Action Board MUST include a "Quick Fix" button that opens the remediation panel with only automatable CRITICAL+HIGH rules pre-selected, sorted by XCCDF rule weight descending; when zero such rules exist the button MUST be hidden and replaced with "No automated fixes available for critical/high failures"

- **REQ-181:** ✅ `PY_EXTRACT_FAILING_RULES` MUST extract the XCCDF `weight` attribute for each failing rule; weight MUST be included in the returned JSON and used to sort the recommended rule set

- **REQ-182:** ✅ ~~Recommended Fixes section inside panel~~ — superseded. Automatable critical/high rules are surfaced via Action Board Quick Fix (drawer) + Dashboard Priority Fixes, which is cleaner. In-panel Recommended section was removed after UAT found it confusing with duplicate buttons. The intent is fully met. above the severity groups showing the automatable CRITICAL+HIGH rule count with its own Download Bash, Download Ansible, and Apply Now buttons (host only) that act on that subset regardless of checkbox state; container panel shows Download Bash/Ansible only

- **REQ-183:** ✅ The scan history table Score column MUST show an inline delta vs the previous same-profile scan — `↑ +7%` (green) or `↓ -3%` (red) — computed at render time from in-memory manifests; no new column required

- **REQ-184:** ✅ A shared `buildRemPanelDOM(container, rules)` function MUST be extracted from the near-identical `renderRemediationRules()` and `renderCsRemRules()` implementations before adding the Recommended section — this extraction is a prerequisite for REQ-182

- **REQ-185:** ✅ ~~Settings tab MUST include a "Manual Scheduling" section~~ — **corrected:** a "View oscap command" collapsible disclosure on the Host Scan tab shows the `oscap xccdf eval` command built from the current UI selections (content file + profile + optional tailoring), with a Copy button. This is a reference aid, not a cron-paste path — results dropped manually without a companion `manifest.json` do not appear in scan history. "Manual Scheduling" framing was removed from the README as misleading; scheduled scanning remains deliberately deferred (see DESIGN.md).

- **REQ-186:** ✅ All v3.7 UI additions MUST use PatternFly v6 tokens exclusively — no hardcoded hex values, no custom colors outside `--ct-` custom property definitions; Cockpit native aesthetic is a hard requirement; dark mode MUST work on all new elements without additional effort (token-only colors guarantee this automatically)

- **REQ-187:** ✅ Every scan MUST generate an ARF (Asset Reporting Format) file via `--results-arf` and expose a "Download ARF" option in the export dropdown; the button MUST be disabled with a descriptive tooltip for pre-v3.8 scans that have no ARF file

- **REQ-188:** ✅ The result badges MUST distinguish `notapplicable` from `notchecked` — Not applicable MUST be shown as a visually distinct outlined badge and appear only when count > 0; both host and container scan results apply

- **REQ-189:** ✅ The Content Library in Settings MUST show the SSG benchmark version extracted from the SDS file (`xccdf:version`) rather than the file modification date; system and uploaded content both show version; extraction uses iterparse with early break for performance on large files

- **REQ-190:** ✅ The results card export controls MUST be a split button — default action downloads the HTML report; a dropdown toggle reveals "Download HTML (default)", "Download Results XML", and "Download ARF"; applies to both host and container scan

- **REQ-191:** ✅ The action board MUST include a "Open Remediation Builder:" label before the buttons to disambiguate from immediate-apply actions; buttons MUST be labelled "Critical Rules (N)" and "All Failures (N)" where N is the respective count — no immediate changes are made until the user confirms inside the drawer

- **REQ-192:** ✅ Profile remediation buttons MUST be labelled "Profile Remediation (Bash)" and "Profile Remediation (Ansible)" on all three tabs to communicate that the action is a download, not an immediate apply

- **REQ-193:** ✅ Container Scan and Dashboard tabs MUST default to disabled on a fresh install (no settings.json); users opt in via Settings; existing installs that already have settings.json are unaffected

- **REQ-194:** ✅ The Settings page two-column grid MUST collapse to a single column below 900px viewport width via CSS media query

### Feature Toggles (v3.9.2)

- **REQ-195:** ✅ The Module Features section in Settings MUST include an "Enable Host Scanning" toggle; when disabled the Host Scan tab MUST be hidden entirely; if the Host Scan tab was active when the toggle is disabled the module MUST redirect to the Settings tab; checkbox order MUST be: Host Scanning, Container Scanning, Policy Tailoring, In-Place Remediation

- **REQ-196:** ✅ The Module Features section in Settings MUST include an "Enable In-Place Remediation" toggle; when disabled the Apply Now button in the Selective Remediation panel MUST be permanently disabled regardless of rule selection state or admin privilege; build-and-download (Bash and Ansible) is unaffected

- **REQ-197:** ✅ All four feature toggles MUST default to enabled on a fresh install (no settings.json); Container Scan remains the only tab disabled by default (REQ-193 unchanged)

- **REQ-198:** ✅ Settings load MUST NOT use `superuser: 'try'` — `/var/lib/cockpit-scap/settings.json` is written as `644` (world-readable) and MUST be read unprivileged; using `superuser: 'try'` on hardened hosts caused a race condition where the privilege channel was not ready at page load, silently failing the read and leaving all values at defaults

---

## v3.10 Requirements (Code Quality & CSP Hardening)

### JS File Split

- **REQ-199:** ✅ `index.js` MUST be refactored into separate files per functional area: `settings.js`, `tailoring.js`, `remediation.js`, `host-scan.js`; `container-scan.js` remains unchanged; `index.js` retains constants, globals, shared utilities, content/profile loading, activity log tab, and `DOMContentLoaded` wiring
- **REQ-200:** ✅ All JS files MUST use classic `<script defer>` loading in `index.html` — no ES modules; all top-level declarations share one browser global scope; load order is enforced by tag order

### CSP Hardening

- **REQ-201:** ✅ `manifest.json` `content-security-policy` MUST NOT include `'unsafe-inline'` in `script-src` — all scripts must be external files loaded via `src=`
- **REQ-202:** ✅ `viewer.html`'s inline `<script>` MUST be extracted to `viewer.js`; its inline `<style>` MUST be extracted to `viewer.css`; both files MUST be included in `MODULE_FILES` (Makefile) and the `%install` section of the spec file

### ESLint

- **REQ-203:** ✅ An `eslint.config.js` MUST exist at the project root; `eslint src/**/*.js` MUST complete with 0 errors and 0 warnings

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
