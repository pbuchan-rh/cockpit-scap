# Contributing to cockpit-scap

Bug reports, documentation fixes and code changes are welcome. For a larger change, open an
issue first to agree on the scope.

## Requirements

A RHEL 10 (or similar) host with Cockpit and OpenSCAP:

```bash
sudo dnf install cockpit openscap-scanner scap-security-guide
sudo systemctl enable --now cockpit.socket
```

To build, you also need `make`, Node.js and npm.

## Stack and layout

React 18 + PatternFly 6, bundled with esbuild, the same setup as `cockpit-podman`.

```
src/
├── index.html, index.jsx   # entry point; the mount div has class="ct-page-fill"
├── app.jsx, app.scss       # tabs (Host Scan, Policy Tailoring), shared state, styles
├── manifest.json           # Cockpit manifest (installs as "scap")
├── components/             # one file per card, dialog or picker
└── lib/                    # oscap calls, results parsing, scan history, tailoring, content
packaging/cockpit-scap.spec.in
tests/                      # Playwright suite
tools/deploy-dev-copies.sh  # deploys dist/ as a dev copy (see below)
```

## Building

```bash
make              # npm install, fetch Cockpit's pkg/lib, build dist/
npm run build     # rebuild dist/ after a change
npm run watch     # rebuild on every change
make rpm          # build the RPM
```

Lint before you commit; both must be clean:

```bash
npx eslint src/
npx stylelint "src/**/*.scss"
```

## Trying a change

`make devel-install` links `dist/` to `~/.local/share/cockpit/scap`, which shadows an
installed RPM for your user. `make devel-uninstall` removes the link.

To test next to an installed RPM, deploy a dev copy instead:

```bash
npm run build && tools/deploy-dev-copies.sh user@testhost
```

It copies `dist/` to `~/.local/share/cockpit/scap-dev/` on that host, labelled
"SCAP Security (dev)" in the Cockpit menu. Hard-refresh the browser after each deploy.

## Code conventions

- PatternFly 6 components; import them from `@patternfly/react-core/dist/esm/...`, not the
  package root.
- Custom CSS classes start with `ct-`; colors come from PatternFly tokens, never hex values.
- `cockpit.spawn()` for subprocesses and `cockpit.file()` for text files. Read binary or
  gzip files with `cockpit.spawn(['cat', ...], { binary: true })`.
- `{ superuser: "require" }` only where root is needed (running `oscap`, reading its result
  files, Apply now).
- Module data goes under `~/SCAP/` of the Cockpit user; scans use a temp directory under
  `/tmp`. Nothing is written to `/var/lib/`.
- No outbound network calls, no `eval()`.

## Tests

The Playwright suite in `tests/` drives a real Cockpit host in Chromium and Firefox. Most
specs open the dev copy (`/scap-dev`, see above); set `SCAP_SHELL_PATH=/scap` to test the
installed RPM instead. Some specs run real scans, and `v46-apply-now` and `v46-missing-deps`
change the host (they apply fixes or remove packages): they only run against the disposable
host named in `tests/helpers/apply-host.js`.

Set the host and credentials in the environment, or in `tests/.env` (copy
`tests/.env.example`). Never commit `tests/.env`.

```bash
npx playwright install chromium firefox
COCKPIT_URL=https://testhost:9090 COCKPIT_USER=me COCKPIT_PASS=... \
  npx playwright test --config=tests/playwright.config.js --project=chromium tests/v46-phase2.spec.js
```

Run one spec at a time; the tests share one Cockpit session. See
[tests/TESTING.md](tests/TESTING.md) for details.

## Submitting changes

1. Fork the repository and create a branch.
2. Build, lint, and test the change on a host with SELinux enforcing.
3. Open a pull request that says what changed and why. Include a screenshot for UI changes.

## Reporting bugs

Open a [GitHub issue](https://github.com/pbuchan-rh/cockpit-scap/issues) with:

- OS version, Cockpit version (`cockpit --version`) and `rpm -q cockpit-scap`
- Steps to reproduce
- What you expected and what happened
- Browser console output if relevant (F12 → Console)

On a CIS- or STIG-hardened host, check [TROUBLESHOOTING.md](TROUBLESHOOTING.md) first.

## License

cockpit-scap is licensed under the [GNU Lesser General Public License v2.1 or later](LICENSE).
