# cockpit-scap

A native [Cockpit](https://cockpit-project.org/) module for RHEL 10 / CentOS Stream 10 that brings OpenSCAP compliance
scanning, container image scanning, profile tailoring, and selective remediation directly into the
browser console that RHEL administrators already use — no separate tools, no desktop application,
no context switching.

## Why this exists

Cockpit is the centralized web-based administration console for RHEL — the single interface where
administrators manage storage, networking, containers, services, and more without leaving their
browser. cockpit-scap extends that model to compliance. OpenSCAP and the SCAP Security Guide are
powerful, well-supported tools that ship with RHEL — cockpit-scap gives them a native home in a
console administrators already use, with the same look, feel, and security model as everything else
in Cockpit.

## Features

- **Failing rules summary** — collapsible HIGH/MEDIUM/LOW groups; each rule shows title, CCE identifier, Automated/Manual remediation annotation, and expandable description and rationale inline
- **Regression and improvement detection** — banner fires when failure count changes vs the previous scan of the same profile; "See what changed" diffs the two result sets showing exactly which rules were Fixed, Regressed, or are New failures
- **Selective Remediation Builder** — after any scan, search and select individual failing rules; expand inline description and rationale per rule; download filtered bash or Ansible scripts; or **Apply Now** directly on the host with two-gate danger confirmation and live streaming output; host-only, admin-gated
- **Profile tailoring** — rule tree editor with enable/disable, variable value adjustment, search, and expand/collapse; saves valid XCCDF tailoring XML with full upload/download/edit/delete; edit files in place or save as a new copy; tailoring files are selectable at scan time and respected by remediation artifacts
- **Container image scanning** — scan images via `oscap-podman`; enumerates from the root Podman store; per-image scan history; selective remediation download for use in image build pipelines
- **Scan history** — configurable retention per scan type; **View Scan** loads any historical result into the full results card; Run Again pre-fills from any history entry; Export CSV
- **Content Library** — upload SDS files directly via browser; RHEL 6–10 SDS supported; host scan silently filters to version-compatible content only; validate with `oscap ds sds-validate`; SCP staging to `/var/lib/cockpit-scap/content/` also supported
- **Report and results export** — full oscap HTML report opens in a new tab; raw XCCDF results.xml download for auditor archives
- **View Compliance Guide** — generate and view the full oscap security guide for the selected profile on any scan tab
- **Compliance Dashboard** *(preview)* — host compliance hero card with score, weighted risk score (high×10 + med×3 + low×1), severity breakdown, and live-loaded HIGH severity failure names clickable to scan results; compact per-image container cards below
- **Activity log** — timestamped record of all user actions; filterable by type; exportable as CSV
- **Settings tab** — configure scan result retention per scan type; enable/disable Container Scan and Dashboard tabs; system-wide, admin-gated, audit-logged
- **Admin gate** — Run Scan, Apply Now, upload, and delete are visually disabled with tooltip in limited Cockpit sessions; no error popup after the fact

## Screenshots

**Policy Tailoring — rule tree editor with severity indicators, search, and variable editor**
![Tailoring Editor](docs/screenshots/tailoring.png)

**Scan Results — compliance score, regression detection, failing rules with CCE identifiers and inline description**
![Scan Results](docs/screenshots/scan-results.png)

**Apply Now — select failing rules, review the script, apply directly on the host with live streaming output**
![Apply Now](docs/screenshots/selective-remediations.png)

**Host Scan — unified configuration card with profile description and scan history**
![Host Scan](docs/screenshots/host-scan.png)

## Requirements

### Cockpit
Cockpit 344 or later on RHEL 10 / CentOS Stream 10. The module uses no Cockpit internals beyond the published
`cockpit.js` API.

### Packages
Install the following on the target host before using the module:

```
dnf install openscap-scanner scap-security-guide openscap-utils
```

| Package | Purpose |
|---|---|
| `openscap-scanner` | Provides the `oscap` binary |
| `scap-security-guide` | Provides SSG data stream files |
| `openscap-utils` | Provides `oscap xccdf generate fix` utilities |

The module detects missing packages at startup and displays installation instructions rather than
failing silently.

## Installation

**RPM via Fedora COPR (recommended):**

```bash
sudo dnf copr enable pbuchan-rh/cockpit-scap
sudo dnf install cockpit-scap
```

**From source (Makefile):**

```bash
git clone https://github.com/pbuchan-rh/cockpit-scap.git
cd cockpit-scap
sudo make install
```

The Makefile creates `/var/lib/cockpit-scap/{results,tailoring,content}/`, installs module files to
`/usr/share/cockpit/cockpit-scap/`, and configures the SELinux file context automatically.

Reload Cockpit and navigate to **SCAP Compliance** in the sidebar.

## Usage

### Scan tab

1. Select a content file (auto-detected from the SSG directory)
2. Select a profile — the profile description is displayed to the right
3. Optionally select a saved tailoring file to customize the profile
4. Click **Run Scan** (requires administrative access)
5. When complete, review the compliance score, failing rules summary, and regression/improvement detection
6. Click **Remediate** to open the Selective Remediation Builder — search and select failing rules, expand each rule to review its description and rationale, then download a filtered bash or Ansible script or click **Apply Now** to remediate directly on the host
7. All completed scans appear in the Scan History table; **View Scan** reloads any historical result

### Policy Tailoring tab

1. Select content and a base profile, give the tailored profile a name, click **Load Profile**
2. Enable or disable individual rules using the checkbox tree; use search and expand/collapse to
   navigate large profiles
3. Adjust variable values in the Variables section if needed
4. Click **Save Tailoring File** — the tailoring file is saved to `/var/lib/cockpit-scap/tailoring/`
   and becomes available in the Scan tab's Tailoring File selector
5. Use **Upload** to import an existing XCCDF tailoring file; **Download** to export one;
   **Edit** to reopen a saved file for modification; **Delete** to remove it
6. When editing an existing file, click **Update** to overwrite it in place, or **Save as New** to
   create a timestamped copy. Rename the profile using the inline name field in the editor header.

### Settings tab

- **Scan result retention** — set how many completed scans to keep per scan type (host and container independently); older results are removed automatically after each scan when the limit is reached
- **Module features** — disable the Container Scan or Dashboard tabs for environments where they are not relevant; takes effect immediately and applies to all Cockpit users on the host
- All settings changes are logged to the Activity log; all controls require administrative access

## Storage

All runtime data is written to `/var/lib/cockpit-scap/`:

```
/var/lib/cockpit-scap/
├── results/
│   └── <TIMESTAMP>/          # One directory per scan
│       ├── manifest.json     # Profile, SDS, counts, score
│       ├── report.html       # oscap HTML report
│       ├── results.xml       # oscap XML results
│       ├── remediation.sh    # Bash remediation script
│       └── remediation.yml   # Ansible remediation playbook
├── tailoring/
│   ├── <name>-<timestamp>.xml   # XCCDF tailoring file
│   └── <name>-<timestamp>.json  # Sidecar metadata
├── content/
│   └── ssg-rhel<N>-ds.xml    # User-staged SDS files (root:root ownership required)
└── remediation-logs/
    └── <TIMESTAMP>-<profile>.log  # Apply Now audit log (user, rules applied, exit code)
```

Scan history is pruned automatically after each scan. Retention defaults to 10 results per scan type and is configurable via the Settings tab (1–50).

## SELinux

The module is tested and confirmed working with SELinux in enforcing mode. All file I/O is scoped to
`/var/lib/cockpit-scap/` which carries the `cockpit_var_lib_t` context. The SELinux file context
definition (`selinux/cockpit-scap.fc`) is shipped with the module and applied automatically at
install time via `semanage fcontext` and `restorecon` — no manual SELinux steps are required.

## Privilege model

Cockpit's native `{ superuser: "require" }` mechanism is used, scoped to scan execution, file
writes, and remediation apply only. Browsing content, selecting profiles, viewing history, and
generating compliance guides require no elevation.

Privileged actions (Run Scan, Apply Now, upload, delete) are visually disabled with a tooltip in
limited Cockpit sessions — no error popup after the fact. Elevation is requested once via the
standard Cockpit prompt and applies for the session.

No polkit action file, sudoers entry, or setuid binary is required.

## What this module does not do

- Remote scanning via SSH (`oscap-ssh`) — explicitly out of scope
- OVAL vulnerability scanning — not in scope

## Development status

**Current version:** v3.5

Built with vanilla JavaScript, PatternFly 6, and the Cockpit JS API. No npm, no build toolchain,
no external CDN dependencies. Suitable for deployment on air-gapped systems.

### Roadmap

| Version | Theme |
|---|---|
| **v1** | Local SCAP scanning + full profile tailoring — closes the SCAP Workbench gap on RHEL 10 |
| **v2** | Multi-version SDS content management — RHEL 6–9 SDS staging, CPE OS detection, Content tab |
| **v3** | Container image scanning — `oscap-podman`, root Podman store, version mismatch detection, per-image history |
| **v3.3** | Selective Remediation Builder, Results XML download, Activity log, Compliance Dashboard (preview), Tailoring Update-in-place |
| **v3.4** | Failing rules summary with CCE + Automated/Manual + inline description, regression/improvement detection, scan diff, View Scan from history, unified scan config card, SDS upload, admin gate, dashboard overhaul |
| **v3.5** *(current)* | Apply Now direct remediation with two-gate confirmation, live output, and full audit trail; Settings tab; admin gate hardening; activity log user field; container scan limited access parity |
