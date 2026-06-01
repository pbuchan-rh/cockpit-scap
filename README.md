# cockpit-scap

A native [Cockpit](https://cockpit-project.org/) module for RHEL 10 that brings OpenSCAP compliance
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

- **Auto-detection** of installed SSG data stream files from `/usr/share/xml/scap/ssg/content/`
- **Multi-version content** — stage RHEL 6–9 SDS files in `/var/lib/cockpit-scap/content/` and scan
  with the correct content for any RHEL version; system and user content shown in grouped selector
- **CPE compatibility check** — cross-version content is detected automatically; scan is blocked with
  an inline explanation; tailoring remains available for cross-version profile work
- **Profile selection** with full profile description display
- **Scan execution** via `oscap xccdf eval` with cancel support
- **Results card** — compliance score with pass/fail/error counts and scan timestamp
- **Failing rules summary** — collapsible HIGH/MEDIUM/LOW groups; each rule shows title, CCE identifier, Automated/Manual remediation annotation, and expandable description and rationale inline
- **Regression and improvement detection** — banner fires automatically when failure count changes vs the previous scan of the same profile; "See what changed" diffs the two scans showing exactly which rules were Fixed, Regressed, or are New failures
- **Full HTML report** viewer (opens in new tab)
- **Results XML download** — download the raw XCCDF results.xml from any scan for auditor archives
- **Selective Remediation Builder** — after any scan, choose individual failing rules before
  downloading bash or Ansible remediation scripts; rules grouped HIGH/MEDIUM/LOW with per-group
  and global select/deselect; available for both host and container scans
- **Scan history** — last 10 scans retained; **View Scan** loads any historical scan into the full results card; Run Again pre-fills the scan form from any history entry; Export CSV
- **Profile tailoring** — rule tree editor with enable/disable, variable value adjustment, search,
  expand/collapse; saves valid XCCDF tailoring XML; upload/download/edit/delete saved files
- **Tailoring Update-in-place** — edit an existing tailoring file and overwrite it directly, or save
  as a new timestamped copy; rename the profile inline in the editor header
- **Tailored scans** — select a saved tailoring file at scan time; remediation artifacts respect the tailoring
- **Container image scanning** — scan container images via `oscap-podman`; image enumeration from root Podman store; version mismatch detection; per-image scan history
- **View Guide** — generate and view the full oscap security guide for any profile, on all three scan tabs
- **Run Again** — re-run any historical scan with one click; pre-fills content, profile, and tailoring file
- **Export CSV** — download the full scan history as a CSV file with all metadata fields
- **Content Library tab** — upload SDS files directly via browser (up to 30+ MB confirmed); overwrite
  confirmation shows existing file size and date; per-entry size, modified date, validate, and delete;
  SCP staging also supported
- **Content validation** — validate uploaded SDS files with `oscap ds sds-validate` before scanning
- **Activity log** — real-time log of all user actions with semantic color coding; filterable by type;
  exportable as CSV; capped at 1000 entries
- **Compliance Dashboard** *(preview)* — per-profile compliance cards with score sparkline (trend over
  time), staleness badges, regression/attention banner, Quick Scan (one-click re-run from dashboard),
  and View Last Scan navigation
- **Admin gate** — upload and delete operations disabled for non-admin Cockpit sessions; clear visual
  feedback via disabled state and tooltip; scan execution remains the natural privilege boundary

## Screenshots

**Policy Tailoring — rule tree editor with severity indicators, search, and variable editor**
![Tailoring Editor](docs/screenshots/tailoring.png)

**Scan Results — compliance score, regression detection, failing rules with CCE identifiers and inline description**
![Scan Results](docs/screenshots/scan-results.png)

**Selective Remediation Builder — cherry-pick failing rules before downloading targeted bash or Ansible scripts**
![Selective Remediation](docs/screenshots/selective-remediations.png)

**Host Scan — unified configuration card with profile description and scan history**
![Host Scan](docs/screenshots/host-scan.png)

## Requirements

### Cockpit
Cockpit 344 or later on RHEL 10. The module uses no Cockpit internals beyond the published
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
4. Click **Run Scan**
5. When complete, view the full report, download remediation artifacts, or run another scan
6. All completed scans appear in the Scan History table below

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
└── content/
    └── ssg-rhel<N>-ds.xml    # User-staged SDS files (root:root ownership required)
```

Scan history is pruned automatically to the 10 most recent entries.

## SELinux

The module is tested and confirmed working with SELinux in enforcing mode. All file I/O is scoped to
`/var/lib/cockpit-scap/` which carries the `cockpit_var_lib_t` context. The SELinux file context
definition (`selinux/cockpit-scap.fc`) is shipped with the module and applied automatically at
install time via `semanage fcontext` and `restorecon` — no manual SELinux steps are required.

## Privilege model

Cockpit's native `{ superuser: "require" }` mechanism is used, scoped to scan execution and file
writes only. Browsing content, selecting profiles, and viewing history require no elevation.
The standard Cockpit administrative access prompt fires at the moment the user clicks Run Scan.

No polkit action file, sudoers entry, or setuid binary is required.

## What this module does not do

- Remote scanning via SSH (`oscap-ssh`) — explicitly out of scope
- OVAL vulnerability scanning — not in scope
- One-click in-place remediation apply — deferred; use Selective Remediation Builder to download targeted scripts
- Arbitrary SDS/XCCDF file upload — stage files via SCP to `/var/lib/cockpit-scap/content/`

## Development status

**Current version:** v3.4-dev

Built with vanilla JavaScript, PatternFly 6, and the Cockpit JS API. No npm, no build toolchain,
no external CDN dependencies. Suitable for deployment on air-gapped systems.

### Roadmap

| Version | Theme |
|---|---|
| **v1** | Local SCAP scanning + full profile tailoring — closes the SCAP Workbench gap on RHEL 10 |
| **v2** | Multi-version SDS content management — RHEL 6–9 SDS staging, CPE OS detection, Content tab |
| **v3** | Container image scanning — `oscap-podman`, root Podman store, version mismatch detection, per-image history |
| **v3.3** | Selective Remediation Builder, Results XML download, Activity log, Compliance Dashboard (preview), Tailoring Update-in-place |
| **v3.4** *(current dev)* | Failing rules summary with CCE + Automated/Manual + inline description, regression/improvement detection, scan diff, View Scan from history, unified scan config card, SDS upload, admin gate, dashboard overhaul |
