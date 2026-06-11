# cockpit-scap Playwright Test Harness

> Never commit credentials or test artifacts — see `.gitignore`.

## Quick start

```bash
# Run full suite (~30 min — requires live RHEL 10 + Cockpit host)
npm test

# Run a specific file
npm run test:host
npm run test:container
npm run test:tailoring
npm run test:settings
npm run test:content

# List all tests without running
npx playwright test --config=playwright.config.js --list
```

## Setup

Node/npm is required (Playwright only, not part of the module):

```bash
npm install
npx playwright install chromium firefox
```

Credentials live in `tests/.env` (gitignored). Copy `.env.example` and fill in your values:

```
COCKPIT_URL=https://your-host:9090
COCKPIT_USER=admin
COCKPIT_PASS=
```

## Architecture

### How it connects to Cockpit

Login flow (`helpers/cockpit.js`):
1. Navigate to Cockpit root URL
2. Fill `#login-user-input` / `#login-password-input`, click `#login-button`
3. Wait for overview page to load
4. Click "Limited access" → elevate admin BEFORE navigating to module
5. Navigate directly to `/cockpit/@localhost/cockpit-scap/index.html`
6. Module loads without an iframe wrapper at this URL — `page` is used directly, no `frameLocator`

Key insight: admin elevation must happen on the Cockpit shell overview page **before** navigating to the module. If you elevate after, the container scan (which needs superuser for `podman images`) renders blank.

### Why no iframe

When you navigate directly to the module URL (`/cockpit/@localhost/cockpit-scap/index.html`), Cockpit loads the module at the top level — no shell iframe wrapper. `getModuleFrame()` returns `page` directly.

If accessed via the Cockpit sidebar, the module would be inside `iframe[name="cockpit1"]`. This test harness avoids the shell entirely.

### Tab navigation

Tab button IDs (from `index.html`):

| Tab | Button ID |
|---|---|
| Host Scan | `tab-btn-scan` |
| Container Scan | `tab-btn-container-scan` |
| Policy Tailoring | `tab-btn-tailoring` |
| Content Library | `tab-btn-content` |
| Settings | `tab-btn-settings` |
| Activity | `tab-btn-activity` |

`navigateToTab(page, 'hostScan')` uses the `TABS` map in `helpers/cockpit.js`.

## Scan configuration

### Host scan
- **SDS**: `/usr/share/xml/scap/ssg/content/ssg-rhel10-ds.xml`
- **Profile**: `xccdf_org.ssgproject.content_profile_pci-dss` (PCI-DSS v4.0.1, fast)

### Container scan
- **Image**: `registry.access.redhat.com/ubi9/ubi-minimal:latest`
- **SDS**: `/var/lib/cockpit-scap/content/ssg-rhel9-ds.xml`
- **Profile**: `xccdf_org.ssgproject.content_profile_pci-dss`
- **Tailoring**: `playwright-ubi9-pci` (created by `00-setup.spec.js` on first run)

## Test file overview

| File | What it covers |
|---|---|
| `00-setup.spec.js` | Creates `playwright-ubi9-pci` tailoring file; runs once, idempotent |
| `host-scan.spec.js` | Module load, content/profile/tailoring selectors, scan execution, history, remediation |
| `container-scan.spec.js` | Tab load, UBI9 image, container scan + tailoring, history, remediation |
| `tailoring.spec.js` | Tailoring tab, editor load, save, cross-version content, dropdown integration |
| `content-library.spec.js` | Both content sections, validate button, admin gate |
| `settings.spec.js` | Settings tab, retention inputs, disk usage, tab visibility toggles |

## Key selector notes

- **Profile select ready**: `await expect(frame.locator('#ct-profile-select')).toBeEnabled({ timeout: 45000 })` — `oscap info` is slow on large SDS files; don't use `toBeVisible()` on `<option>` elements (always "hidden" in closed selects)
- **Tailoring checkboxes**: native `<input type="checkbox">` is CSS-hidden; use `{ force: true }` and click "Expand All" first
- **Content detect**: `detectContent()` is async; use `expect.poll()` to wait for option counts
- **Container scan init**: waits for `#cs-image-select` with 20s timeout (prereq checks take a few seconds)

## Skipped tests (conditional)

These tests skip gracefully if their prerequisite state isn't present:
- `tailoring file selection auto-fills profile` — skips if no tailoring files exist
- `selective remediation builder opens` — skips if no results card visible
- `failing rules summary` — skips if no results
- `view scan from history` — skips if no history rows
- `validate button` — skips if no uploaded content present

These will pass naturally as scan history accumulates.

## Screenshots

All screenshots written to `tests/screenshots/` (gitignored). Named `NN-description.png` for the happy path and auto-captured as `test-failed-1.png` on failures.

## Troubleshooting

**Container scan blank**: admin elevation failed. Check that `a:has-text("Limited access")` is findable on the Cockpit overview after login. Add a `page.screenshot()` call in `loginToCockpit` after `waitForLoadState` to debug.

**Profile select never enables**: `oscap info` is hanging. SSH to your test host and run `oscap info <sds-path>` manually to check.

**"Clicking checkbox did not change its state"**: Rules tree is collapsed. Click "Expand All" button first.

## Test backlog

Features with no automated coverage yet. Add tests here before implementing them.

| Feature | What to test | Notes |
|---|---|---|
| Regression / improvement banners | After loading a scan from history, assert `#ct-regression-alert` or `#ct-improvement-alert` is visible | Requires 2+ scans of the same profile+SDS in history; skip gracefully with 1. Can't control which banner fires without controlling scan data — check `toBeVisible()` on either one with `.or()` |
| Scan diff ("See what changed") | Click banner's "See what changed" button, assert `#ct-scan-diff` becomes visible and contains Fixed/Regressed/New groups | Depends on regression/improvement banner being visible first |
| Activity log user field | Navigate to Activity tab, run any action, assert the User column shows the Cockpit login name (not "—" or "?") | cockpit.user() is async at init; action must happen after page is fully loaded |
| Export CSV (scan history) | Click Export CSV, assert download is triggered (Playwright download event), validate header row contains expected fields | Use `page.waitForEvent('download')` |
| Export CSV (activity log) | Same as above for activity log CSV; validate User column present in headers | — |
