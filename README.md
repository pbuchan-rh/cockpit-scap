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
- **Profile selection** with full profile description display
- **Scan execution** via `oscap xccdf eval` with cancel support
- **Results summary** — pass, fail, error, and not-checked counts with compliance score
- **Full HTML report** viewer (opens in new tab)
- **Remediation download** — bash script and Ansible playbook generated per scan
- **Scan history** — last 10 scans retained with per-entry report and remediation access, with delete
- **Profile tailoring** — rule tree editor with enable/disable, variable value adjustment, search,
  expand/collapse; saves valid XCCDF tailoring XML; upload/download/edit/delete saved files
- **Tailored scans** — select a saved tailoring file at scan time; remediation artifacts respect the tailoring

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

> **Note:** A Makefile and RPM spec are planned. Until then, install manually.

**1. Create the runtime directory:**

```bash
sudo mkdir -p /var/lib/cockpit-scap/results
sudo mkdir -p /var/lib/cockpit-scap/tailoring
sudo chown -R root:root /var/lib/cockpit-scap
sudo chmod 755 /var/lib/cockpit-scap
```

**2. Install the module files:**

```bash
sudo mkdir -p /usr/share/cockpit/cockpit-scap
sudo cp index.html index.js style.css manifest.json viewer.html \
    /usr/share/cockpit/cockpit-scap/
```

**3. Reload Cockpit and navigate to SCAP Compliance in the sidebar.**

No firewall changes are required. The module operates entirely over Cockpit's existing `9090/tcp`.

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
└── tailoring/
    ├── <name>-<timestamp>.xml   # XCCDF tailoring file
    └── <name>-<timestamp>.json  # Sidecar metadata
```

Scan history is pruned automatically to the 10 most recent entries.

## SELinux

The module is tested with SELinux in enforcing mode. All file I/O is scoped to
`/var/lib/cockpit-scap/` which carries the appropriate file context. A formal SELinux file context
definition (`.fc`) and install-time `restorecon` are planned deliverables before community release.

## Privilege model

Cockpit's native `{ superuser: "require" }` mechanism is used, scoped to scan execution and file
writes only. Browsing content, selecting profiles, and viewing history require no elevation.
The standard Cockpit administrative access prompt fires at the moment the user clicks Run Scan.

No polkit action file, sudoers entry, or setuid binary is required.

## What this module does not do

- Remote scanning via SSH (`oscap-ssh`) — explicitly out of scope
- Container/image scanning (`oscap-podman`) — out of scope; OS profile mismatch makes results
  unreliable across RHEL 8/9/10 images
- OVAL vulnerability scanning — not in scope
- One-click in-place remediation apply — deferred; stub button present in the UI
- Ansible remediation apply — deferred
- Arbitrary SDS/XCCDF file upload — deferred

## Development status

**Current version:** v1.0

Built with vanilla JavaScript, PatternFly 6, and the Cockpit JS API. No npm, no build toolchain,
no external CDN dependencies. Suitable for deployment on air-gapped systems.

SELinux `.fc` deliverable and Makefile install target are complete. RPM spec planned before community release.

### Roadmap

| Version | Theme |
|---|---|
| **v1** *(current)* | Local SCAP scanning + full profile tailoring — closes the SCAP Workbench gap on RHEL 10 |
| **v2** | Multi-version SDS content — tailor RHEL 7/8/9 profiles from a RHEL 10 host, CPE-aware scan blocking |
| **v3** | Container image scanning — `oscap-podman` integration with correct cross-version content |
