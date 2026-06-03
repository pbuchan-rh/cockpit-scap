# cockpit-scap

A native [Cockpit](https://cockpit-project.org/) module for RHEL 10 / CentOS Stream 10 that brings OpenSCAP compliance
scanning, container image scanning, profile tailoring, and selective remediation directly into the
browser console that RHEL administrators already use — no separate tools, no desktop application,
no context switching.

## Features

- **Scan results action bar** — severity breakdown (HIGH/MEDIUM/LOW counts) appears immediately on scan complete alongside the compliance score; automatable rule count loads asynchronously; **Quick Fix** opens the remediation panel pre-filtered to automatable critical/high rules; **Review All** opens the full panel
- **Failing rules summary** — collapsible HIGH/MEDIUM/LOW groups with search by rule title or CCE; each rule shows title, CCE identifier, Automated/Manual annotation, and expandable description and rationale inline
- **Regression and improvement detection** — banner fires when failure count changes vs the previous scan of the same profile; "See what changed" shows which rules were fixed, regressed, or are new failures; score delta shown inline in scan history
- **Drawer remediation** — the selective remediation panel slides in from the right; scan results remain visible behind it; close with the Close button, Esc, or clicking outside
- **Selective Remediation Builder** — search and select individual failing rules; download filtered bash or Ansible scripts; or **Apply Now** directly on the host with two-gate confirmation and live streaming output; host-only, admin-gated
- **Profile tailoring** — rule tree editor with enable/disable, variable value adjustment, search, and expand/collapse; saves XCCDF tailoring XML; upload/download/edit/delete; edit files in place or save as a new copy
- **Container image scanning** — scan images via `oscap-podman`; enumerates from the root Podman store; per-image scan history and action bar; selective remediation download for use in image build pipelines
- **Scan history** — configurable retention per scan type; **View Scan** loads any historical result; **Remediate** from history loads the scan and opens the drawer; score delta shown inline; Export CSV
- **Scan timing** — elapsed time shown during active scans; estimated time remaining computed from the most recent matching scan; scan duration and stable scan ID stored in each result manifest
- **Full profile remediation** — generate a bash or Ansible remediation script for the entire selected profile without running a scan first; available on Host Scan, Container Scan, and Policy Tailoring tabs; buttons are disabled until content and profile are selected; on the Tailoring tab the active tailoring file is included if one is loaded in the editor
- **ARF export** — every scan generates an Asset Reporting Format bundle (XCCDF results + OVAL data + asset identity); available alongside HTML and Results XML in the export dropdown
- **Result state breakdown** — five distinct result badges: Pass, Fail, Error, Not applicable (outlined, only shown when > 0), Not checked; separates rules that don't apply to this platform from rules that couldn't be evaluated
- **Content Library versioning** — Settings Content Library shows the SSG benchmark version extracted from each SDS file rather than the file modification date; meaningful across RHEL 6–10 content
- **Dry-run command preview** — the full `oscap xccdf eval` command for the current selection is shown before scanning; Copy to clipboard
- **Content Library** — upload SDS files directly via browser; RHEL 6–10 SDS supported; auto-filters to version-compatible content; validate with `oscap ds sds-validate`
- **Report and results export** — full oscap HTML report opens in a new tab; raw XCCDF results.xml download for auditor archives
- **View Compliance Guide** — generate and view the full oscap security guide for the selected profile on any scan tab
- **Compliance Dashboard** *(preview)* — host compliance hero card with score, score trend chart, severity breakdown, risk score, and unified critical findings with automatable annotations and Quick Fix; rule detail drawer for any listed finding; compact per-image container cards
- **Activity log** — timestamped record of all user actions; filterable by type; exportable as CSV
- **Settings tab** — scan result retention, tab visibility, Clear All Data; Content Library management (system and uploaded SDS); manual scheduling command (cron-paste); all admin-gated and audit-logged
- **Keyboard shortcuts** — `/` focuses the failing rules search; `Q` triggers Quick Fix when results are loaded; `Esc` closes any open drawer

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
2. Select a profile — the profile description is displayed to the right; the full `oscap` command is shown below the form
3. Optionally select a saved tailoring file to customize the profile
4. Click **Run Scan** (requires administrative access); elapsed time and estimated remaining time are shown during the scan
5. When complete, review the compliance score, severity action bar, failing rules summary, and regression/improvement detection
6. Click **Quick Fix** to open the remediation drawer pre-filtered to automatable critical/high rules, or **Review All** to open it with all rules loaded; the drawer slides in from the right while scan results remain visible
7. In the drawer: search and select rules, then download a bash or Ansible script, or click **Apply Now** to remediate directly on the host
8. All completed scans appear in the Scan History table; **View Scan** reloads any result; **Remediate** loads a historical scan and opens the drawer directly

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

- **Scan result retention** — set how many completed scans to keep per scan type; older results are removed automatically after each scan when the limit is reached
- **Module features** — disable the Container Scan or Dashboard tabs for environments where they are not relevant
- **Content Library** — view system-installed SDS files; upload additional SDS files for other RHEL versions; validate or delete uploaded content
- **Manual Scheduling** — the exact `oscap xccdf eval` command for the most recent scan is shown for use in cron jobs; Copy to clipboard
- **Clear All Data** — wipe all scan results, tailoring files, uploaded content, and logs in one admin-gated action

## Storage

All runtime data is written to `/var/lib/cockpit-scap/`:

```
/var/lib/cockpit-scap/
├── results/
│   └── <TIMESTAMP>/          # One directory per scan
│       ├── manifest.json     # Profile, SDS, counts, score, scan_id, scan_duration_s
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

## Development status

**Current release:** v3.8 — available via COPR

Built with vanilla JavaScript, PatternFly 6, and the Cockpit JS API. No npm, no build toolchain,
no external CDN dependencies. Suitable for deployment on air-gapped systems.

### Roadmap

| Version | Theme |
|---|---|
| **v1** | Local SCAP scanning + full profile tailoring — closes the SCAP Workbench gap on RHEL 10 |
| **v2** | Multi-version SDS content management — RHEL 6–9 SDS staging, CPE OS detection |
| **v3** | Container image scanning — `oscap-podman`, root Podman store, per-image history |
| **v3.3** | Selective Remediation Builder, Activity log, Compliance Dashboard (preview) |
| **v3.4** | Failing rules with CCE and inline description, regression detection, scan diff, SDS upload, admin gate |
| **v3.5** | Apply Now with two-gate confirmation and audit trail; Settings tab; container scan parity |
| **v3.6** | UX refinements — scan timer, download feedback, Clear All Data, improved remediation gate |
| **v3.7** | Action Board, score delta in history, dry-run command preview, Content Library in Settings |
| **v3.8** *(current release)* | Drawer remediation, dashboard score trend chart and rule detail, scan ETA, keyboard shortcuts, failing rules search, full profile remediation export, ARF export, Not applicable badge, SSG version in Content Library, export split button, action board UX overhaul |
