# V4.5 Scope: Apply Now (online/live in-app remediation)

Status: **implemented on `v4.6-v3-flow`, 3e664f9..885283d (2026-10-15)**, plus the docs commit that sets this line, per
the "Amendments (2026-10-15)" section at the end, which overrides the older
text. Not merged to `rewrite`, no RPM yet. See "Implementation notes" at the
very end for where the build differs from the sketch.

## Why

The 2026-07-15 workbench-parity review (`WORKBENCH_FEATURES.md`) found one
substantive remaining gap between `rewrite` and both scap-workbench and old
`main`: there is no way to actually *run* a remediation fix on the host from
inside the app. `ScanResults.jsx` already lets you preview and download a
bash/ansible/puppet fix script for one or many failing rules — but applying
it means downloading the file and running it yourself, outside Cockpit. Old
`main` had a real "Apply Now" flow (two-gate confirmation, live streaming
output, a persisted log) that never made it into the rewrite. This was
flagged as an open, undecided item back on 2026-07-07 ("remediation panel")
and is now the clearest remaining gap vs. workbench.

## The scope is smaller than it looks — most of the hard part already exists

Read old `main`'s actual implementation (`src/remediation.js`,
`onApplyNowClick`/`onApplyGate1Proceed`/`onApplyGate2Execute`) rather than
guessing at the shape of this feature. Its three-step flow:

1. User checks specific failing rules in a selection UI → **Gate 1**: confirm
   which rules, "Proceed."
2. Gate 1 Proceed generates the actual filtered bash script server-side
   (`python3 -c PY_FILTER_FIX <remediation.sh> bash <rule-ids>`, `superuser:
   'require'`) and shows the full script text + rule list in **Gate 2**:
   "Apply" or "Cancel."
3. Gate 2 Apply writes the script to a temp path as root
   (`cockpit.file(path, {superuser:'require'}).replace(script)`), then runs
   it with `cockpit.spawn(['bash', path], {superuser:'require', err:'out'})
   .stream(...)`, streaming stdout live to the UI. On completion (success or
   failure), persists a log file + fires a `logger -t cockpit-scap` syslog
   entry, then deletes the temp script.

**Steps 1 and most of step 2 are already built and proven in `rewrite`.**
`ScanResults.jsx` already has per-rule checkbox selection
(`selectedRuleIds`, a `Set`), and `lib/oscap.js`'s `generateScopedFix(sdsPath,
tailoringPath, ruleIds, fixType)` already generates a correctly-scoped script
for an arbitrary rule-ID set and fix type — this is the exact same
capability as old `main`'s `PY_FILTER_FIX` step, already live-verified
byte-identical to a reference call (the 2026-07-14 `--rule`-flag bugfix).
**What's actually missing is narrow: an Execute step, a confirmation
sequence, live output display, and a log record.**

The execution mechanism itself also isn't new territory for this codebase —
`lib/oscap.js`'s scan runner already does `cockpit.spawn(args, {superuser:
'require', err: 'out'}); proc.stream(chunk => ...)` for the live scan itself.
Apply Now would reuse the identical pattern against a different script.
`Modal` (PatternFly) is already used in five components for confirmation
dialogs (`ScanHistory.jsx`, `ContentUploadCard.jsx`, `TailoringList.jsx`,
`ScanSetup.jsx`, `TailoringEditor.jsx`) — no new dependency for the two-gate
flow, just two more modals following the existing pattern.

## Proposed flow

Lives in `ScanResults.jsx`, next to the existing per-rule/bulk fix-download
UI — **not** a new tab or panel. Scope: **selective, post-scan only**,
matching old `main` exactly. This is deliberate: Apply Now only ever applies
fixes for rules a real scan just confirmed are actually failing on this
host, never a blind pre-scan "run every fix in this profile" action. That
distinction is a real safety property, not an arbitrary restriction — don't
widen it to `ScanSetup.jsx`'s pre-scan buttons without a separate
conversation.

1. Selecting one or more failing rules (existing checkbox UI) enables a new
   **"Apply Now"** button alongside the existing Download buttons.
2. **Gate 1** (`Modal`): "Apply N fixes to this host?" + the rule titles
   list. Proceed / Cancel.
3. Proceed calls `generateScopedFix(..., 'bash')` (already exists, no new
   `lib/oscap.js` logic needed for this step) and opens **Gate 2**: full
   script text in a `<pre>` (same pattern already used for the per-rule Fix
   preview), same rule list, "Apply" / "Cancel." This is the last point a
   user can back out having actually seen the exact commands about to run.
4. Apply writes the script to a true root-only temp path (see below), runs
   it via the proven `spawn+stream` pattern, streams output live into an
   expandable area (reuse the live-scan-output component/pattern if one
   exists, otherwise a simple auto-scrolling `<pre>`), shows a clear
   success/failure state with exit code on completion, deletes the temp
   script unconditionally (success or failure) in a `finally`-equivalent.
5. Bash only for v1 — old `main`'s Apply Now was bash-only too (Gate 1 always
   requested `'bash'` from `PY_FILTER_FIX`, never ansible/puppet). No reason
   to widen this now; downloading an ansible/puppet script for manual
   apply-elsewhere already covers that use case.

## Temp script location — cleaner than old `main`'s approach

Old `main` wrote the executable script under the shared, root-owned scan
results directory (`remediationDir + 'remediation-apply.sh'`), a holdover
from its pre-homedir-rewrite storage model. That path doesn't exist in
`rewrite`'s architecture. Since the script is root-created, root-executed,
and deleted immediately after in the same flow, **it never needs to touch
`~/SCAP/` at all** — recommend a genuine root-only temp path (`mktemp` under
`/root` or `/tmp`, `superuser: 'require'` for every step touching it, same
pattern `lib/oscap.js`'s `makeTmpdir()` already uses for scan temp files).
Cleaner than old `main`, and adds zero new surface under the user's homedir
— no new SELinux question, no new `~/SCAP/` subdirectory, consistent with
V4.4's "no data footprint" finding for the guide/remediation-download
buttons.

## Open question: what does "audit" mean here, given Activity Log is cut?

This is the one real product decision this plan can't make unilaterally.
Apply Now runs root-privileged commands that **modify live system state** —
categorically different risk from every other feature in `rewrite`, which
are all read-only or write only into the user's own `~/SCAP/`. Old `main`
had three audit layers: a full searchable Activity Log tab (permanently cut,
Peter's own call, staying cut — not up for debate here), a persisted
per-run log file, and a `logger -t cockpit-scap` syslog entry.

**Recommend keeping the latter two, dropping only the Activity Log tab
integration:**
- `logger -t cockpit-scap` — trivial, standard practice for any tool that
  runs privileged commands, lands in `journalctl`/syslog where an admin or
  SIEM would already look for this. No new storage, no new UI.
- A persisted per-run log (script + full output + exit code + timestamp +
  user + which rules) — recommend `~/SCAP/scans/<timestamp>/remediation.log`
  alongside that scan's existing `manifest.json`/`report.html`/`results.xml`
  rather than old `main`'s separate log directory, so it's covered by the
  same delete-the-scan-directory cleanup Scan History already has, no new
  retention question to answer.

This needs Peter's explicit sign-off, not an assumption — dropping *all*
logging would mean a root command ran against production infrastructure
with literally no record beyond whatever's on-screen at the time, which
feels wrong for a compliance tool specifically. But rebuilding the full
Activity Log tab UI just for this one feature would also directly contradict
the standing "we don't need the activity audit log" decision. The proposal
above tries to thread that — flagging it explicitly rather than picking
silently.

## Out of scope, not designed here

- Pre-scan / whole-profile blind apply (workbench's `--remediate` flag) —
  deliberately not restoring this; selective post-scan-only is the safer,
  already-proven-in-old-`main` shape.
- Ansible/puppet execution — download-only for those formats remains
  unchanged; only bash gets an Execute path, matching old `main`.
- Any `src/` code changes — this session is docs-only.
- Container scan integration — container scanning is permanently cut from
  this rewrite; Apply Now is host-scan-only by construction.
- Applying from a scan pulled out of History (vs. a scan just run this
  session) — see open question below.

## Decisions locked in with Peter (2026-07-15)

All three open questions resolved, the recommended option in each case:

1. **Audit logging: syslog + per-scan log file.** `logger -t cockpit-scap`
   entry plus `~/SCAP/scans/<timestamp>/remediation.log` (script + full
   output + exit code + timestamp + user + rule IDs applied), alongside that
   scan's existing `manifest.json`/`report.html`/`results.xml` — covered by
   the same delete-the-scan-directory cleanup Scan History already has, no
   new retention question, no Activity Log tab resurrection.
2. **Available from Scan History, not just a live scan.** `generateScopedFix()`
   already handles "content no longer exists" as an error case (same as
   today's Download Fix from History) — no new error-handling surface, just
   reusing an existing path.
3. **One-off inline `<pre>` for live output**, not a reusable component. No
   second consumer exists yet; generalize later if one shows up.

## Next step

Plan approved, no open questions remaining. Ready for a separate build
session (scaffolding + component code) whenever Peter wants to schedule it —
per established practice, planning sessions produce docs only,
implementation is a distinct, separately-approved step.

## Amendments (2026-10-15): refresh for the V4.6 Remediation Builder

Approved 2026-10-15. Peter delegated the plan review ("if you fully test
and agree"), and Claude reviewed and agreed this refresh. It overrides the
matching text above wherever they differ. The 07-15 decisions still stand:
selective, post-scan only, bash only, syslog + per-scan log, available
from Scan History.

1. **Where it lives.** It goes in the V4.6 Remediation Builder drawer
   (`RemediationBuilder.jsx`, the placeholder comment in
   `.ct-builder-actions`), not `ScanResults.jsx`. Add a danger button,
   **"Apply now"**, placed first, before Download Bash script / Download
   Ansible playbook. It is enabled when at least one rule is selected and
   nothing else is busy.
2. **ONE confirm dialog, not two gates** (Peter, spec C: "merge the 2
   Apply confirms into 1"). The script is generated when the dialog opens,
   so what the user can inspect is exactly what runs. The dialog shows:
   - A danger warning: the fixes run as root and change this host; some
     (bootloader, SELinux, kernel arguments, mount options) only take
     effect after a reboot; fixes are not undone automatically.
   - The host name, plus the scan the fixes come from, with its date and
     age (for example "Scan of Oct 14, 6:04 PM (1 day ago)"). A fresh scan
     reads "just now". The same results screen serves a fresh scan and
     History → View, so there is no special History mode.
   - The selected rule titles with their severity.
   - A collapsed "View script" disclosure holding the full generated
     script.
   - Buttons: **Apply** (danger) and Cancel. Apply stays disabled until
     the script has been generated. A generation error shows inline, with
     no Apply.
   If the generated script is empty (`isEmptyFix`), show the existing
   "Empty remediation" notice and never offer Apply.
3. **Admin access.** Apply now needs Cockpit administrative access. Without
   it the button is aria-disabled with the same tooltip pattern as Run Scan
   (e8f4051), and nothing ever prompts for a password mid-flow.
4. **Execution survives closing the page.** With a plain `cockpit.spawn`,
   the process dies when the channel closes (the user navigates away, the
   tab closes, or the session ends) and leaves a half-applied host.
   Instead:
   - Write the script to a root-only temp dir (`makeTmpdir()` pattern).
   - Run it as a transient unit:
     `systemd-run --unit=cockpit-scap-remediate-<stamp> --collect
     --property=Type=oneshot ... bash <script>`, with stdout and stderr
     going to a root-only output file in the same temp dir.
   - The UI follows that output file live (`tail -f` via spawn, or polling)
     and gets the exit code from `systemctl show -p ExecMainStatus` /
     `Result`, or from a wrapper that writes the status to a file.
   - When the page loads while a `cockpit-scap-remediate-*` unit is
     active, show an inline info alert: "A remediation is running on this
     host (started HH:MM)", with a link that reopens the live output.
   - Clean up the temp dir at the end, whatever the outcome.
   - There is no "cancel mid-run" button in v1, because killing a
     half-applied fix is worse than letting it finish. The dialog says this
     plainly.
5. **Running and done states.** Once Apply is pressed, the dialog becomes
   the progress view: live auto-scrolling output in a `<pre>`, and an
   elapsed time. The dialog can be closed while the run continues, and the
   alert in item 4 brings it back. On completion it shows success (exit 0)
   or failure (exit code), and offers:
   - **"Rescan to verify"**: starts a new scan with the same content,
     profile and tailoring as the source scan.
   - **"Download log"**.
   - Close.
   Disable Apply now and Run Scan while a remediation unit is active, and
   disable Apply now while a scan is running.
6. **Audit.**
   - `logger -t cockpit-scap`: one line at start and one at end, giving
     the user, host, profile, source scan id, rule count, unit name, and at
     the end the exit code.
   - Per-run log written AS THE USER (not root) to
     `~/SCAP/scans/<source-scan>/remediation-<ISO stamp>.log`. It holds the
     header (user, time, profile, content, tailoring, rule ids), the full
     script, the full output and the exit code. A new file per run, never
     overwritten.
   - Scan History's delete already removes the scan directory, so these
     logs go with it. The History row shows nothing new in v1.
7. **Offline remediation is not a separate gap.** Items 1 and 2 plus the
   07-15 decision 2 already re-apply fixes from a saved scan. Strike the
   "Offline remediation" line from "Out of scope" above, and update the
   matching row in WORKBENCH_FEATURES.md. The remaining difference from
   Workbench: `oscap xccdf remediate` marks rules "fixed" in the ARF, and
   cockpit-scap uses "Rescan to verify" instead, on purpose.
8. **Testing (safety).** Click Apply only on the disposable host
   `scap-apply10.beastmode.localdomain`. The spec must refuse to run unless
   `COCKPIT_URL`'s host is scap-apply10. Never apply on rhel10cis or
   scap-test10 (Peter's review VM). Cover:
   - Happy path on two or three low-risk failing rules (for example a
     sysctl rule and a banner/login-defs rule). Rescan, then confirm those
     rules pass.
   - Empty-fix rule: no Apply offered.
   - A forced failing script: shows the exit code and still writes the log
     plus both syslog lines.
   - Non-admin: the button is disabled.
   - Reload the page mid-run: the run continues, the alert appears, and
     the output reattaches.
   - Apply from History → View of an older scan: the age is shown.
   - The log file is owned by the user, and the temp dir is gone
     afterwards.

## Implementation notes (2026-10-15, v4.6-v3-flow)

- Code: `src/lib/remediate.js` (runner, unit discovery, result collection),
  `src/components/ApplyNow.jsx` (the dialog, the page alert,
  `useRemediationRun()`), the Apply now button in
  `RemediationBuilder.jsx`, wiring in `app.jsx`. Spec:
  `tests/v46-apply-now.spec.js`, guarded by `tests/helpers/apply-host.js`
  (refuses any host but scap-apply10).
- Item 4, output redirection: `-p StandardOutput=file:<dir>/output.log`
  fails on RHEL 10.2 (status 209/STDOUT, Permission denied: PID 1 may not
  open a file in the user_tmp_t dir `sudo mktemp` creates). The runner
  redirects its own stdout/stderr (`exec >"$dir/output.log" 2>&1`) instead.
  `--no-block` is added so systemd-run returns at once for a oneshot unit.
- Item 4, exit status: the runner records it (exit-status file and the
  log's "Exit code:" line); `systemctl show` is only used to tell running
  from gone, because `--collect` unloads the unit as soon as it ends.
- Item 6, the per-run log is written by the unit's runner, not by the
  page, as the user (`setpriv --reuid/--regid --init-groups`, umask 077,
  noclobber), so the log and both syslog lines exist even when no page is
  open at the end. The page reads it back (no superuser). If that write
  fails, the runner keeps the temp dir and logs that to syslog; the page
  then shows the output from the temp dir, warns, and removes the dir.
- Apply now is also disabled, with a tooltip, for a results page whose
  scan is not in Scan History (the save failed), since the log would have
  nowhere to go. "Disable Apply now while a scan is running" needs no
  extra code: the Builder only exists on the results page.
