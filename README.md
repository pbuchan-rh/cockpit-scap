# cockpit-scap

A native [Cockpit](https://cockpit-project.org/) module that runs an OpenSCAP compliance
scan against the host directly from the Cockpit browser console — no separate tools, no
context switching.

> **Note:** This is an independent community project and is not an official Red Hat product or affiliated with Red Hat, Inc.

> **Branch note:** This describes the `rewrite` branch (v4.0) — a ground-up rewrite as a
> stateless single-page React app. It has not been merged to `main`, packaged as an RPM, or
> published to COPR yet. The currently published release (v3.10.2, via COPR/GitHub) is the
> older, much larger multi-tab module and does not match this description.

## What it does

- **Run a scan** — detects installed SSG data streams under `/usr/share/xml/scap/ssg/content/`,
  pre-selects one based on `/etc/os-release`, and lists profiles for the selected content
  (`oscap info`). A manual content path and an optional tailoring file are also available.
- **Live output** — `oscap xccdf eval` output streams into the page as the scan runs, with a
  Cancel button.
- **Results** — compliance score and pass/fail/error counts, parsed client-side from
  `results.xml` (no server-side parsing). Failing rules are listed with severity, filterable
  by clicking the severity badges.
- **Fix scripts** — select any subset of failing rules and download a Bash or Ansible fix
  script scoped to just those rules (`oscap xccdf generate fix`). Downloads are generated on
  demand; nothing is applied to the host automatically.
- **Full report / raw results** — View Report opens the full `oscap` HTML report in a new
  tab; Results XML and ARF are available as gzip downloads.
- **New Scan** returns to the setup screen and clears all in-memory state.

There is no container scanning, no remediation-apply, no activity log, no content library
management, no settings tab, and no scan history — see [CLAUDE.md](CLAUDE.md)'s Parking Lot
section for what was deliberately cut and why.

## Architecture

Single page, three states that replace each other in place: **Setup → Running → Results**.
No server-side helper process, no files written outside a per-scan temp directory, nothing
persisted between page loads. React 18 + PatternFly v6, built with esbuild — same stack as
`cockpit-bootc` / `cockpit-podman`.

```
src/
├── app.jsx                     # phase state machine + scan lifecycle handlers
├── components/
│   ├── ScanSetup.jsx           # content/profile/tailoring form + Run Scan
│   ├── ScanProgress.jsx        # live output + Cancel
│   └── ScanResults.jsx         # score, severity filter, rule list, downloads
└── lib/
    ├── oscap.js                # all cockpit.spawn() calls to oscap/mktemp/gzip/rm
    └── results.js               # parseResults(xmlText) — DOMParser over results.xml
```

## Requirements

### Cockpit

Cockpit 286 or later (per `src/manifest.json`). No Cockpit internals beyond the published
`cockpit.js` API.

### Packages

```
dnf install openscap-scanner scap-security-guide openscap-utils
```

| Package | Purpose |
|---|---|
| `openscap-scanner` | Host scanning (`oscap`) |
| `scap-security-guide` | SSG data stream files |
| `openscap-utils` | Fix script generation (`oscap xccdf generate fix`) |

The module's `manifest.json` only activates the tool when `/usr/bin/oscap` exists.

## Installation

No RPM or COPR package exists yet for this rewrite. To build and install from source:

```bash
git clone -b rewrite https://github.com/pbuchan-rh/cockpit-scap.git
cd cockpit-scap
npm install
sudo make install
```

After installation, reload Cockpit and navigate to **SCAP Security** in the sidebar.

## Storage

None. All `oscap` output is written to a per-scan temp directory
(`mktemp -d /tmp/cockpit-scap-XXXXXX`, root-owned) and read back into browser memory; the
directory is removed on cancel, on error, and when starting a new scan. Nothing is written
to `/var/lib/`, and no SELinux policy is shipped or needed — everything stays under `/tmp`.

## Privilege model

Cockpit's native `{ superuser: "require" }` mechanism is used, scoped to the operations that
actually need root: creating/removing the temp directory, running the scan, reading the
result files, and generating fix scripts. Detecting content and listing profiles need no
elevation. The setup form is always visible; **Run Scan** is disabled until admin access is
confirmed (`cockpit.permission({ admin: true })`), with an inline alert explaining why.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for known issues on CIS-hardened hosts (masked
service, `use_pty`, sudoers entries wiped after remediation). Note: that document predates
this rewrite — its section on `umask 027` breaking file readability was specific to the old
`/var/lib/cockpit-scap/` storage and no longer applies now that there's no persistent
storage; the service-masking and sudoers (`use_pty`) sections are general CIS-hardening
effects and still apply.

## Development status

**This branch (`rewrite` / v4.0) has not been deployed to a real host as a packaged RPM.**
See [HANDOFF.md](HANDOFF.md) for the current state of that work.

**Last published release:** v3.10.2 (older architecture, via COPR) — see git tag `v3.10.2`
and the `main` branch for that code.
