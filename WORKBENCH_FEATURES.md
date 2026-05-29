# SCAP Workbench — Feature Reference

**Source:** Analysis of OpenSCAP/scap-workbench GitHub repository (archived September 2024)  
**Purpose:** Feature reference for cockpit-scap gap analysis and future TUI tool design  
**Last updated:** 2026-05-29

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
| Remote SSH scanning | ⬜ Out of scope | Explicit design decision — v1 local only |
| Online remediation (`--remediate` live) | ⬜ Deferred | Apply Remediation stubbed; significant risk |
| Offline remediation (ARF re-apply) | ⬜ Not implemented | Distinct from online; no UI surface |
| Pre-scan role generation | ⬜ Not implemented | Workbench could generate fix scripts without scanning |
| Puppet manifest generation | ⬜ Not implemented | Bash + Ansible only |
| Post-scan result-based role generation | ⬜ Partial | We generate for all failures, not configurable |
| Benchmark guide viewer | ⬜ Not implemented | "Show Guide" — opens XCCDF HTML guide |
| Dry-run / CLI preview mode | ⬜ Not implemented | Show oscap command without executing |
| Fetch remote resources checkbox | ⬜ Not implemented | `--fetch-remote-resources` flag |
| 10 result states | ⬜ Partial | We handle pass/fail/error/notchecked (4 of 10) |
| Per-rule description expand/collapse | ⬜ Deferred | Rule results table deferred to v2 |
| Diagnostics / log dialog | ⬜ Not implemented | Timestamped error log with clipboard copy |
| ARF export | ⬜ Not implemented | We save results.xml (XCCDF), not ARF |
| Save content to directory | ⬜ Not implemented | Content closure export |
| Save as RPM | ⬜ Not implemented | Packaging helper |
| Undo / redo in tailoring | ⬜ Not implemented | Full undo stack |
| Value-to-rules dependency map | ⬜ Not implemented | Which rules does this value affect? |
| Checklist (component) selector | ⬜ Not implemented | Multi-checklist SDS support |
| File watcher / reload | ⬜ Not implemented | Not applicable to web context |
| RPM content loading | ⬜ Not implemented | Not applicable to web context |
| Capability-gated features by oscap version | ⬜ Not implemented | We assume a sufficiently modern openscap |
| Profile shadowing option | ⬜ Not implemented | |
| Profile title / description editing | ⬜ Not implemented | Profile metadata editable in tailoring |

### cockpit-scap Has No Workbench Equivalent

| cockpit-scap Feature | Notes |
|---|---|
| Scan history with per-entry report + remediation access | Workbench was session-only; no persistence |
| Tailoring file management (saved files list, edit, delete, upload) | Workbench opened/saved files manually via OS dialog |
| Tailoring files filtered by SDS in scan tab | Workbench had no concept of a tailoring library |
| JSON sidecar for fast tailoring metadata | Internal implementation detail |
| Browser-based (no X11/Wayland/desktop dependency) | By design |
| SELinux enforcing mode support | By design |
| CSP compliance | By design |
| Air-gapped / no CDN dependency | By design |
