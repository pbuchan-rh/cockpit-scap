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

- **REQ-51:** The module MUST auto-detect SDS files from both `/usr/share/xml/scap/ssg/content/` (system-managed) and `/var/lib/cockpit-scap/content/` (user-managed) and present them in the SDS selector
- **REQ-52:** The SDS selector MUST visually distinguish system-installed content from user-uploaded content (e.g., grouped by source)
- **REQ-53:** The module MUST provide an upload button that writes an SDS file to `/var/lib/cockpit-scap/content/` via `cockpit.file()` with `{ superuser: "require" }`
- **REQ-54:** The module MUST provide a content management UI listing all files in `/var/lib/cockpit-scap/content/` with per-entry delete (routed through the confirmation modal)
- **REQ-55:** When any SDS is selected, the module MUST detect its CPE target platform by parsing `oscap info` output and comparing against the host OS
- **REQ-56:** When a cross-version SDS is selected (target OS does not match host), the module MUST disable the scan button and display a clear explanation — e.g., "This content targets RHEL 8. Tailoring is available. Scanning is not supported for cross-version content."
- **REQ-57:** Tailoring MUST remain fully available for cross-version content — the tailoring tab operates identically regardless of target OS
- **REQ-58:** The SELinux file context for `/var/lib/cockpit-scap/content/` MUST be defined in `selinux/cockpit-scap.fc` (included in the v1 `.fc` deliverable even though the feature lands in v2)

**Design notes:**
- Admins may stage content by SCP to `/var/lib/cockpit-scap/content/` directly; the upload button is an alternative, not the only path
- SSG data stream files are 35MB+; upload size limits should be validated against the Cockpit file manager as a reference point before implementation
- This feature enables admins to tailor RHEL 7/8/9 profiles on a RHEL 10 management host and download the resulting tailoring files for fleet deployment

---

## Out of Scope — v1

The following are explicitly NOT requirements for v1. Do not implement without formal design discussion:

- Remote SSH scanning (`oscap-ssh`)
- Container / container image scanning (`oscap-podman`) — deferred to v3; original OS mismatch exclusion is superseded by v2 multi-version SDS support (correct content for the image OS will be available), but the feature introduces a second optional system dependency (Podman), image enumeration, and OS detection from image metadata — enough new surface to warrant its own milestone
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
- [ ] All of the above work with SELinux in **enforcing** mode — tested in practice, formal `.fc` deliverable pending
- [x] Module is visually consistent with native Cockpit pages
- [x] No CSP violations in browser console
- [x] No inline styles or inline event handlers anywhere in the codebase
