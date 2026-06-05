# Contributing to cockpit-scap

Thanks for your interest in contributing. cockpit-scap is a community project built to fill the gap left by SCAP Workbench on RHEL 10 — contributions of any size are welcome.

## Good first contributions

Not sure where to start? These areas are approachable without deep knowledge of the codebase:

- **Bug reports** — if something breaks on your setup, open an issue (see below)
- **Documentation** — typos, unclear steps, missing examples
- **SCAP profile testing** — if you've run cockpit-scap against CIS, STIG, or PCI-DSS profiles and found issues, that's valuable feedback
- **UI polish** — small visual improvements that follow the existing PatternFly 6 patterns

For larger features, open an issue first to discuss scope before investing time in an implementation.

## Requirements

You need a RHEL 10 system (physical, VM, or container) with Cockpit installed:

```bash
sudo dnf install cockpit
sudo systemctl enable --now cockpit.socket
```

For full functionality, also install the SCAP tools:

```bash
sudo dnf install openscap-scanner scap-security-guide openscap-utils
```

For container scanning, also install:

```bash
sudo dnf install openscap-utils podman
```

## Getting the code

```bash
git clone https://github.com/pbuchan-rh/cockpit-scap.git
cd cockpit-scap
```

## Development workflow

cockpit-scap has no build toolchain — no npm, no webpack, no compilation step. Files are served directly by Cockpit from the module directory.

**Install for development** (user-space, no system files touched):

```bash
mkdir -p ~/.local/share/cockpit
ln -s $(pwd)/src ~/.local/share/cockpit/cockpit-scap
```

Cockpit serves files from `~/.local/share/cockpit/` with higher priority than the system path. Changes to source files are picked up immediately after a browser refresh — no reinstall needed.

**Testing on a remote host:**

If your development machine is different from your test host, use rsync to deploy and then refresh the browser:

```bash
rsync -av src/ user@testhost:~/.local/share/cockpit/cockpit-scap/
```

A browser refresh is usually sufficient to pick up the new files. If you see stale behavior after refreshing, restarting the Cockpit bridge will clear it:

```bash
ssh user@testhost "sudo systemctl restart cockpit"
```

Note that a bridge restart drops your Cockpit session and requires re-authentication — treat it as a cache-busting last resort rather than a step to run on every deploy.

## Code conventions

- **Vanilla JavaScript only** — no frameworks, no npm, no CDN imports
- **PatternFly 6** for all UI components — use existing PF6 classes; do not introduce new CSS frameworks
- All custom CSS classes prefixed with `ct-`
- `cockpit.spawn()` for subprocess execution, `cockpit.file()` for file I/O
- `{ superuser: "require" }` scoped to scan execution only — never broader than needed
- No inline event handlers in HTML (`onclick=`, `onchange=` etc.) — wire all listeners in JavaScript
- No `eval()`, no dynamic script injection
- All module file I/O goes to `/var/lib/cockpit-scap/` — never write outside this path

## File structure

```
cockpit-scap/
├── src/
│   ├── index.html          # Module markup
│   ├── index.js            # Host scan, tailoring, content tab logic
│   ├── container-scan.js   # Container scan tab (self-contained, single entry point)
│   ├── style.css           # PatternFly overrides and custom styles
│   ├── manifest.json       # Cockpit module manifest
│   └── viewer.html         # CSP-compliant HTML report viewer
├── selinux/
│   └── cockpit-scap.fc     # SELinux file context definitions
├── docs/
│   └── screenshots/        # README screenshots
└── Makefile                # Install/uninstall targets
```

## Submitting changes

1. Fork the repository and create a branch for your change
2. Test your change with SELinux in **enforcing** mode — `getenforce` should return `Enforcing`
3. Open a pull request with a clear description of what the change does and why
4. Include a screenshot or screen recording for any UI change

For larger features or changes that affect scope, open an issue first and reference [DESIGN.md](DESIGN.md) — it covers the project's goals and what's deliberately out of scope.

## Reporting bugs

Open a [GitHub issue](https://github.com/pbuchan-rh/cockpit-scap/issues) with:

- RHEL version and Cockpit version (`cockpit --version`)
- Steps to reproduce
- What you expected vs. what happened
- Browser console output if relevant (F12 → Console)

If you hit issues specifically on a CIS-hardened or STIG-hardened host, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md) first — some common breakages are documented there.

## License

cockpit-scap is licensed under the [GNU Lesser General Public License v2.1 or later](LICENSE).
