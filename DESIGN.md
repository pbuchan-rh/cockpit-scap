# cockpit-scap — Design Document

**Status:** v1.0 complete | Roadmap locked through v3  
**Last updated:** 2026-05-29 (v3 container scanning design added)

---

## Project Overview

`cockpit-scap` is a native Cockpit module for RHEL 10 that fills the gap left by the archival of
SCAP Workbench (archived September 2024, last release January 2020). It provides security
compliance scanning, reporting, and profile tailoring for RHEL administrators through a browser-based
interface that is indistinguishable from built-in Cockpit functionality.

**Target audience:** Security-focused RHEL administrators  
**Distribution intent:** Community open source module; built to a standard suitable for Cockpit project contribution  
**RHEL 10 context:** scap-workbench is absent from RHEL 10 documentation entirely — the gap is
real, documented, and unoccupied in the Cockpit ecosystem

---

## Architecture Decisions

### Privilege Model

**Decision:** Use Cockpit's native `cockpit.superuser` mechanism with `{ superuser: "require" }`
scoped to scan execution only.

**Rationale:**
- Cockpit-idiomatic — every official Cockpit module uses this pattern
- Zero additional install artifacts (no polkit action file, no sudoers entry)
- Admin users already understand Cockpit's standard authentication prompt
- A trusted admin performing a compliance scan has already accepted this model

**Boundaries:**
- Browsing content, selecting profiles, viewing history → no elevation required
- Clicking "Run Scan" → elevation prompt fires if not already elevated
- Single escalation point at the moment it makes sense to the user

**Ruled out:**
- Dedicated polkit action — correct but adds install friction for equivalent security outcome
- sudoers `NOPASSWD` entry — inappropriate for a security-focused audience

---

### Navigation Architecture

**Decision:** Two top-level tabs with a guided workflow model.

```
[ Scan ]  [ Tailoring ]
```

**Tab 1 — Scan:**
Content/profile selection, optional tailoring file upload, scan execution, results view, scan history

**Tab 2 — Tailoring:**
v1: visible but clearly stubbed as "coming in a future release" — honest placeholder, not hidden
v2: rule tree editor, enable/disable rules, adjust variable values, save/download tailoring file

**Rationale:**
Reflects the actual admin mental model:
1. Understand first (scan and report)
2. Customize carefully (tailoring)
3. Remediate last and deliberately

The two-tab model communicates this workflow philosophy implicitly. An admin may spend an entire
session in Tailoring building a policy artifact without ever scanning. Or scan repeatedly without
touching Tailoring. These are independent workflows with a shared foundation.

---

### UI Flow — Scan Tab

```
┌─────────────────────────────────────────┐
│  Content (SDS file selector)            │
│  Profile (dropdown + description block) │
│  Tailoring file (upload, optional)      │
│  [ Run Scan ]                           │
├─────────────────────────────────────────┤
│  SCAN RUNNING STATE                     │
│  Progress / status indicator            │
│  [ Cancel Scan ]                        │
├─────────────────────────────────────────┤
│  RESULTS STATE (replaces running state) │
│  Result banner (pass/fail/error counts) │
│  Severity breakdown badges              │
│  Rule results table (expandable rows)   │
│  [ View Full Report ] (new window)      │
│  [ Download Report ]                    │
│  [ Download Bash Remediation ]          │
│  [ Download Ansible Remediation ]       │
│  [ Apply Remediation ] (stubbed, v2)    │
│  [ New Scan ]                           │
├─────────────────────────────────────────┤
│  SCAN HISTORY                           │
│  Table: date | profile | pass/fail |    │
│  links to report + remediation          │
└─────────────────────────────────────────┘
```

---

### Content Loading

**v1:** Auto-detect SSG content from `/usr/share/xml/scap/ssg/content/`
- List all `*-ds.xml` files
- Display human-readable names (parse from `oscap info` output, not raw filenames)
- On RHEL 10 this will typically be `ssg-rhel10-ds.xml`

**v2 (deferred):** Allow arbitrary SDS/XCCDF file upload by the user

---

### Results Display

**HTML Report:** Opens in a new browser window/tab  
**Rationale:** `oscap` generates a beautifully formatted self-contained HTML report. Opening in a
new window costs near-zero implementation effort, avoids CSP iframe complexity, and doesn't try
to reinvent what `oscap` already does well. Download offered alongside.

**Rule results table:** PatternFly compound-expandable table  
- Collapsed: rule title, severity badge, result status
- Expanded: full rule description, fix text
- Filterable by result (pass/fail/error/notchecked) and severity

**Result status color mapping:**
- Pass → PatternFly success green (`--pf-global--success-color--100`)
- Fail → PatternFly danger red (`--pf-global--danger-color--100`)
- Error → PatternFly warning orange (`--pf-global--warning-color--100`)
- Not checked / Not applicable → neutral gray

---

### Scan History Persistence

**Storage path:** `/var/lib/cockpit-scap/results/<TIMESTAMP>/`

**Timestamp format:** `2026-05-28T14-32-00` (ISO 8601, filesystem-safe)

**Per-scan directory contents:**
```
manifest.json     # profile used, SDS path, counts, date, result-id
report.html       # oscap HTML report
results.xml       # oscap XML results (required for remediation generation)
remediation.sh    # bash remediation script
remediation.yml   # ansible remediation playbook
```

**manifest.json schema:**
```json
{
  "timestamp": "2026-05-28T14:32:00Z",
  "sds_file": "/usr/share/xml/scap/ssg/content/ssg-rhel10-ds.xml",
  "profile_id": "xccdf_org.ssgproject.content_profile_cis",
  "profile_title": "CIS Red Hat Enterprise Linux 10 Benchmark for Level 2 - Server",
  "result_id": "xccdf_org.open-scap_testresult_...",
  "counts": {
    "pass": 142,
    "fail": 38,
    "error": 2,
    "notchecked": 12,
    "notapplicable": 5
  },
  "score": 78.9
}
```

---

### Remediation

**v1 — Generate and download only:**
- Bash script: `oscap xccdf generate fix --fix-type bash`
- Ansible playbook: `oscap xccdf generate fix --fix-type ansible`
- Both generated post-scan from `results.xml` + `result-id`
- Both offered as downloads from results view and history

**v2 (deferred) — Apply in place:**
- "Apply Remediation" button present in v1 UI but clearly disabled/stubbed
- Requires design discussion before implementation (sudoers, risk acknowledgment flow)

**fapolicyd advisory:**
- Originally planned as an inline alert at all remediation download surfaces
- **Struck from requirements (REQ-23)** — target audience (security admins) knows their stack

---

### Tailoring (Delivered in v0.8)

**Actual implementation:** No `autotailor` dependency. Implemented entirely in-browser:
- Python3 `iterparse` extracts rule tree + variable values from the SDS file with an early break on the `Benchmark` element — avoids parsing the 35MB OVAL section
- Rule tree rendered as native `<details>/<summary>` elements with checkbox delta tracking
- Variable editor uses select dropdowns for enumerated values, text inputs otherwise
- XCCDF tailoring XML generated as a string in JavaScript from the delta state — no external tool required
- JSON sidecar written alongside each `.xml` for fast metadata access without re-parsing XML

**Tailoring file workflow (as delivered):**
1. User selects content + base profile, names the tailored profile
2. Python3 script runs via `cockpit.spawn` and returns rule tree + variables as JSON
3. User toggles rules, adjusts variables — only deltas from the base profile are tracked
4. Save writes `.xml` + `.json` sidecar to `/var/lib/cockpit-scap/tailoring/`
5. Saved files can be edited, downloaded, uploaded (external files), or deleted
6. Scan tab shows tailoring files filtered by the current SDS; selected tailoring file is passed to `oscap xccdf eval --tailoring-file` and `oscap xccdf generate fix --tailoring-file`

---

## System Constraints

### SELinux

**Status: Required deliverable — module is not done until this works**

- All module file I/O goes to `/var/lib/cockpit-scap/`
- This path requires proper SELinux file context at install time
- Module ships `selinux/cockpit-scap.fc` file context definition
- Install process runs `semanage fcontext` + `restorecon` automatically
- Admin never touches SELinux manually
- Testing must be performed with SELinux in enforcing mode — permissive is not sufficient

### Firewall

- No new ports required
- Module operates entirely through Cockpit's existing `9090/tcp`
- Document this explicitly so admins don't go hunting for something that doesn't exist

### fapolicyd

- `oscap`, `autotailor` are RPM-installed — in trust database by default
- Generated remediation scripts are new files — not in trust database
- UI advisory callout handles this at the point of download
- No module-level workaround needed

---

## `oscap` CLI Surface

| Purpose | Command |
|---|---|
| Discover content | `ls /usr/share/xml/scap/ssg/content/` |
| Profile list | `oscap info <sds-file>` |
| Profile detail | `oscap info --profile <id> <sds-file>` |
| Run scan | `oscap xccdf eval --profile <id> --report <html> --results <xml> <sds-file>` |
| Get result-id | `oscap info <results.xml>` |
| Generate bash fix | `oscap xccdf generate fix --fix-type bash --result-id <id> --output <sh> <results.xml>` |
| Generate ansible fix | `oscap xccdf generate fix --fix-type ansible --result-id <id> --output <yml> <results.xml>` |
| Tailoring (v2) | `autotailor --json-tailoring <json> --output <tailoring.xml> <sds-file> <profile-id>` |
| Scan with tailoring | `oscap xccdf eval --tailoring-file <xml> --profile <id> --report <html> --results <xml> <sds-file>` |

**Critical note:** Always pass both `--report` and `--results` to every scan. The `results.xml` file
is required for remediation generation and must be preserved in the scan history directory.

---

### Container Scanning — `oscap-podman` (v3)

**Decision:** Container image scanning uses `oscap-podman` against the root Podman image store only. Rootless (per-user) image stores are out of scope.

**How it works:**
`oscap-podman` is a shell wrapper that mounts a container image filesystem, sets `OSCAP_PROBE_ROOT` to the mount point, and runs `oscap` directly against it. The output format — `results.xml`, `report.html`, remediation scripts — is identical to a host scan.

**The rootless image store limitation:**

`oscap-podman` explicitly requires root (`id -u == 0`) and uses plain `podman` commands with no `--root` flag. When run as root, Podman resolves images from root's store at `/var/lib/containers/storage/`. Rootless images stored in individual users' `~/.local/share/containers/storage/` are invisible to this path and cannot be targeted without specifying a non-default storage root — which `oscap-podman` does not support.

**Why we didn't work around it:**
- Red Hat's own RHEL 10 Security Hardening guide (section 5.2.5) documents `# podman images` (root) as the canonical enumeration method — no mention of rootless stores
- Bypassing `oscap-podman` and replicating its mount logic manually would require us to maintain a fragile copy of upstream behavior across Podman version changes
- The correct workaround is an upstream fix to `oscap-podman`, not a UI-layer hack

**Documented workaround for users:**
Images intended for compliance scanning should be pulled into the root store:
```bash
sudo podman pull <image>
```
This is the Red Hat-documented approach and consistent with how compliance tooling is managed at the system level.

**`notapplicable` results in container scans:**
Per the RHEL 10 Security Hardening guide: *"rules marked as notapplicable apply only to bare metal and virtual systems and not to containers or container images."* Container scans will show a significantly higher `notapplicable` count than host scans. The results card surfaces a contextual note explaining this so users aren't alarmed.

**Privilege model:**
No new polkit rules or sudoers entries required. Both image enumeration (`podman images`) and scan execution (`oscap-podman`) run under Cockpit's existing `{ superuser: "require" }` mechanism — the same prompt already used for host scans.

---

## Version Roadmap

| Version | Theme | Key Features |
|---|---|---|
| **v1** ✅ | Local scanning + tailoring | Host scan, tailoring editor, SELinux, Makefile, COPR |
| **v2** ✅ | Multi-version SDS content | RHEL 6–9 SDS staging, CPE OS detection, content management UI |
| **v3** ✅ | Container image scanning | `oscap-podman` integration, root Podman store, version mismatch detection, per-image history |

**Explicitly out of scope (any version):**
- Remote SSH scanning — different tool, different trust model
- OVAL vulnerability scanning — not the Workbench gap; Insights and `dnf updateinfo` already serve this
- Red Hat Satellite / Insights replacement — wrong audience, wrong scale

---

## What This Module Is Not

- Not a remote scanning tool (SSH scanning is explicitly out of scope)
- Not a vulnerability scanner (OVAL/CVE scanning is not in scope — Red Hat Insights and `dnf updateinfo list sec` already serve this for the target audience)
- Not a Red Hat Satellite replacement
- Not a tool for applying untested remediations without admin review
