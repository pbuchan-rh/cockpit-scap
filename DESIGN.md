# cockpit-scap — Design Document

**Status:** v3.4-dev current  
**Last updated:** 2026-05-31

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

**Current tab bar (v3.4):**
```
[ Host Scan ]  [ Container Scan ]  [ Policy Tailoring ]  [ Content Library ]  [ Dashboard ]        Activity →
```

Each tab is an independent workflow with shared infrastructure (content detection, tailoring files, history):

- **Host Scan** — SDS + profile selection, scan execution, results card (donut, failing rules summary), scan history
- **Container Scan** — `oscap-podman` workflow, root Podman image store, identical results/history to host scan
- **Policy Tailoring** — full rule tree editor, variable editor, save/edit/update/delete tailoring files
- **Content Library** — manage user-staged SDS files (stage via SCP), validate, delete
- **Dashboard** — latest scan per host + container image, compliance score, delta vs previous *(preview)*
- **Activity** — real-time action log, filter by type, export CSV, clear

**Original rationale (still holds):**
Reflects the actual admin mental model — scan first, tailor carefully, remediate deliberately. Tabs are independent workflows; an admin can spend an entire session in Tailoring without ever scanning.

---

### UI Flow — Host Scan Tab (v3.4)

```
┌─────────────────────────────────────────────────────────┐
│  SCAN CONFIGURATION (single unified card, two columns)  │
│  Left: Content selector, Profile selector,              │
│        Tailoring file selector                          │
│  Right: Profile description (updates on selection)      │
│  Footer: [ Run Scan ]  View Guide                       │
├─────────────────────────────────────────────────────────┤
│  SCAN RUNNING STATE                                     │
│  Spinner + progress indicator                           │
│  [ Cancel Scan ]                                        │
├─────────────────────────────────────────────────────────┤
│  RESULTS CARD (View Scan from history or post-scan)     │
│  Profile title + scan timestamp                         │
│  Pass/Fail/Error/Not-checked badges + score donut       │
│  Failing rules summary (HIGH/MEDIUM/LOW collapsible,    │
│    rule title + CCE identifier per rule)                │
│  [ View Full Report ] [ Download Report ]               │
│  [ Download Results XML ] [ Remediate ] [ Run Again ]   │
│                                          [ Close ]      │
├─────────────────────────────────────────────────────────┤
│  SCAN HISTORY                                           │
│  Date | Profile | Pass | Fail | Score | Actions        │
│  Actions: Run Again  View Scan  Remediate  Delete       │
│  Export CSV →                                           │
└─────────────────────────────────────────────────────────┘
```

---

### Content Loading

**System content** — auto-detected from `/usr/share/xml/scap/ssg/content/`. Human-readable names via a static map covering all standard SSG filenames (RHEL 6–10, Firefox, etc.).

**User content** — admin stages files via SCP to `/var/lib/cockpit-scap/content/`. The SDS selector shows both sources in grouped `<optgroup>` ("System Content" / "Uploaded Content"). Content Library tab lists uploaded files with per-entry delete and `oscap ds sds-validate` validation.

**In-browser upload via UI:** Deferred (REQ-53). SCP-first approach is sufficient; Cockpit file size limits make browser upload unreliable for large SDS files. Content Library tab shows staging instructions.

---

### Results Display

**HTML Report:** Opens via IndexedDB bridge → viewer.html (CSP-compliant). `oscap` generates a rich self-contained HTML report; opening it avoids duplicating what oscap already does well. Download offered alongside.

**Results XML download:** Raw `results.xml` downloadable for auditor archives — available on results card and each history row.

**Score donut:** Plain SVG arc. Arc length = compliance %. Color based on failure count: 0=green, 1–10=yellow, 11+=red. Score percentage in center. No library. See Score Donut design note above.

**Failing rules summary:** Async-loaded below badges. Collapsible `<details>/<summary>` groups for HIGH/MEDIUM/LOW (HIGH expanded by default). Each rule shows title + CCE identifier as secondary text. Powered by `PY_EXTRACT_FAILING_RULES` (shared with Selective Remediation panel).

**Rule results table (full expandable):** Still deferred. The oscap HTML report provides a rich, filterable rule-by-rule view that would be expensive to duplicate at equivalent quality. The failing rules summary fills the quick-reference need without duplicating the report.

**Result status colors:** PF6 CSS custom properties — `--ct-color-success`, `--ct-color-danger`, `--ct-color-warning`, `--ct-color-border` (neutral).

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

**manifest.json schema (v3.4):**
```json
{
  "timestamp": "2026-05-28T14-32-00",
  "sds_file": "/usr/share/xml/scap/ssg/content/ssg-rhel10-ds.xml",
  "profile_id": "xccdf_org.ssgproject.content_profile_cis",
  "profile_title": "CIS Red Hat Enterprise Linux 10 Benchmark for Level 2 - Server",
  "tailoring_file": "/var/lib/cockpit-scap/tailoring/my-tailoring.xml",
  "result_id": "xccdf_org.open-scap_testresult_...",
  "scan_type": "host",
  "scheduled": false,
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

Container scans additionally include `"scan_type": "container"`, `"image_name"`, and `"image_id"`. Host scans without `scan_type` are treated as `"host"` for backwards compatibility.

---

### Remediation

**Full remediation artifacts** — generated post-scan for every scan:
- Bash script: `oscap xccdf generate fix --fix-type bash`
- Ansible playbook: `oscap xccdf generate fix --fix-type ansible`
- Both respect `--tailoring-file` when a tailoring file was used

**Selective Remediation Builder (v3.3)** — after any scan (current or history), the Remediate button opens a panel showing all failing rules from `results.xml`, grouped HIGH/MEDIUM/LOW. Admin selects rules, downloads a filtered bash or Ansible artifact. Python block parsing (`PY_FILTER_FIX`) filters the already-generated scripts. Available for both host and container scans. Container panel includes a warning that scripts apply to image builds, not live containers.

**Apply in place (v3.5):** Implemented for host scans only. Two-gate confirmation flow:
1. **Gate 1** — danger modal: "This will modify system configuration. Changes cannot be automatically reversed." Proceed / Cancel.
2. **Gate 2** — script review modal: filtered bash content displayed in a scrollable code block with rule count. Apply Now / Cancel.
3. **Execution** — `PY_FILTER_FIX` generates the filtered script, written to `remediationDir/remediation-apply.sh`, executed via `cockpit.spawn(['bash', path], { superuser: 'require' })` with streaming output. Temp file deleted on completion. Exit code logged to activity log as `remediate_apply`.

Admin-gated (`ct-requires-admin`) — disabled in limited Cockpit sessions. `oscap-podman` explicitly rejects `--remediate` for container scans; container Apply Now is permanently excluded (download-only). fapolicyd note: if fapolicyd is enforcing, script execution in `/var/lib/cockpit-scap/` may be blocked — document in release notes if reported.

**fapolicyd advisory:** Originally planned as an inline alert. **Struck (REQ-23)** — security admins know their stack; advisory would require equivalent warnings for SELinux, auditd, etc.

---

### Tailoring

**No `autotailor` dependency.** Implemented entirely in-browser:
- Python3 `iterparse` extracts rule tree + variable values from the SDS file with an early break on the `Benchmark` element — avoids parsing the 35MB OVAL section
- Rule tree rendered as native `<details>/<summary>` elements with checkbox delta tracking
- Variable editor uses select dropdowns for enumerated values, text inputs otherwise
- XCCDF tailoring XML generated as a string in JavaScript from the delta state — no external tool required
- JSON sidecar written alongside each `.xml` for fast metadata access without re-parsing XML

**Tailoring file workflow:**
1. Select content + base profile, name the tailored profile, click Load Profile
2. Python3 script returns rule tree + variables as JSON via `cockpit.spawn`
3. Toggle rules, adjust variables — only deltas from the base profile are tracked
4. Save writes `.xml` + `.json` sidecar to `/var/lib/cockpit-scap/tailoring/`
5. Saved files can be edited (Update in place or Save as New), downloaded, uploaded (external XCCDF), or deleted
6. **Update-in-place (v3.3):** editing an existing file shows "Update" + "Save as New" buttons; Update overwrites original XML + JSON sidecar. `tailorEditingSidecar` module var tracks which file is being edited.
7. **Inline name field:** editor header shows editable profile name; both Update and Save as New read from it
8. Scan tabs show tailoring files in a selector; selected file passed to `oscap xccdf eval --tailoring-file` and `oscap xccdf generate fix --tailoring-file`
9. **Run Again with tailoring:** uses `base_profile_id` from the JSON sidecar (not the tailoring profile ID) to correctly restore the base profile selector

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

- `oscap` is RPM-installed — in trust database by default
- Generated remediation scripts are new files — not in trust database
- UI advisory for this was struck (REQ-23) — security admins know their stack
- No module-level workaround needed

---

## `oscap` CLI Surface

| Purpose | Command |
|---|---|
| Discover content | `ls /usr/share/xml/scap/ssg/content/` |
| Profile list | `oscap info <sds-file>` |
| Profile detail | `oscap info --profile <id> <sds-file>` |
| Run scan | `oscap xccdf eval --profile <id> --report <html> --results <xml> <sds-file>` |
| Scan with tailoring | `oscap xccdf eval --tailoring-file <xml> --profile <id> --report <html> --results <xml> <sds-file>` |
| Get result-id | `oscap info <results.xml>` |
| Generate bash fix | `oscap xccdf generate fix --fix-type bash --result-id <id> --output <sh> <results.xml>` |
| Generate ansible fix | `oscap xccdf generate fix --fix-type ansible --result-id <id> --output <yml> <results.xml>` |
| Generate guide | `oscap xccdf generate guide --profile <id> <sds-file>` (stdout, no file write) |
| Validate SDS | `oscap ds sds-validate <sds-file>` |
| Container scan | `oscap-podman <image-id> xccdf eval --profile <id> --report <html> --results <xml> <sds-file>` |

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
| **v3.3** ✅ | Selective remediation + observability | Selective Remediation Builder (host + container), Results XML download, Activity log, Compliance Dashboard (preview), Tailoring Update-in-place |
| **v3.4** ✅ | UI polish release | Failing rules summary with CCE identifiers, score donut, View Scan from history, results card persistence, unified scan config card, close button; scheduled scanning deliberately deferred (see design note) |
| **v3.5** ✅ | Actionability + intelligence | One-click remediation apply (two-gate confirmation, live output, admin-gated); rule detail expansion in selective remediation; remediation search (title + rule ID); dashboard hero card (single host compliance card, weighted risk score, async critical findings by name); Settings tab (retention, tab visibility, admin gate, activity audit); table scroll caps; cross-version content filtering; tailoring auto-fill |

**Explicitly out of scope (any version):**
- Remote SSH scanning — different tool, different trust model
- OVAL vulnerability scanning — not the Workbench gap; Insights and `dnf updateinfo` already serve this
- Red Hat Satellite / Insights replacement — wrong audience, wrong scale

---

---

## Scan Results Card — v3.4 Design

### Failing Rules Summary

Displayed below the pass/fail/score badges, loaded asynchronously after the results card renders. Uses `PY_EXTRACT_FAILING_RULES` (already used by the Selective Remediation panel) — no new Python. Groups failing rules into HIGH / MEDIUM / LOW collapsible `<details>/<summary>` blocks; HIGH expanded by default, empty groups hidden. A spinner shows while loading; failures are silently suppressed since the summary is informational.

**Why async:** `PY_EXTRACT_FAILING_RULES` spawns a Python subprocess against `results.xml`. On slower machines this is noticeable. Showing the score and badges immediately, then populating the rule groups when ready, gives a better perceived-performance experience.

### Score Donut

Plain SVG arc (`stroke-dasharray` / `stroke-dashoffset` technique). Arc length = compliance %. Color based on failure count, not score percentage — because 80% compliance is not "good" for a security tool. Thresholds: 0 failures = green, 1–10 = yellow, 11+ = red. Score percentage shown in center text. No library.

**Why failure-count not score-based color:** A score-based threshold (e.g. ≥80% = green) implies 20% of failing security rules is acceptable. For a compliance tool targeting security hardening, any failures represent real risk. The failure count gives a more honest signal — 0 failures is the only clean state.

### View Scan / Results Persistence

History rows now show "View Scan" instead of separate "View Report" + "Download XML" actions. Clicking "View Scan" calls `loadScanFromHistory(manifest)` which sets all `current*` module vars from the manifest and calls `showResults()` — identical state to a live scan completing. View Report and Download XML are available on the results card itself.

This solves the "no way back" problem: the results card survives navigation and can be re-entered for any historical scan at any time.

**Race condition guard:** `loadScanFromHistory` bails immediately if `currentScanProc` is set. Additionally, `loadHistory()` is called in `showScanProgress()` so the history table rebuilds with View Scan and Run Again buttons visually disabled the moment a scan starts.

### Single Scan Configuration Card

The previous two-card split (form card left + profile description card right) is replaced by a single `pf-v6-c-card` with an internal CSS grid (`ct-scan-body-grid: 1fr 1fr`). Form fields on the left, profile description on the right behind a border divider.

**Why:** The two-card layout caused a jarring layout shift — idle state showed two cards at half-width, but scan progress and results were full-width. A single card eliminates the shift and reads as one coherent form. Profile description still has its own visual column without being a separate card.

---

## Scheduled Scanning — Deliberately Deferred

### Why Not v3.4

Scheduled scanning was originally scoped for v3.4 but was deliberately deferred after design review. The decision is recorded here because it is non-obvious and worth preserving.

**The core issue: operating model.**

cockpit-scap is a pure Cockpit module. Its entire footprint is:
- Module files in `/usr/share/cockpit/cockpit-scap/`
- Runtime data in `/var/lib/cockpit-scap/`
- All execution within the Cockpit browser session via `cockpit.spawn()` and `cockpit.file()`

Scheduled scanning requires background execution — scans that run without a browser session, triggered by systemd timers. This necessitates:
- A helper script in `/usr/libexec/cockpit-scap-scan`
- Parameterized systemd units in `/usr/lib/systemd/system/`
- A polkit rule (or equivalent privilege mechanism)

That is a fundamentally different kind of software. Once you ship systemd units and background scripts, cockpit-scap is no longer a Cockpit module — it is a system service that happens to have a Cockpit UI. Background processes persist and execute outside the browser session, survive module uninstall unless explicitly cleaned up, and create ongoing system-level maintenance obligations.

**Why this matters beyond cleanliness:**
- EPEL package reviewers have a clear, well-understood category for pure Cockpit modules. Adding system services complicates the review and maintenance story.
- Official Cockpit modules (cockpit-storage, cockpit-machines, cockpit-networkmanager) do not ship their own polkit rules or helper scripts — they delegate to D-Bus services that already exist. We would be doing something those modules do not.
- The module is already well beyond SCAP Workbench feature parity without scheduled scanning. The value/complexity tradeoff does not justify crossing this line in v3.4.

**Future path:**
Scheduled scanning is not ruled out permanently — it is deferred until there is a clear design that respects the operating model boundary. Possibilities include: a companion sub-package (`cockpit-scap-scheduler`) that ships the system-level components separately, or waiting until the Cockpit project itself provides a sanctioned mechanism for scheduled background operations.

Until then, administrators who need scheduled scanning can use cron or systemd timers calling `oscap` directly, dropping results into `/var/lib/cockpit-scap/results/` in the expected manifest format. This is documentable as a power-user recipe without shipping system infrastructure in the package.

### Architecture

```
/usr/libexec/cockpit-scap-scan          # headless scan script (shell or Python)
/usr/share/polkit-1/rules.d/            # polkit rule authorizing the script
/usr/lib/systemd/system/cockpit-scap-scan@.service   # parameterized by schedule name
/usr/lib/systemd/system/cockpit-scap-scan@.timer
/var/lib/cockpit-scap/schedules/        # one JSON file per named schedule
```

### Schedule Config Schema

```json
{
  "name": "daily-cis",
  "sds": "/usr/share/xml/scap/ssg/content/ssg-rhel10-ds.xml",
  "profile": "xccdf_org.ssgproject.content_profile_cis",
  "tailoring": "/var/lib/cockpit-scap/tailoring/my-tailoring.xml",
  "cron": "0 2 * * 0",
  "enabled": true,
  "last_run": "2026-06-01T02-00-00",
  "last_status": "success",
  "last_error": null,
  "failure_dismissed": false
}
```

### Headless Script Responsibilities

The script must replicate the full JS scan completion path:
1. Run `oscap xccdf eval` with `--report`, `--results`, `--tailoring-file` (if set)
2. Parse results.xml for counts and score (Python)
3. Write `manifest.json` with `scan_type: "host"`, `scheduled: true`
4. Run `oscap xccdf generate fix` for bash and ansible artifacts
5. Prune host history to 10 entries
6. Append `scan_scheduled_complete` or `scan_scheduled_error` to `activity.log`
7. Write `last_run`, `last_status`, `last_error` back to the schedule JSON

### UI

Schedules section lives below Scan History on the Host Scan tab. List view shows name, profile, cron, last run, last status, enable toggle. Create/edit form exposes: content selector, profile selector, optional tailoring selector, cron expression input with inline example. Delete with confirmation modal.

Failure banner: persistent, dismissable, shown when `last_status === 'error'` and `failure_dismissed === false`. Dismissal writes `failure_dismissed: true` to schedule JSON via `cockpit.file(...).replace(...)` with `{ superuser: 'require' }`.

### What Does NOT Ship in v3.4

- Container scan scheduling (architecture must not preclude it — use same script with `oscap-podman` args)
- Email/webhook/push notifications
- Scan-on-boot or event-driven triggers
- Multiple concurrent running scans

---

## What This Module Is Not

- Not a remote scanning tool (SSH scanning is explicitly out of scope)
- Not a vulnerability scanner (OVAL/CVE scanning is not in scope — Red Hat Insights and `dnf updateinfo list sec` already serve this for the target audience)
- Not a Red Hat Satellite replacement
- Not a tool for applying untested remediations without admin review
