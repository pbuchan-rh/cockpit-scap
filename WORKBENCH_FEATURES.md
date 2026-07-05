# SCAP Workbench — Feature Reference

**Source:** Analysis of OpenSCAP/scap-workbench GitHub repository (archived September 2024)  
**Purpose:** Feature reference for cockpit-scap gap analysis and future TUI tool design  
**Last updated:** 2026-06-02

---

## 1. Content / SDS Management

| Feature | User-facing behavior | Special deps | Notes |
|---|---|---|---|
| Open XCCDF file | Load a standalone XCCDF 1.1 or 1.2 file | none | All referenced OVAL/CPE files must be in same directory tree |
| Open Source DataStream (SDS) | Load a single `.xml` or `.xml.bz2` SDS 1.2 container | none | Preferred format; contains everything |
| Open SCAP RPM | Extract and load SCAP content bundled in an RPM package | `scap-workbench-rpm-extract.sh`, rpm2cpio | Searches for `*-(xccdf\|ds).xml` under `./usr/share/xml/scap/` |
| Bzip2-compressed files | Open `.xml.bz2` variants transparently | none | |
| SSG integration dialog | On startup, shows a picker listing all installed `ssg-*-ds.xml` files by product name | scap-security-guide | Alphabetically sorted; "Other SCAP content" fallback |
| File watcher | Detects if opened file is modified on disk by an external tool and prompts user | none | Qt filesystem watcher |
| Reload content | Re-reads the currently opened file without restarting | none | Destroys current profile selection and customizations |
| Checklist (component) selection | For SDS files with multiple embedded checklists, pick which component XCCDF to use | none | Maps to `--datastream-id` / `--xccdf-id` oscap flags |
| Command-line file argument | Launch with `scap-workbench /path/to/file.xml` to skip file dialog | none | Also `--tailoring file` |
| File closure validation | Warns user before closing if there are unsaved tailoring changes | none | |
| Save all files into directory | Exports the primary content file plus all dependencies and current tailoring file into a directory | none | Preserves relative directory structure |
| Save content as RPM | Packages content closure + tailoring into a distributable RPM | `scap-as-rpm` script | Dialog collects name, version, release, summary, license |

---

## 2. Profile Selection and Discovery

| Feature | User-facing behavior | Special deps | Notes |
|---|---|---|---|
| Profile combobox | Lists all profiles from both the benchmark and any loaded tailoring file | none | |
| "(default)" profile | Always available; benchmark baseline with no rule changes | none | |
| Profile preview (rule list) | Shows the list of rules selected by the current profile, updates live | none | Rendered in rule results tree |
| Tailoring file combobox | Separate combobox to load an XCCDF tailoring file alongside main content | none | Options: None / Select file / loaded file / unsaved changes |
| Tailoring file from CLI | `--tailoring /path/to/tailoring.xml` pre-loads a tailoring file | none | |

---

## 3. Scanning (Local)

| Feature | User-facing behavior | Special deps | Notes |
|---|---|---|---|
| Local machine scan | Runs `oscap xccdf eval` against the local system | openscap | Default target |
| Privilege escalation via pkexec/polkit | polkit authentication dialog before scanning; degrades gracefully if unavailable | polkit, pkexec | Uses `scap-workbench-pkexec-oscap.sh` wrapper |
| nice priority adjustment | Runs oscap with `nice` to reduce CPU impact | `nice` binary | Build-time optional; graceful degradation |
| Skip validation (`--skip-valid`) | Bypass OpenSCAP content validation before scanning | none | Intended for content developers |
| Fetch remote resources | Passes `--fetch-remote-resources` to oscap to download OVAL/CPE feeds during scan | network | Off by default |
| Online remediation | Passes `--remediate` to oscap, applying fixes live during scan | openscap ≥ 0.9.5 | |
| Offline remediation | Takes a previously saved ARF result and runs `oscap xccdf remediate` without re-scanning | none | Separate button |
| Dry-run mode | Shows exact `oscap` command that would be run (with clipboard copy) without executing | none | |
| Real-time progress reporting | Rule results appear in list as they complete, not just at end | openscap ≥ 0.9.3 | Uses `--progress` flag |
| Scan cancellation | Cancel button terminates in-progress oscap process | none | Partial results shown; no report/ARF available |
| OVAL results included | Always passes `--oval-results` for detailed OVAL check data in HTML reports | none | |
| Full output capture | Captures stdout, stderr, ARF, results XML, and HTML to temp files | none | |

---

## 4. Scanning (Remote / SSH)

| Feature | User-facing behavior | Special deps | Notes |
|---|---|---|---|
| Remote machine target | Radio button switches from local to remote; `username@hostname` input + port selector | `ssh` client | |
| Recent targets history | Combobox remembers last 5 used remote targets; "Clear history" option | none | Stored in QSettings |
| SSH connection multiplexing | Persistent control socket (`-M -f -N`), reused for all file transfers and remote commands | none | Temp socket; 60s keepalive |
| SSH askpass for passwords | Delegates to platform SSH askpass; never processes passwords in code | ssh-askpass | macOS and Windows have custom askpass scripts |
| SDS-only remote scanning | Remote scanning requires SDS; plain XCCDF not supported for remote targets | none | Enforced in UI |
| Remote oscap prerequisite check | Before scanning, verifies `oscap` is available in PATH on remote via `command -v` | none | |
| Remote capability detection | Queries `oscap -V` on remote to determine available features | none | |
| File transfer to remote | Copies SDS and tailoring file to temp directory on remote via `ssh + tee` | none | |
| Remote command execution | Runs `cd '[workdir]'; [sudo -n] oscap [args]` on remote | none | |
| Sudo support | Optional `sudo -n` prefix for remote oscap; requires passwordless sudo | sudoers config | `oscap-user ALL=(root) NOPASSWD: /usr/bin/oscap xccdf eval *` |
| Result retrieval | Reads back results, HTML report, and ARF from remote temp files via `cat` over SSH | none | |
| Remote cleanup | Deletes temp directory and files from remote after scan | none | |
| Offline remediation on remote | Generates ARF locally, transfers it, runs `oscap xccdf remediate` on remote | none | |

---

## 5. Results Display

| Feature | User-facing behavior | Special deps | Notes |
|---|---|---|---|
| Rule results list | Scrollable list of all selected rules with result status, updated in real time | none | |
| 10 result states with color coding | pass (green), fail (red), error (red), unknown (orange), notapplicable (dark gray), notchecked (dark gray), notselected (dark gray), informational (dark gray), fixed (green), processing (gray) | none | |
| Rule title display | Human-readable rule title with HTML escaping and XCCDF variable substitution | none | |
| Per-rule description expand/collapse | Checkbox per rule toggles visibility of full HTML-formatted rule description | none | |
| Expand / collapse all rules | Toolbar button to expand or collapse all rule descriptions at once | none | |
| Rule result count / progress bar | Progress bar and percentage showing how many rules have been evaluated | none | |
| HTML report in browser | "Show Report" opens HTML report in system default browser via temp `.html` file | web browser | |
| Diagnostics dialog | Timestamped log of info/warning/error/exception messages; auto-pops on errors; color-coded; clipboard copy | none | Includes SCAP Workbench, Qt, and OpenSCAP version |
| Post-scan UI lockout | All pre-scan controls greyed out after scan starts until "Clear" is pressed | none | |
| Clear results | Destroys all scan results and resets to pre-scan state (with irreversibility warning) | none | |
| Benchmark guide viewer | "Show Guide" opens XCCDF benchmark guide HTML in system browser | web browser | |

---

## 6. Remediation

| Feature | User-facing behavior | Special deps | Notes |
|---|---|---|---|
| Online remediation (live) | `--remediate` flag: oscap fixes failures in real time; failed-but-fixed rules show "fixed" | openscap ≥ 0.9.5 | |
| Offline remediation | Takes a saved ARF and applies remediations without re-scanning | none | |
| Generate Bash remediation script | Saves a `.sh` remediation script | none | Pre-scan: all rules in profile; post-scan: only failed rules |
| Generate Ansible playbook | Saves a `.yml` Ansible playbook | none | Same pre/post-scan distinction |
| Generate Puppet manifest | Saves a `.pp` Puppet manifest | none | Same |
| Pre-scan role generation | Generate remediation role for any profile without scanning first | none | Contains all remediations for rules selected by profile |
| Post-scan result-based role generation | Generate role only for rules that actually failed | none | Narrows scope to actual failures |

---

## 7. Tailoring

| Feature | User-facing behavior | Special deps | Notes |
|---|---|---|---|
| Customize / inherit profile | "Customize" button creates a new tailored profile inheriting from selected profile | none | Requires choosing a new profile ID; validated by XCCDF version |
| Profile created from "(default)" | Creates a standalone profile that inherits nothing | none | |
| Profile title editing | Edit the profile's display name | none | |
| Profile description editing | Edit the profile's description | none | |
| Rule select / deselect | Checkbox tree of all benchmark rules and groups | none | |
| Select all / deselect all | Toolbar buttons to check or uncheck all rules at once | none | |
| Group-level selection | Checking a group checks all children recursively | none | |
| Value editing | Combobox for changing XCCDF Value items; type-specific validation (integer, boolean, string) | none | Prohibited if `prohibit_changes` flag is set |
| Value-to-rules dependency map | Shows which rules are affected by changing a given value | none | |
| Undo / redo | Full undo/redo stack for rule changes, value changes, profile title, profile description | none | Consecutive similar changes merge into single undo step |
| Undo history panel | Dock widget showing the full undo history stack | none | |
| Search / find rules | Search box (Ctrl+F); highlights matches, shows "X of Y matches"; turns red if no matches | none | |
| Find next | Steps through search matches | none | |
| Item properties dock | Shows ID, title, type, description for selected item | none | |
| Profile properties dock | Shows/edits profile ID, title, description | none | |
| Expand/collapse state persistence | Tree expansion state saved across sessions (~3 months before auto-expiry) | QSettings | |
| Save tailoring file | Saves to a user-chosen `.xml` file | none | XCCDF 1.1 tailoring shows non-standard warning |
| Discard tailoring | Confirms before discarding; option to also delete profile from tailoring file | none | |
| Profile shadowing option | Tailored profile can replace (shadow) the original using the same ID | none | |

---

## 8. Reporting / Export

| Feature | User-facing behavior | Special deps | Notes |
|---|---|---|---|
| HTML report | Human-readable evaluation report | none | Generated by oscap; OVAL results included |
| XCCDF result XML | Machine-readable results | none | Recommended for archiving |
| ARF (Asset Reporting Format) XML | Complete bundle: input content + OVAL results + SCE results + asset ID + XCCDF results | none | Most complete format |
| Save all into directory | Exports content closure + tailoring into a folder | none | |
| Save as RPM | Packages content + tailoring as an installable RPM | `scap-as-rpm` script | |
| Open report in browser | One-click open of HTML report | web browser | |
| Benchmark guide | "Show Guide" opens XCCDF benchmark guide HTML | web browser | |

---

## 9. Installation / Packaging

| Feature | Notes |
|---|---|
| YUM/DNF package | `yum install scap-workbench` |
| APT package | `apt-get install scap-workbench` |
| Desktop file | `.desktop` for application menu integration |
| AppData XML | Metadata for GNOME Software / packagekit |
| Man page | `scap-workbench(8)` |
| PolicyKit policy | `org.open_scap.scap_workbench.policy` |
| macOS DMG | App bundle via build script |
| Windows installer | WiX `.wxs.in` installer definition |
| Build-time feature flags | Local scan enable/disable, SSG directory, content directory, preferred datastream names |

---

## 10. Cross-Cutting Features

| Feature | Notes |
|---|---|
| User manual (Help menu) | Local HTML user manual from `doc/` directory |
| About dialog | SCAP Workbench version, Qt version, OpenSCAP version |
| Internationalization (i18n) | Locale-specific Qt translation files |
| Cross-platform | Linux, macOS, Windows |
| Capability-gated features | UI features hidden/disabled if installed openscap version is too old |
| Process progress dialog | Real-time console output with cancel for long-running helper operations |
| Native file dialogs | OS-native file picker |

---

## cockpit-scap Gap Analysis

### Matched or Exceeded

| Workbench Feature | cockpit-scap Status |
|---|---|
| SSG auto-detection | ✅ Matched |
| Profile selection + description | ✅ Matched |
| Local scan via oscap | ✅ Matched |
| Scan cancellation | ✅ Matched |
| Real-time scan progress | ✅ Matched |
| HTML report viewer | ✅ Exceeded — IndexedDB bridge handles large reports CSP-compliant |
| Bash remediation download | ✅ Matched |
| Ansible remediation download | ✅ Matched |
| Online remediation (apply fixes) | ✅ Exceeded — Apply Now runs selected-rule bash script with two-gate confirmation, live output streaming, and audit log; more controlled than `--remediate` which blindly applies all |
| Pre-scan role generation | ✅ Exceeded — Full Profile Remediation on all 3 tabs (host, container, tailoring); bash + ansible; tailoring file included when active; descriptive filename from profile name |
| Post-scan result-based role generation | ✅ Exceeded — Selective Remediation Builder allows per-rule selection, not just all-or-nothing |
| Benchmark guide viewer | ✅ Matched — View Compliance Guide on all 3 scan tabs via `oscap xccdf generate guide` |
| Dry-run / CLI preview mode | ✅ Matched — View oscap command collapsible shows full `oscap xccdf eval` command with clipboard copy |
| Diagnostics / log dialog | ✅ Exceeded — Activity Log tab; timestamped record of all user actions; filterable by type; exportable as CSV |
| Tailoring rule tree with checkboxes | ✅ Matched |
| Rule search in tailoring | ✅ Matched |
| Expand / collapse all in tailoring | ✅ Matched |
| Value editing in tailoring | ✅ Matched |
| Save / load / delete tailoring files | ✅ Exceeded — Workbench had no saved file management UI |
| Upload external tailoring file | ✅ Exceeded — not a Workbench feature |
| Tailored scan support | ✅ Matched |
| Scan history | ✅ Exceeded — Workbench had no scan history at all |
| Prerequisite detection | ✅ Exceeded — Workbench assumed packages installed |

### Not Implemented in cockpit-scap (Intentional or Deferred)

| Workbench Feature | cockpit-scap Status | Notes |
|---|---|---|
| Remote SSH scanning | ⬜ Out of scope | Explicit design decision — Cockpit's native multi-host handles this at the platform layer |
| Offline remediation (ARF re-apply) | ⬜ Not implemented | Distinct from Apply Now; no UI surface planned |
| Puppet manifest generation | ⬜ Not implemented | Bash + Ansible only; Puppet market share does not justify the dep |
| Fetch remote resources checkbox | ⬜ Not implemented | `--fetch-remote-resources` flag; low demand for air-gapped target audience |
| 10 result states | ⬜ Partial | We show pass/fail/error/notchecked; remaining states (notapplicable, notselected, informational, fixed, unknown, processing) are collapsed into notchecked |
| ARF export | ⬜ Not implemented | We save results.xml (XCCDF); ARF adds OVAL + asset ID bundle |
| Save content to directory | ⬜ Not implemented | Content closure export; low priority |
| Save as RPM | ⬜ Not implemented | We distribute via COPR; in-app RPM building not planned |
| Undo / redo in tailoring | ⬜ Not implemented | Full undo stack; deferred |
| Value-to-rules dependency map | ⬜ Not implemented | Which rules are affected by a given value change |
| Checklist (component) selector | ⬜ Not implemented | Multi-checklist SDS; all current SSG SDS files have one checklist |
| Capability-gated features by oscap version | ⬜ Not implemented | We assume openscap ≥ 1.3; prerequisite check handles missing binary |
| Profile shadowing option | ⬜ Not implemented | Tailored profile always gets a new ID |
| Profile title / description editing | ⬜ Partial | Profile name editable via inline field in tailoring editor; description not exposed |

### cockpit-scap Has No Workbench Equivalent

| cockpit-scap Feature | Notes |
|---|---|
| Scan history with per-entry report + remediation access | Workbench was session-only; no persistence |
| Tailoring file management (saved files list, edit, delete, upload) | Workbench opened/saved files manually via OS dialog |
| Tailoring files filtered by SDS in scan tab | Workbench had no concept of a tailoring library |
| Container image scanning via oscap-podman | Root Podman store enumeration; per-image history; selective remediation download |
| SDS content library with upload + validation | Upload additional SDS files via browser; validate with `oscap ds sds-validate` |
| Multi-version SDS with cross-version filtering | RHEL 6–10 SDS supported; auto-filters to OS-compatible content |
| Compliance Dashboard | Host compliance hero card; score trend chart (last 10 scans); unified critical findings with automatable annotations; rule detail drawer; container cards |
| Score trend chart | Full-width SVG in dashboard; color-coded by trend direction; hover tooltips |
| Regression / improvement detection | Banner fires when failure count changes vs previous same-profile scan; "See what changed" shows rule-level diff |
| Failing rules summary with CCE and inline description | Collapsible HIGH/MEDIUM/LOW groups; search by title or CCE; Automated/Manual annotation; inline description and rationale |
| Action Board | Severity breakdown (HIGH/MEDIUM/LOW counts) + automatable count on scan complete; Quick Fix and Review All shortcuts |
| Drawer-based remediation panel | Slides in from right; scan results stay fully visible; Esc/backdrop/Close button to dismiss |
| Scan ETA | Elapsed + estimated remaining time during active scans; computed from previous matching scan duration |
| Scan duration and scan ID | `scan_duration_s` and `scan_id` stored in manifest; displayed in results card header |
| Score delta in history | ↑/↓ vs previous same-profile scan inline in history table |
| Selective Remediation Builder | Search, select individual failing rules; download filtered bash or Ansible script; or Apply Now directly on the host |
| Apply Now with two-gate confirmation | Live streaming output; full audit trail in activity log; host-only, admin-gated |
| Settings tab | Scan result retention; tab visibility toggles; Content Library management; Manual Scheduling (cron-paste); Clear All Data |
| Keyboard shortcuts | `/` focuses failing rules search; `Q` triggers Quick Fix; `Esc` closes any open drawer |
| Activity Log | Timestamped record of all user actions; filterable by type; exportable as CSV |
| JSON sidecar for fast tailoring metadata | Internal implementation detail |
| Browser-based (no X11/Wayland/desktop dependency) | By design |
| SELinux enforcing mode support | By design |
| CSP compliance | By design |
| Air-gapped / no CDN dependency | By design |
