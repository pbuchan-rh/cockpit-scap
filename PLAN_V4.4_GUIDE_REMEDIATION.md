# V4.4 Scope: View Compliance Guide + Download Remediation buttons

Status: **planning only — no code written yet.** This document defines scope and
architecture for the next build session. Do not start implementation until this
plan has been reviewed and approved.

## Why

Two buttons from old `main`'s Scan Setup screen never made it into the v4.0
rewrite: **View Compliance Guide** and **Download Remediation**. Peter flagged
this as "low LOE high value polish" after a verbal estimate — this doc turns
that estimate into a real plan, including the one number that estimate was
guessing at (full-profile fix-generation time), now actually measured.

Both buttons are enabled as soon as content + profile are selected — **neither
requires a scan to have been run.** This is different from every fix-download
feature already in `rewrite` (`ScanResults.jsx`'s per-rule and bulk fix
downloads), which are all post-scan, scoped to actually-failing rules from a
completed scan, and only exist once `phase === 'results'`.

## The critical open question, resolved by live measurement

Old `main`'s own code carries this comment (`host-scan.js`/`remediation.js`,
read directly, not assumed):

> "Remediation generation, pruning, and perms run in the background so results
> display immediately after the scan — not after 7-8 min of `oscap generate
> fix`."

That comment describes a **different, unrelated code path**:
`generateRemediation()` in old `main`'s `remediation.js`, which runs
`oscap xccdf generate fix --result-id <id> --tailoring-file ... <b>results.xml</b>`
against a **completed scan's evaluated results**, for both bash and ansible,
under `{ superuser: 'require' }`, unconditionally after every scan. That's the
post-scan remediation-panel feature (permanently cut from this rewrite).

The button being restored here is a **different function entirely**, also in
old `main`: `downloadProfileRemediation()` (`remediation.js`), fired from the
Scan Setup screen's "Download Remediation" split button. It runs:

```
oscap xccdf generate fix --fix-type <bash|ansible> --profile <id> \
  [--tailoring-file <path>] <sdsPath>
```

directly against the **static SCAP content** (no `results.xml`, no
`--result-id`, no scan). Read directly: this call in old `main` already used
plain `cockpit.spawn(args, { err: 'message' })` — **no `superuser: 'require'`,
no background queuing.** Old `main` itself treated this as a fast, synchronous,
foreground action even back then. The "7-8 minutes" caution was never about
this code path.

**Live measurement on rhel10cis, 2026-07-13** (real SSH session, `pbuchan`
user, no `sudo`, against `/usr/share/xml/scap/ssg/content/ssg-rhel10-ds.xml`,
`oscap` 1.4.3):

| Profile | Rules (fix output size) | `generate fix --fix-type bash` | `generate fix --fix-type ansible` | `generate guide` |
|---|---|---|---|---|
| STIG for RHEL 10 | 44,877-line script | — | — | — |
| ACSC ISM Official – Base | 18,384-line script | — | — | — |
| **CIS L2 Server** (largest available, ~300+ rules) | 36,705-line script | **1.01s** | **1.33s** | **2.04s** (5.9 MB HTML) |

(STIG and ISM timed at ~1.1s each for bash fix; full table above trimmed to
the largest profile, CIS L2 Server, since it's the binding case.) All three
runs as plain `pbuchan` (uid 1000), **not root** — see next section.

**Conclusion: synchronous click-and-wait, not background-generate-then-notify.**
Even the largest profile on this content set finishes in ~1-2 seconds. A
simple disabled-button-with-spinner (exactly the pattern old `main`'s guide
button already used: `btn.disabled = true; btn.textContent = 'Generating…'`)
is more than sufficient — no toast/notification/background-job machinery
needed. Recommend keeping a small safety margin in copy ("this may take a few
seconds") rather than old `main`'s "15–20 seconds" guide-button estimate,
which itself was already conservative relative to the measured 2.04s for
guide generation — the actual bottleneck in the old comment was the
unrelated `--result-id` post-scan path, not `--profile`-based static
generation.

**Supplementary confirmation** (not required for the recommendation above,
run out of curiosity to fully explain old `main`'s comment): also ran a real
`oscap xccdf eval` against the `cis` profile on rhel10cis, then timed
`oscap xccdf generate fix --result-id <id> results.xml` (old `main`'s actual
background-path command) against the resulting `results.xml` — **0.74s**.
Fix generation is fast in *every* form (`--profile` against static content or
`--result-id` against evaluated results). The real time sink in old `main`'s
pipeline was the `xccdf eval` scan itself (real OVAL probes against a live
system — package/file/service checks — genuinely can run long on some
profiles/hosts), not `generate fix`. That's irrelevant here anyway, since
neither new button ever runs `xccdf eval`.

## Superuser: confirmed unnecessary for both buttons

Live-verified, not assumed:

```
$ ssh rhel10cis 'ls -la /usr/share/xml/scap/ssg/content/'
-rw-r--r--. 1 root root 22090066 ... ssg-rhel10-ds.xml
$ ssh rhel10cis id
uid=1000(pbuchan) gid=1000(pbuchan) ...
```

SSG content is world-readable (644, root:root) — no escalation needed to read
it. Tailoring files under `~/SCAP/tailoring/` are owned by the invoking user
(chmod 600, per `lib/tailoring.js`) — the user can already read their own
files without escalation. Both commands above ran to completion as plain
`pbuchan`, no `sudo`, no cockpit superuser bridge.

This matches the architecture direction already adopted in this rewrite
(`edb9f9b`, "stop requiring superuser for writes into the user's own
homedir") and the existing `superuser: 'try'` (not `'require'`) used by
`readTailoringXml()`/`listTailoringFiles()` in `lib/tailoring.js` — those
already assume "may or may not be escalated, either way it should work."

**Design decision: both new `lib/oscap.js` functions run with no `superuser`
option at all** (plain `cockpit.spawn(args, { err: 'message' })`), same as
old `main`'s own `onViewGuideClick()`/`downloadProfileRemediation()`. This is
a deliberate difference from `readResults()`/`generateFix()` (existing,
post-scan) which use `{ superuser: 'require' }` — but only because those
read out of the root-owned `/tmp/cockpit-scap-XXXXXX` tmpdir created by
`makeTmpdir()`'s `{ superuser: 'require' }` `mktemp`, not because `oscap`
itself needs privilege. The new buttons never touch that tmpdir.

**Consequence worth calling out explicitly**: because neither button needs
superuser, they should **not** be gated behind `adminAllowed` the way "Run
Scan" is. Today `ScanSetup.jsx`'s `canScan` includes `adminAllowed &&` and
`app.jsx` shows an "Administrative access required" banner when unlocked
admin is unavailable — none of that applies to these two buttons. A user who
hasn't unlocked "Administrative access" should still be able to view a
compliance guide and download remediation scripts. This is a real, positive
behavior difference from Run Scan, not an oversight — flag it in the build
session so it isn't accidentally copied from `canScan`'s gating.

## Feature 1: View Compliance Guide

**Command** (old `main`'s `onViewGuideClick()`, ported as-is):

```
oscap xccdf generate guide --profile <profileId> \
  [--tailoring-file <path> --profile <tailoring's base_profile_id>] \
  <sdsPath>
```

Note the tailoring case re-passes `--profile` with the tailoring's
**base** profile id (the tailoring's own extends-target), exactly as old
`main` did — this isn't a bug to "fix," it's how `oscap` resolves a tailoring
profile against the base Benchmark.

**Delivery mechanism — reuse and share, don't duplicate.** `ScanResults.jsx`'s
`handleViewReport()` (lines 253-276) already solves "open a same-origin popup
synchronously, then hand it oscap-generated HTML via IndexedDB + `viewer.html`"
— this exists specifically because a `blob:` URL popup inherits a stripped CSP
that blocks the report's inline `<style>`/`<script>` (see `de91aa7`, "View
Report opens with real oscap styling, not stripped HTML"). The new guide
button needs the identical mechanism, just fed by an async `cockpit.spawn()`
result instead of already-in-memory `reportHtml`.

Proposed factoring — new `src/lib/reportViewer.js`:

```js
// Opens a same-origin popup now (synchronous, avoids popup-blocker), then
// resolves htmlPromise and hands the HTML off via IndexedDB to viewer.html,
// which gets Cockpit's real page CSP (blob: popups don't).
export function openReportViewer(htmlPromise) {
    const popup = window.open('about:blank', '_blank');
    const viewerUrl = new URL('viewer.html', window.location.href).href;
    if (!popup) return; // popup blocked — caller already surfaced this state via disabled button

    htmlPromise.then(html => {
        const blob = new Blob([html], { type: 'text/html' });
        const req = indexedDB.open('cockpit-scap', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('reports');
        req.onerror = () => popup.close();
        req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('reports', 'readwrite');
            tx.objectStore('reports').put(blob, 'current');
            tx.oncomplete = () => { db.close(); popup.location = viewerUrl };
        };
    }).catch(() => popup.close());
}
```

- `ScanResults.jsx`'s `handleViewReport()` becomes
  `() => openReportViewer(Promise.resolve(reportHtml))`.
- The new guide button becomes
  `() => openReportViewer(generateGuide(content, profileId, tailoring))`,
  where `generateGuide()` is a new `lib/oscap.js` export wrapping the spawn
  above.
- `viewer.html`/`viewer.js` need no changes — already same-origin,
  IndexedDB-based, CSP-safe.

**Placement/gating**: `ScanSetup.jsx`'s `CardFooter`, next to "Run Scan".
Enable condition: `content && (selectedTailoring || profile)` — same
data-availability check `canScan` already computes, minus the `adminAllowed &&`
and `!loadingProfiles` clauses (loading-profiles doesn't block this the same
way, since there's no scan about to start — though leaving `!loadingProfiles`
in is harmless and arguably still correct: no point enabling before the
profile list settles).

**Button state while generating**: disable + spinner (PatternFly
`isLoading`/`isDisabled` on the `Button`, same convention as `ScanResults.jsx`
already uses for its per-fix-type download buttons), not old `main`'s manual
`textContent` swap — this app already has the PF6 idiom for it.

## Feature 2: Download Remediation

**Command** (old `main`'s `downloadProfileRemediation()`, ported):

```
oscap xccdf generate fix --fix-type <bash|ansible> --profile <profileId> \
  [--tailoring-file <path>] <sdsPath>
```

**UX**: synchronous click → spinner → blob download, per the timing
conclusion above. New `lib/oscap.js` export, e.g.:

```js
export async function generateProfileFix(sdsPath, profileId, tailoringPath, fixType) {
    const args = ['oscap', 'xccdf', 'generate', 'fix', '--fix-type', fixType, '--profile', profileId];
    if (tailoringPath) args.push('--tailoring-file', tailoringPath);
    args.push(sdsPath);
    return cockpit.spawn(args, { err: 'message' });
}
```

then `downloadBlob()` the result exactly as `ScanResults.jsx` already does for
its bulk fix download.

**Two-button pair, not a PatternFly `Dropdown`.** Old `main` used a caret
split-button (`ct-dl-dropdown` / `ct-profile-rem-menu`, custom CSS, manual
open/close/outside-click JS) with three options: Bash, Ansible, Puppet. This
rewrite has **no `Dropdown`/`MenuToggle` usage anywhere** — grepped, zero
hits. Every existing bash/ansible pair in this codebase (`ScanResults.jsx`'s
`CardHeader` actions, `FailingRuleRow`'s per-rule fix download) is just two
adjacent `Button`s in a `Flex`. Recommend the same here: "Download Bash Fix" /
"Download Ansible Fix" as two plain buttons next to "Run Scan" and "View
Compliance Guide" — consistent with the app's established convention, no new
dropdown/menu component to build, style, or test for outside-click handling.

**Open question for Peter — Puppet fix-type**: old `main`'s Scan Setup screen
offered three fix types (bash/ansible/puppet); `ScanResults.jsx`'s existing
post-scan fix download already only offers two (bash/ansible) — Puppet was
implicitly dropped somewhere earlier in the rewrite, undocumented. Live-tested
just now: `oscap xccdf generate fix --fix-type puppet` still works fine
against current SSG content (generated a 100-line manifest for the `e8`
profile without error) — this isn't a dead fix-type, oscap still supports it.
Recommend: **stay at two (bash/ansible)**, matching `ScanResults.jsx`'s
already-established scope rather than reopening a three-way split-button
just for this one screen — but this is a real scope reduction from old `main`
worth Peter explicitly confirming rather than silently deciding.

**Filename**: old `main` used `profile-remediation-<slugified-profile-title>.<ext>`
(`.sh` / `-ansible.yml`). Recommend keeping that convention here rather than
`ScanResults.jsx`'s per-rule `fix-<cce-or-id>.<ext>` pattern — this is a
whole-profile download, the old naming already communicates that.

**Placement/gating**: same `CardFooter` row, same enable condition as the
guide button (`content && (selectedTailoring || profile)`, no `adminAllowed`).

## Layout: all three in one `CardFooter` row

Old `main`'s row was: `Run Scan | View Compliance Guide | Download
Remediation ▼` (single split-button for the third slot). This rewrite's
`ScanSetup.jsx` `CardFooter` today holds only "Run Scan" alone. Adding "View
Compliance Guide" + two fix-type buttons makes four buttons in one row instead
of one.

Checked against the recent visual-polish work (`44cd73e` "fix stacked
Actions-column buttons", `5bcd879` "link-button underline + action-cell
spacing polish", both about `ct-actions-cell` Table rows, not `CardFooter`
button rows — different surface, not directly reusable spacing rules, but the
same general instinct applies: don't let a button row wrap awkwardly).
Recommend `Flex` with `flexWrap: 'wrap'` and `spaceItemsSm` in `CardFooter`
(mirroring the wrapping-safe pattern in `ScanResults.jsx`'s `CardHeader`
actions), primary "Run Scan" first, then the two secondary/tertiary actions —
this degrades gracefully on narrow viewports instead of a hard 4-across row.
**Recommend visually grouping the two fix-type buttons** (e.g. tighter
`spaceItemsXs` between them, normal `spaceItemsSm` gap before/after) so they
read as "one action, two formats" rather than three independent peers,
approximating old `main`'s split-button grouping without an actual dropdown
widget.

## Data footprint

None. Both commands read only already-on-disk SCAP content (world-readable)
and, optionally, an already-saved tailoring file (user-owned). Guide HTML is
handed to the browser via the existing IndexedDB scratch store (already
used, already cleared per-use via `store.delete('current')` in
`viewer.js`). Remediation output is a client-side blob download, never
written to disk by the app. No new homedir paths, no new SELinux surface, no
new `~/SCAP/` subdirectory.

## Out of scope, not designed here

- **Uploaded-content warning banner** ("Remediation from uploaded content...
  staged in /var/lib/cockpit-scap/content/, review carefully") — depends on
  `PLAN_V4.3_CONTENT_UPLOAD.md`, being written in a separate worktree, not
  landed yet. Once V4.3 ships, both new buttons will need a conditional
  banner when `content` isn't an auto-detected SSG path — flagged here as a
  known future integration point, not designed now.
- Any `src/` code changes — this session is docs-only.
- Activity-log integration (`appendActivityLog()` calls in old `main`'s
  `onViewGuideClick()`/`downloadProfileRemediation()`) — activity log is
  permanently cut from this rewrite, not being resurrected for this.

## Minor drive-by opportunity (not required for V4.4)

`downloadBlob()` is currently copy-pasted identically in `ScanResults.jsx`
and `ScanHistory.jsx`, plus a differently-named `downloadXml()` in
`TailoringList.jsx` doing the same thing with a different MIME type. The new
Download Remediation button would be a fourth copy. Worth factoring into a
shared `lib/download.js` at some point — noting it here since this plan adds
another call site, but not blocking V4.4 on it; can be done as a trivial
follow-up or folded into the V4.4 build session if the build session wants to
knock it out while touching these files anyway.

## Open questions for Peter

1. **Puppet fix-type**: drop it (match `ScanResults.jsx`'s existing
   bash/ansible-only scope) or restore all three from old `main`? Recommend
   dropping, but this is a real scope reduction from old `main`, not a
   no-brainer.
2. **Button grouping treatment**: plain two-button pair (recommended, matches
   existing convention) vs. investing in a real PatternFly `Dropdown` split
   button to visually match old `main`'s single "Download Remediation ▼"
   control more closely? Recommend the plain pair for consistency and lower
   LOE, but flagging since it's a visible UI choice, not just an
   implementation detail.
3. **`downloadBlob()` triple-duplication**: fold the dedup into this build
   session (touches 4 files instead of 3, small extra diff) or leave as a
   separate follow-up? No strong recommendation either way.

## Next step

Get this plan reviewed and approved. Once approved, open a separate build
session (scaffolding + component code) — per established practice, planning
sessions produce docs only, implementation is a distinct, separately-approved
step.
