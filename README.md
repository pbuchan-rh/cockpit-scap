# cockpit-scap

A native [Cockpit](https://cockpit-project.org/) module for RHEL 10 / CentOS Stream 10 that brings OpenSCAP compliance scanning, container image scanning, profile tailoring, and selective remediation directly into the Cockpit browser console — no separate tools, no context switching.

## Features

- **Host scanning** — auto-detects installed SSG data streams across RHEL 6–10; compliance score, severity breakdown, regression detection, and scan ETA during the run
- **Container image scanning** — scan images from the root Podman store via `oscap-podman`; per-image history, severity action bar, and remediation scripts for build pipelines
- **Failing rules** — collapsible HIGH/MEDIUM/LOW groups with CCE identifiers, inline description and rationale, and Automated/Manual annotation; search by title or CCE
- **Selective remediation** — pick individual failing rules and download a filtered bash, Ansible, or Puppet script; **Apply Now** remediates directly on the host with two-gate confirmation and live output; **Quick Fix** pre-selects automatable critical/high rules
- **Full profile remediation** — generate a remediation script for an entire profile without running a scan first; available on Host Scan, Container Scan, and Tailoring tabs
- **Saved policies** — store a tailoring file + compliance threshold as a named policy; threshold drives score color coding in results and history; framework reference chips (NIST, PCI-DSS, DISA, CIS) derived from profile
- **Policy tailoring** — XCCDF rule tree editor with variable adjustment and search; upload, download, edit, and delete saved tailoring files
- **Scan history** — every result stored with score delta vs previous same-profile scan; reload any historical result or open it in the remediation drawer; configurable retention
- **Activity log** — structured audit trail of all privileged actions (scans, remediation, tailoring, content operations); filter by type; each entry records the authenticated user; integrates with the systemd journal
- **Export** — HTML report, XCCDF results XML, and ARF bundle per scan; compliance guide for any profile; history as CSV
- **Settings** — tab visibility, scan retention, Clear All Data, Content Library (system + uploaded SDS files)

## Screenshots

**Host Scan**
![Host Scan](docs/screenshots/host-scan-tab.png)

**Scan Results**
![Scan Results](docs/screenshots/host-scan-results.png)

**Selective Remediation**
![Selective Remediation](docs/screenshots/remediation-builder-selections.png)

**Policy Tailoring**
![Policy Tailoring](docs/screenshots/policy-editor1.png)

**Activity Log**
![Activity Log](docs/screenshots/activity-tab.png)

[View all screenshots](docs/screenshots/)

## Requirements

### Cockpit
Cockpit 344 or later on RHEL 10 / CentOS Stream 10. The module uses no Cockpit internals beyond the published
`cockpit.js` API.

### Packages

```
dnf install openscap-scanner scap-security-guide openscap-utils
```

| Package | Purpose |
|---|---|
| `openscap-scanner` | Host and container scanning (`oscap`, `oscap-podman`) |
| `scap-security-guide` | SSG data stream files for RHEL 6–10 |
| `openscap-utils` | Remediation script generation (`oscap xccdf generate fix`) |

The module detects missing packages at startup and displays installation instructions rather than failing silently.

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

After installation, reload Cockpit and navigate to **SCAP Compliance** in the sidebar.

## Tips

- **Remediate from history** — clicking **Remediate** in the Scan History table loads the historical result and opens the remediation drawer directly; no need to re-run the scan
- **Tailoring files** — files saved in the Policy Tailoring tab appear automatically in the Scan tab's Tailoring File selector
- **Update vs Save as New** — when editing an existing tailoring file, **Update** overwrites it in place; **Save as New** creates a timestamped copy
- **Manual Scheduling** — the Settings tab shows the exact `oscap xccdf eval` command from your most recent scan, ready to paste into a cron job

## Storage

All runtime data is written to `/var/lib/cockpit-scap/`:

```
/var/lib/cockpit-scap/
├── results/
│   └── <TIMESTAMP>/          # One directory per scan
│       ├── manifest.json     # Scan metadata (profile, SDS, score, timing, compliance threshold)
│       ├── results.arf.gz    # Compressed ARF bundle (~2 MB)
│       ├── results.xml       # oscap XML results (~15 MB; used for report gen + remediation)
│       ├── remediation.sh    # Bash remediation script
│       └── remediation.yml   # Ansible remediation playbook
├── tailoring/
│   ├── <name>-<timestamp>.xml   # XCCDF tailoring file
│   └── <name>-<timestamp>.json  # Sidecar metadata (profile, threshold, notes)
├── content/
│   └── ssg-rhel<N>-ds.xml    # User-staged SDS files (root:root ownership required)
└── remediation-logs/
    └── <TIMESTAMP>-<profile>.log  # Apply Now audit log (user, rules applied, exit code)
```

HTML reports are generated on demand when **View Report** or **Download Report** is clicked — they are not stored on disk. Each scan uses approximately 18 MB on disk. Retention defaults to 5 results per scan type (~180 MB total at default) and is configurable via the Settings tab.

Scan history is pruned automatically after each scan.

## SELinux

The module is tested and confirmed working with SELinux in enforcing mode. All file I/O is scoped to `/var/lib/cockpit-scap/` — the SELinux file context definition is shipped with the module and applied automatically at install time via `semanage fcontext` and `restorecon`. No manual SELinux configuration required.

## Privilege model

Cockpit's native `{ superuser: "require" }` mechanism is used, scoped to scan execution, file writes, and remediation apply only. Browsing content, selecting profiles, viewing history, and generating compliance guides require no elevation. No polkit action file, sudoers entry, or setuid binary is required.

Privileged actions (Run Scan, Apply Now, upload, delete) are visually disabled with a tooltip in limited Cockpit sessions — no error popup after the fact. Elevation is requested once via the standard Cockpit prompt and applies for the session.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for known issues on CIS-hardened hosts (masked service, `use_pty`, sudoers entries wiped after remediation).

## Development status

**Current release:** v3.9.1 — available via COPR

Built with vanilla JavaScript, PatternFly 6, and the Cockpit JS API. No npm, no build toolchain,
no external CDN dependencies. Suitable for deployment on air-gapped systems.

### Roadmap

| Version | Theme |
|---|---|
| **v1** | Local SCAP scanning + full profile tailoring — closes the SCAP Workbench gap on RHEL 10 |
| **v2** | Multi-version SDS content management — RHEL 6–9 SDS staging, CPE OS detection |
| **v3** | Container image scanning — `oscap-podman`, root Podman store, per-image history |
| **v3.x** *(current)* | Selective remediation, saved policies, compliance thresholds, full audit trail, CIS L2 hardening compatibility, container scan parity |
