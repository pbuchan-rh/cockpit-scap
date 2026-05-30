# cockpit-scap

A native [Cockpit](https://cockpit-project.org/) module for RHEL 10 that provides SCAP compliance
scanning, results reporting, remediation download, scan history, and full profile tailoring — all
from the browser UI that RHEL administrators already use.

## Why this exists

SCAP Workbench was archived in September 2024 and is absent from RHEL 10 documentation entirely.
No replacement exists in the Cockpit ecosystem. cockpit-scap fills that gap with a tool built to
Cockpit's own UI and security standards, targeting security-focused RHEL administrators who need
compliance scanning without leaving their management console.

## Features

- **Auto-detection** of installed SSG data stream files from `/usr/share/xml/scap/ssg/content/`
- **Multi-version content** — stage RHEL 6–9 SDS files in `/var/lib/cockpit-scap/content/` and scan
  with the correct content for any RHEL version; system and user content shown in grouped selector
- **CPE compatibility check** — cross-version content is detected automatically; scan is blocked with
  an inline explanation; tailoring remains available for cross-version profile work
- **Profile selection** with full profile description display
- **Scan execution** via `oscap xccdf eval` with cancel support
- **Results summary** — pass, fail, error, and not-checked counts with compliance score
- **Full HTML report** viewer (opens in new tab)
- **Remediation download** — bash script and Ansible playbook generated per scan
- **Scan history** — last 10 scans retained with per-entry report and remediation access, with delete
- **Profile tailoring** — rule tree editor with enable/disable, variable value adjustment, search,
  expand/collapse; saves valid XCCDF tailoring XML; upload/download/edit/delete saved files
- **Tailored scans** — select a saved tailoring file at scan time; remediation artifacts respect the tailoring
- **Content tab** — manage user-staged SDS files with per-entry delete and SCP staging instructions
- **Dark mode** — full support for `prefers-color-scheme: dark` and Cockpit's own dark theme toggle; all colors matched to PatternFly 6's dark token chain

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

### Tailoring tab

1. Select content and a base profile, give the tailored profile a name, click **Load Profile**
2. Enable or disable individual rules using the checkbox tree; use search and expand/collapse to
   navigate large profiles
3. Adjust variable values in the Variables section if needed
4. Click **Save Tailoring File** — the tailoring file is saved to `/var/lib/cockpit-scap/tailoring/`
   and becomes available in the Scan tab's Tailoring File selector
5. Use **Upload** to import an existing XCCDF tailoring file; **Download** to export one;
   **Edit** to reopen a saved file for modification; **Delete** to remove it

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
- Container/image scanning (`oscap-podman`) — deferred to v3; requires Podman, image enumeration,
  and OS detection from image metadata — enough new surface to warrant its own milestone
- OVAL vulnerability scanning — not in scope
- One-click in-place remediation apply — deferred; stub button present in the UI
- Ansible remediation apply — deferred
- Arbitrary SDS/XCCDF file upload — deferred

## Development status

**Current version:** v2.1

Built with vanilla JavaScript, PatternFly 6, and the Cockpit JS API. No npm, no build toolchain,
no external CDN dependencies. Suitable for deployment on air-gapped systems.

### Roadmap

| Version | Theme |
|---|---|
| **v1** | Local SCAP scanning + full profile tailoring — closes the SCAP Workbench gap on RHEL 10 |
| **v2** *(current)* | Multi-version SDS content management — stage and use RHEL 6–9 content from a RHEL 10 host, CPE-aware scan blocking, Content tab |
| **v3** | Container image scanning — `oscap-podman` integration with correct cross-version content |
