# scap-tui — Design Document

**Status:** Early design / pre-implementation  
**Last updated:** 2026-05-29

---

## Project Overview

`scap-tui` is a standalone terminal-based SCAP compliance scanning and profile tailoring tool for
RHEL 10. It is the spiritual successor to SCAP Workbench — explicitly positioned as the replacement
for the Wayland/RHEL 10 era — and is designed for administrators who do not have or do not want
Cockpit installed.

**This is a completely separate project from cockpit-scap.** They share a problem domain and
a feature reference (see `WORKBENCH_FEATURES.md`) but have no code, storage, or runtime dependency
on each other. An admin chooses one or the other based on how they manage their system — not both.

---

## Why This Exists

SCAP Workbench was archived in September 2024. Its removal from RHEL 10 was driven by its
dependency on X11/Motif in an environment that has moved to Wayland. No terminal-native replacement
exists in the RHEL ecosystem.

The gap this fills:

- Admins who SSH into servers and never open a browser
- Headless servers with no desktop session
- Air-gapped environments where Cockpit is not deployed
- Smaller shops not running Satellite or Insights
- Anyone who needs local SCAP scanning and tailoring from the command line without hand-editing XML

Red Hat Satellite and Insights are **not** the target. Those are centralized fleet management
platforms. This tool is for the admin who needs to scan and tailor **this host, right now**, from
a terminal.

---

## Target Audience

Security-focused RHEL administrators who:
- Live primarily in SSH terminal sessions
- Do not have Cockpit installed (or prefer not to use it)
- Need to run SCAP compliance scans and manage tailoring files locally
- Want a GUI-like experience without a desktop environment

---

## Relationship to cockpit-scap

| Dimension | cockpit-scap | scap-tui |
|---|---|---|
| Interface | Browser (Cockpit module) | Terminal (TUI) |
| Requires Cockpit | Yes | No |
| Requires desktop | No | No |
| Requires SSH | No (runs in browser) | No (runs in terminal) |
| Storage path | `/var/lib/cockpit-scap/` | Its own path (TBD) |
| Shared code | None at runtime | None at runtime |
| Shared reference | WORKBENCH_FEATURES.md, SCAP knowledge | Same |

These tools coexist in the same problem domain but serve different users. An admin running Cockpit
uses cockpit-scap. An admin who does not uses scap-tui. Neither depends on the other.

---

## Positioning

The README will state plainly:

> *SCAP Workbench was archived in September 2024 and is incompatible with RHEL 10's Wayland
> environment. scap-tui is its terminal-native successor — a full SCAP scanning and profile
> tailoring tool that runs anywhere Python runs, including headless servers and SSH sessions.*

This is not a code fork of SCAP Workbench. The C++/Qt codebase provides no reusable code for a
Python TUI tool. What it provides is a feature reference and community name recognition.
`WORKBENCH_FEATURES.md` documents that feature set for use as a design checklist.

---

## TUI Library

**Textual** (by Textualize) is the strong candidate. It provides:
- `TabbedContent` — mirrors our two-tab layout (Scan / Tailoring)
- `Tree` widget — rule tree with expand/collapse and selection
- `DataTable` — scan history
- `Select` / `Input` — form fields for SDS, profile, tailoring file
- `Button` — scan controls
- `ProgressBar` — scan progress
- `Modal` — confirmation dialogs
- CSS-like layout system — achieves visual quality comparable to a native GUI

Textual is MIT licensed, Python 3.8+, pip-installable. On RHEL 10 (Python 3.12) it runs without
modification.

The dependency strategy (pip vs. RPM with bundled deps vs. venv) is an open question — see below.

---

## Feature Scope

### In Scope — v1

Drawn from the Workbench feature reference (`WORKBENCH_FEATURES.md`) and cockpit-scap experience:

**Scanning**
- Auto-detect SSG data stream files from `/usr/share/xml/scap/ssg/content/`
- Human-readable SDS display names
- Profile selection with full description display
- Tailoring file selection (optional)
- Scan execution via `oscap xccdf eval`
- Real-time scan progress display
- Scan cancellation
- Results summary — pass/fail/error/notchecked counts + compliance score
- Scan history — persist last N scans, view from history

**Remediation**
- Generate bash remediation script
- Generate Ansible remediation playbook
- Download / save both to user-specified path
- Apply Remediation — stub only in v1 (same policy as cockpit-scap)

**Reporting**
- Open HTML report in browser if available (`xdg-open`)
- Always display file path for manual access / `scp`
- Text summary from XML results as in-TUI fallback

**Tailoring**
- Content + base profile selection, named tailored profile
- Rule tree with enable/disable checkboxes
- Expand all / collapse all
- Rule search
- Variable editor (select for enumerated, text input otherwise)
- Save tailoring file as valid XCCDF XML + JSON sidecar
- Saved tailoring files list: edit, download, delete
- Upload external XCCDF tailoring file

**Prereqs**
- Detect missing `openscap-scanner`, `scap-security-guide`, `openscap-utils`
- Display clear installation instructions rather than failing silently

### Intentionally Out of Scope — v1

- Remote SSH scanning — deferred; warrants its own design discussion
- Online remediation (`--remediate` live during scan) — high risk, deferred
- Offline remediation (re-apply from ARF) — deferred
- Puppet manifest generation — Ansible has largely won; defer
- Benchmark guide viewer — deferred
- ARF export — deferred; XCCDF results cover most use cases
- Container / image scanning — out of scope, OS profile mismatch is a correctness blocker
- OVAL vulnerability scanning — out of scope

### Workbench Features to Revisit for v2

These Workbench features are worth considering for a future version, not v1:

- Remote SSH scanning — more natural fit for a terminal tool than a browser tool
- Undo / redo in tailoring
- Value-to-rules dependency map
- Benchmark guide viewer (render as text or open in browser)
- Dry-run / CLI preview mode (show `oscap` command without executing)
- Pre-scan remediation role generation (without scanning first)
- Puppet manifest generation

---

## Backend Logic

The following logic is well-understood from cockpit-scap and will be re-implemented natively
in Python for scap-tui (not borrowed or shared at runtime):

| Component | Approach |
|---|---|
| SDS file discovery | `glob` against `/usr/share/xml/scap/ssg/content/*-ds.xml` |
| Profile extraction | Parse `oscap info` output |
| Rule tree extraction | Python `iterparse` with early break on `Benchmark` element — skips 35MB OVAL section |
| XCCDF tailoring XML generation | Pure Python string generation from delta state |
| JSON sidecar | Written alongside each `.xml` for fast metadata access |
| Scan execution | `subprocess` with streaming output for real-time progress |
| Remediation generation | `oscap xccdf generate fix` post-scan |

---

## SELinux

Same requirement as cockpit-scap: the tool must work with SELinux in enforcing mode. All file I/O
is scoped to its own storage path. A formal `.fc` file and install-time `restorecon` are required
deliverables before community release.

---

## Open Questions

These must be resolved before implementation begins. They are parked here for the design discussion.

### Q1 — Tool Name

Working name is `scap-tui`. Candidates:
- `scap-tui` — accurate, searchable
- `scap-console` — communicates the terminal context
- `oscap-tui` — ties to the oscap binary name
- Something else

Considerations: discoverability for admins searching for SCAP Workbench alternatives, RPM package
name conventions, potential namespace conflict with existing tools.

### Q2 — Storage Path

`/var/lib/scap-tui/` mirroring the cockpit-scap layout is the working assumption. Questions:
- Does this path make sense for a non-Cockpit tool?
- Should tailoring files live somewhere more accessible to the user (e.g., `~/.local/share/scap-tui/`)?
- Scans require root — user-local storage creates a mismatch. System-wide is likely correct.

### Q3 — Privilege Model

Without Cockpit's superuser mechanism, options are:
- Launch unprivileged, call `sudo oscap ...` only at scan time — matches cockpit-scap philosophy
- Require the tool to be launched as root / via `sudo scap-tui`
- Use `pkexec` — over-engineered for a CLI tool

Tradeoffs: the first option is cleanest but requires sudoers configuration. The second is simpler
but breaks the unprivileged browsing / privileged scanning separation that is a design principle
of cockpit-scap.

### Q4 — Textual Dependency Strategy

Textual is not in RHEL 10 base repos. Options:
- `pip install textual` — acceptable for many admins, not acceptable for air-gapped environments
- RPM with bundled Python deps — correct solution, higher packaging effort
- Virtualenv wrapper script — transparent to the user but adds install complexity
- Evaluate whether a stdlib-only (`curses`) implementation is feasible for the tailoring UI

This decision affects the install story and the air-gapped use case significantly.

### Q5 — HTML Report Handling

In a terminal context without a guaranteed browser:
- `xdg-open report.html` if `$DISPLAY` or `$WAYLAND_DISPLAY` is set
- Always print the file path so the admin can `scp` or copy it
- Display a text summary from the XML results as an in-TUI fallback

Is a text summary sufficient fallback, or should we invest in rendering key report sections as
formatted terminal output?

### Q6 — Project Repository

Does scap-tui live in its own repository from day one, or does it start as a subdirectory of
cockpit-scap and split later? Given that it is a completely separate tool with a separate identity,
a separate repo from the start is cleaner — but development overhead is higher when the project
is still in early design.

---

## Reference Material

- `WORKBENCH_FEATURES.md` — complete SCAP Workbench feature inventory and cockpit-scap gap analysis
- `HANDOFF.md` — cockpit-scap session state (context for shared design decisions)
- `DESIGN.md` — cockpit-scap architecture (reference for patterns to follow or diverge from)
- OpenSCAP/scap-workbench GitHub (archived) — original source
