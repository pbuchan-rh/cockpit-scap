# cockpit-scap Playwright suite

Never commit credentials or test output; see `.gitignore`.

## Setup

```bash
npm install                                   # at the repository root
npx playwright install chromium firefox
```

Each run needs a Cockpit host with the module deployed as the dev copy
(`npm run build && tools/deploy-dev-copies.sh user@host`, path `/scap-dev`) and these
variables, from the environment or from `tests/.env` (copy `tests/.env.example`):

```
COCKPIT_URL=https://your-host:9090
COCKPIT_USER=admin
COCKPIT_PASS=
```

`SCAP_SHELL_PATH=/scap` points the specs that open the module inside the Cockpit shell at
the installed RPM instead of the dev copy.

## Running

One spec at a time, one browser per run (`workers: 1`; the specs share a Cockpit login):

```bash
npx playwright test --config=tests/playwright.config.js --project=chromium tests/v46-u2-pickers.spec.js --reporter=line
npx playwright test --config=tests/playwright.config.js --list
```

## How the specs reach the module

`helpers/cockpit.js` logs in, turns on administrative access on the shell page (before the
module loads, so its first render has admin), and opens `/scap-dev` inside the shell. The
module runs in the shell's iframe, so specs use the returned frame, and the page for
downloads. `hostSpawn()` runs commands on the test host through that frame's Cockpit
bridge. `helpers/scap.js` drives the PatternFly pickers and runs a scan.

## Which host

- No real scan: v46-checkpoint, v46-phase4-admin-notice, v46-phase4-content,
  v46-phase4-editor, v46-phase4-tables, v46-polish-editor, v46-u1-eta (fake `oscap`
  output), v46-u2-pickers, v46-u3-manual-removed, v46-u4-tables, v46-t1-alignment,
  v46-uat2, v46-review-tailoring (one single-rule `oscap xccdf eval` as the user, results in
  /tmp). These create their own fixtures and remove them.
- Real scans: v46-phase1, v46-phase2, v46-phase3, v46-phase4-history, v46-phase4-layout,
  v46-phase4-downloads, v46-phase4-running, v46-polish-results, v46-polish2,
  v46-u1-scan-duration, v46-u3-detection. Each scan takes a minute or more and is saved to
  the user's Scan History until the spec removes it; use a test host.
- Changes the host: v46-apply-now (applies Bash fixes as root) and v46-missing-deps
  (removes and reinstalls `openscap-scanner` and `scap-security-guide`). Both refuse to run
  unless `COCKPIT_URL` points at the disposable host named in `helpers/apply-host.js`.
  v46-review-lifecycle refuses the same way: besides real scans it starts Apply now as
  root, though only with a fake, echo-only fix that leaves the host unchanged.
- Release upgrade: v46-release-upgrade (apply host only, `SCAP_SHELL_PATH=/scap`) skips unless
  `UPGRADE_PHASE` is set. `UPGRADE_PHASE=seed` with the previous release's RPM installed creates a
  scan and two tailorings; then `dnf upgrade` to the candidate; then `UPGRADE_PHASE=verify` checks
  the RPM, that the upgrade changed no ~/SCAP file, and that the old data opens, edits and scans.
  The phases share `tests/test-results/upgrade-state.json`; the data stays in ~/SCAP afterwards.

## Output

Screenshots and traces go to `tests/screenshots/`, `tests/test-results/` and the HTML report
to `tests/report/`, all gitignored. `tests/adhoc/` holds one-off probes without assertions;
they are not part of the suite.
