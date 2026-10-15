# V4.6 Scope: v3's look and flow on the rewrite's engine

Status: **planning only — no code written yet.** Do not start implementation
until Peter has approved this plan. Build stops at the checkpoint after
Phase 3 and waits for Peter.

## Why

On 2026-10-14 Peter reviewed the rewrite hands-on (fresh RHEL 10.2 host,
RPM build of `rewrite`) side by side with v3.10 (old `main`, "SCAP
Compliance" on rhel10cis). His verdict matches the 2026-10-10 usability
review (`USABILITY-1.md`, branch `usability-review-1`): **keep the rewrite's
engine** (per-user `~/SCAP` storage, on-demand fix generation, tailoring
tree, PF6/React stack) and **bring back v3's look and flow**, screen by
screen. Peter's own words are quoted under each spec below; they are the
acceptance bar, not decoration.

The yardstick for every feature is Peter's scope statement: the module
"fills a small need, pointed and focused in one area: harden a box and scan
it."

Sources (read before starting):
- `~/scap-handover/PETER-REVIEW-2026-10-14.md` on claude2: the raw review
  notes this plan is built from.
- `~/scap-handover/COMPARISON-v3-vs-rewrite.md` (cited **C§n**): bugs,
  per-task flow, storage facts.
- `USABILITY-1.md` on branch `usability-review-1` (cited **R/V n**): ranked
  findings, measurements, screenshots in `tests/usability-shots-1/`.
- v3 source on `main` for every screen being ported (`index.html`,
  `style.css`, `host-scan.js`, `remediation.js`, `tailoring.js`). Read the
  real v3 implementation; do not reconstruct it from screenshots.
- `~/Projects/cockpit/PATTERNS.md` and `~/Projects/cockpit/CLAUDE.md` (house
  layout rule: transparent container, gray page background is the panel).

## Ground rules

- Branch `v4.6-v3-flow` off `rewrite`@`aeaf590`. Push to **Gitea `origin`
  only**. Never push to the `github` remote (the repo is public). Never
  commit screenshots.
- Test host: **scap-test10.beastmode.localdomain** (10.0.0.199, RHEL 10.2,
  oscap 1.4.4, SSG 0.1.81). It has the RPM
  `cockpit-scap-4.0.0.60.gaeaf590` installed and **Peter's own data**
  (uploaded ssg-rhel8/9 content, policy `RHEL9_CIS2_DMZ_WEB`, his scans).
  Never delete or edit Peter's data. Tag everything you create with
  `v46-test` in its name and delete it before you finish.
- Do not touch the installed RPM. Deploy work-in-progress only as dev
  copies under `~pbuchan/.local/share/cockpit/` with a **different
  directory name and manifest label** (see Checkpoint), so the RPM stays
  visible next to it.
- Reference host: rhel10cis (10.0.0.184) has v3 as "SCAP Compliance".
  Read-only. **Never click Apply Now / Proceed** on either host.
- Every phase: `npm run build`, eslint, stylelint clean; Playwright specs for
  that phase pass in **Chromium and Firefox, both inside the Cockpit shell**
  (`/scap-dev`, not the direct module URL; the direct URL is how the
  Firefox download bug went unseen, C§1b). Commit per logical change.
- Colors only from PF tokens. No hard-coded hex. Light and dark (Cockpit
  Session → Style: Dark and OS dark) must both work (v3 failed this, V4).
- Text weight is **not** decided here (see Checkpoint). Build with PF
  defaults and keep weight overrides in one place (`app.scss`, one class on
  the root) so the A/B is a one-line switch.

## Phase 1: correctness (no visual change)

Wrong output first, then polish.

1. **Rule-scoped fixes use the wrong variable values** (C§1c-1).
   `generateScopedFix` builds a standalone profile with no `extends`, so the
   profile's `refine-value`s are dropped (CIS L1: minlen 15 vs 14, faillock
   deny 3 vs 5, remember 5 vs 24 ...). Fix: the ephemeral profile
   **extends the scan's actual profile** (tailored profile id + tailoring
   file when the scan used one) and explicitly deselects every rule not
   wanted (`<select idref=... selected="false"/>` for all other rule ids
   from the results file), so oscap keeps the profile's values. If that
   proves unworkable, generate from the saved results with `--result-id`
   and filter by rule in JS (bash: per-rule `BEGIN fix ... END fix` blocks;
   check Ansible separately). Either way:
   - **Acceptance:** for a CIS L1 scan and for a tailored scan with a
     `set-value`, every variable in a scoped bash and Ansible fix equals the
     value in `oscap xccdf generate fix --profile <same profile>
     [--tailoring-file]` for the same rules. Write this as a spec that runs
     oscap on the host and diffs the values.
2. **Setup-page guide and remediation ignore the tailoring** (C§1c-2).
   `ScanSetup.jsx` passes `base_profile_id` with `--tailoring-file`. Pass the
   tailored `profile_id`. **Acceptance:** with a tailoring that deselects
   rules, the guide no longer lists them and the fix count drops (C§1c-2
   measured 509 vs 505).
3. **Downloads silently fail in Firefox inside the shell** (C§1b, both
   versions). Blob `<a download>` is blocked by the shell CSP in Firefox.
   Spike first: write the generated file to a user temp file, download it
   through Cockpit's external channel (`/cockpit/channel/<csrf>?<base64
   open options>`, payload `fsread1`, `external: {content-disposition:
   attachment; filename=...}`, the mechanism cockpit-files uses), then
   remove the temp file. If the spike fails, stop and report; do not ship
   a workaround that only works in Chromium.
   - **Acceptance:** every download in the module (fix .sh/.yml, report
     HTML, results XML, ARF, tailoring XML, guide) arrives in Chromium and
     Firefox inside the shell, checked by Playwright download events, plus
     one manual check in real desktop Firefox (note it for Peter if you
     can't do it yourself).
4. **Show errors, never swallow them.** Any fix/download failure shows an
   inline danger Alert with the oscap message. An empty fix (rule with no
   remediation of that type, e.g. `grub2_password` Ansible) shows a warning
   instead of downloading an empty playbook (C§1c).
5. **No silent default profile** (R4). Profile select starts on "Select a
   profile…" unless the user scanned with this content before; then
   preselect their last profile (localStorage per content path, wrapped in
   try/catch). Run Scan is disabled until a profile is chosen.
6. **Mismatched content guard** (R9, C§5). Content whose OS doesn't match
   the host gets a warning on selection, and a 0 %-score scan no longer
   shows "All rules passed".

## Phase 2: visual surfaces and dividers (spec D) — everything else builds on this

> Peter: the rewrite "is white everywhere all day long with no borders no
> stops no ends"; "v3 has nice lines everywhere breaking the elements apart
> creating contrast and directing your eyes"; expanded rules in v3
> "contrasted to catch your eyes".

- House single-panel layout: gray page background is the panel, white cards
  on it, **no outer white PageSection, no card outlines** (R5, now High).
- **Dividers organize, borders contain.** Use PF `Divider` inside cards:
  under each card header, vertical between side-by-side zones, above search
  rows, between groups and between rows, above footer action bars.
- Deliberate tinted surfaces (PF secondary/tertiary background tokens):
  expanded rule detail, score tile, builder panel (with a left accent bar).
- Severity: bold group headers with readable PF Labels and counts, not
  colored text. Fix the 1.51:1 MEDIUM contrast (R6).
- One filled primary button per screen.

## Phase 3: results (spec B) and the Remediation Builder drawer (spec C)

> Peter: "I do like that critical or high is auto expanded"; v3's results
> "just seem separated to the eye and flow better"; "the builder from v3 was
> nice".

**Results page** (`ScanResults.jsx`), port v3's structure from `main`:
- Header: small "HOST SCAN RESULTS" label, profile title bold (tailoring
  name if used), date; right side: duration, content + SSG version. Take
  start/end time and benchmark version from the results XML so saved scans
  from before this change also get a header.
- Three zones in one row, divided: score tile | summary line ("267 passed ·
  38 failed · 16 n/a · 0 errors") | **Remediation Builder panel**: severity
  counts, "n critical/high rules can be auto-remediated", **Critical & high
  (n)** primary, **All failures (n)** secondary. Both open the drawer with
  that selection.
- Failing rules: v3 rows (title, CCE second line, Automated right-aligned,
  divider per row), groups High / Medium / Low / Unknown plus collapsed
  **Not applicable** and **Not checked** (C§2.06). **Critical/high groups
  expanded by default.** PF SearchInput that expands matching groups and
  hides groups with no match (v3 behavior). **No checkboxes on this page.**
- Expanded rule: tinted detail panel, description and rationale (inline
  commands as code, R12), **framework reference chips** (CIS / NIST 800-53 /
  800-171 / CSF / PCI-DSS / DISA, v3 `index.js`; needs rule `<reference>`s
  from the content, store them in `rule_meta` at save time, tolerate old
  manifests without them), then a "Remediation script" disclosure with the
  per-rule preview and .sh / .yml downloads.
- Footer action bar: **View report** (secondary), **Download ▾** (HTML
  report, results XML, ARF), and **Close** set apart on the right. Drop the
  top-level XML/ARF buttons (R10). New Scan is not primary.
- Don't port: policy-target line / compliance threshold, Load Config,
  amber-on-cream score (1.99:1), native search input.

**Remediation Builder drawer** (new component, PF Drawer), port v3's
"Selective Remediation" from `main` `remediation.js` / `index.html`:
- Context header: profile, score, failing count, content, scan date.
- "n of m rules selected" + Select all / Deselect all, PF SearchInput.
- Severity groups, each "n of m selected" with its own select/deselect;
  per-rule checkbox, title, rule id, Details expander.
- Bottom actions: **Download Bash script**, **Download Ansible playbook**
  (Phase 1 generation, on click, no pre-generation, so old scans always
  work, fixing C§1d). Leave a slot for Apply Now; **do not build Apply
  Now** (that is `PLAN_V4.5_APPLY_NOW.md`, separate approval). When it is
  built later, its confirm is ONE dialog (warning + rule list + View
  script), not v3's two.
- Close is the drawer's standard close (×), not an outlined button.

## CHECKPOINT — stop here for Peter

Deploy two dev copies on scap-test10, next to the RPM:
- `~/.local/share/cockpit/scap-dev/`, manifest label **"SCAP Security
  (dev)"**: PF default text weight.
- `~/.local/share/cockpit/scap-dev-heavy/`, label **"SCAP Security (dev,
  v3 weight)"**: v3's heavier text (16 px, bolder labels/tabs/buttons).

Verify both load inside the shell (Chromium + Firefox), the RPM page is
unchanged (`rpm -V cockpit-scap` clean), then **stop and report**. Peter
compares, picks the weight, and says go/no-go for the rest. Report to the
top of the main checkout's `HANDOFF.md` with: commits, spec counts per
browser, dev-copy md5s, screenshots path (untracked), anything you could not
verify.

## Phase 4 (after Peter's go): running view, editor, history, findings

**Running view (spec A)** (`ScanProgress.jsx`, `oscap.js` startScan)
> Peter, on v3's running view: "if that box on the right was scrollable this
> would be perfect".
- v3 layout from `main` `host-scan.js:35-92`: context block (content,
  version, profile, policy, target), progress bar + ETA, live PASSED /
  FAILED / ERRORS tiles, recent-rules feed. Run oscap with `--progress`
  (v3 does) and parse it; total = selected rules in the profile/tailoring.
  Check that the bar actually moves (v3's looked empty at 16 s).
- Feed is **scrollable**: fixed ~8–10 rows, auto-follows newest, pauses
  when the user scrolls up, "Jump to latest" to resume; pass/fail icon per
  rule; "Failed only" toggle.
- Keep the rewrite's Cancel (it kills oscap; v3's doesn't, V1). Cancel
  stays above the fold at 1280×800 @125 % (R1).
- Raw oscap output behind a "Show oscap output" expander.

**Policy editor (spec E)** (`TailoringEditor.jsx`)
> Peter: the rewrite editor "is good but something just feels off".
- Sticky top action bar: Policy name · "N rule(s), M variable(s) changed" ·
  **Update** · Save as New · **Cancel** (Cancel confirms if there are
  unsaved changes). Remove the "Cancel editing / start a new policy" link.
- Sections with heading, one-line description and divider: **Rules**
  (search + **labeled** filters "Show: All / Disabled / Modified" and
  "Severity: All / High / Medium / Low", then the tree); **Variables** (same
  treatment as Rules, not a blue link); **Changes from base profile** (two
  columns Rules | Variables like v3's Deviations, Copy summary, no inner
  bordered box).
- In edit mode the profile description collapses to a one-line expander.
- Fix plurals ("1 rules").

**History (spec F)** (`ScanHistory.jsx`)
> Peter: "the history table just looks better. maybe its the title bars
> above the columns".
- Gray header band, full-width row dividers, labeled Actions column.
- Columns: Date | Profile (tailoring name as a second line only when used;
  drop the mostly-empty Tailoring column) | Score (+ delta vs the previous
  scan of the same profile and tailoring, ▲/▼) | Passed | Failed (plain
  numbers, not pills) | Actions.
- Actions: **View** (renamed from "View report") which **scrolls to and
  focuses** the results (fixes the R3 dead end), **Download ▾**, Delete in
  a kebab.
- Phone width: keep a 3-column table, not the label/value grid (R7).

**Review findings**
- F2: remove the unlabeled content dropdown next to "Upload Tailoring File".
  Read the tailoring file's `<benchmark href>`, match it to detected or
  uploaded content; ask in a small modal only when there is no match.
- F4 (cheap version): replace the three links under the content picker
  (Enter path manually / Upload… / Manage uploaded content →) with one
  "Other content ▾" menu. Same on the Tailoring tab.
- F5: one footer on every list, "N items · size", same unit formatting.
- Friendly content names ("Red Hat Enterprise Linux 10", not "rhel10";
  v3 `index.js:933-962`).

Deploy Phase 4 to `scap-dev` (the weight Peter picked), full suite in both
browsers, report as at the checkpoint. **No merge to `rewrite`, no RPM, no
GitHub** until Peter approves.

## Out of scope

Apply Now (`PLAN_V4.5_APPLY_NOW.md`); Container Scan, Settings tab,
Activity log, CSV export, Load Config, compliance threshold (all cut as
off-mission, none exist in the rewrite today, do not add them); storage
location (`~/SCAP` stays, Peter's call); tests/TESTING.md rewrite beyond
what new specs need.

## Open questions for Peter (answer before dispatch)

1. **Puppet.** The setup page offers Bash / Ansible / Puppet for a whole
   profile. The usability review put Puppet on the cut list. Keep it or
   cut it? (Plan assumes: keep as-is, no new Puppet work.)
2. **Apply Now timing.** Build V4.5 straight after this, or later? (Plan
   assumes later; the drawer leaves room for it.)
3. **F4 depth.** Cheap "Other content ▾" menu (planned) or the full PF
   Select with actions in the menu + Manage dialog?
4. **Checkpoint host.** Dev copies on scap-test10 next to your RPM install
   (planned). OK?

## Amendments (2026-10-14)

Approved by Peter on 2026-10-14, after the plan was dispatched. They
override the matching text above.

1. **Phase 1 item 5, "remember last profile": no new storage.** Do not use
   localStorage or any other new store. Derive the last-used profile from
   the newest saved scan in `~/SCAP/scans` whose `sds_file` matches the
   selected content. If there is none, the select starts on "Select a
   profile…".
2. **Phase 2/3 score tile: neutral tint only.** No good/bad color bands or
   thresholds on the score anywhere (no yellow/green/red by value). That is
   the cut compliance-threshold opinion coming back; the number speaks for
   itself. Severity colors on rule groups are fine (they are the content's
   data).
3. **Layout: native white container (supersedes spec D's "gray page as
   the panel ... no card outlines").** Peter at the checkpoint: the page
   not being in a container "doesn't follow cockpitisms". Cockpit 356's
   own pages sit in one white main container with the tabs inside, cards
   outlined (Overview). Restored; dividers and tinted surfaces stay. The
   house rule in ~/Projects/cockpit/CLAUDE.md was wrong and is fixed.
4. **Text weight: PF default.** Peter: the v3-weight copy is "too big and
   bold ... dev looks better". The weight switch and scap-dev-heavy are
   gone.

Reason (1, 2): the module stays stateless (only `~/SCAP` user artifacts) and
opinionless (the Cockpit ideal: no stored opinion of server state).
