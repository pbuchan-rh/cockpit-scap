# Contributing to cockpit-scap

Thanks for your interest in contributing. cockpit-scap is a community project and welcomes bug reports, feature requests, and pull requests.

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
ln -s $(pwd) ~/.local/share/cockpit/cockpit-scap
```

Cockpit serves files from `~/.local/share/cockpit/` with higher priority than the system path. Changes to source files are picked up immediately after a browser refresh — no reinstall needed.

**Testing on a remote host:**

If your development machine is different from your test host, use rsync and restart the Cockpit bridge after each deploy:

```bash
rsync -av *.js *.html *.css manifest.json user@testhost:~/.local/share/cockpit/cockpit-scap/
ssh user@testhost "sudo systemctl restart cockpit"
```

The bridge restart is required — Cockpit caches the running session and will not pick up updated files without it.

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
├── index.html          # Module markup
├── index.js            # Host scan, tailoring, content tab logic
├── container-scan.js   # Container scan tab (self-contained, single entry point)
├── style.css           # PatternFly overrides and custom styles
├── manifest.json       # Cockpit module manifest
├── viewer.html         # CSP-compliant HTML report viewer
├── selinux/
│   └── cockpit-scap.fc # SELinux file context definitions
└── Makefile            # Install/uninstall targets
```

## Submitting changes

1. Fork the repository and create a branch for your change
2. Test your change with SELinux in **enforcing** mode — `getenforce` should return `Enforcing`
3. Open a pull request with a clear description of what the change does and why
4. Include a screenshot or screen recording for any UI change

For larger features or changes that affect scope, open an issue first to discuss the approach before investing time in an implementation.

## Reporting bugs

Open a [GitHub issue](https://github.com/pbuchan-rh/cockpit-scap/issues) with:

- RHEL version and Cockpit version (`cockpit --version`)
- Steps to reproduce
- What you expected vs. what happened
- Browser console output if relevant (F12 → Console)

## What this module does and does not do

Before proposing a new feature, review [DESIGN.md](DESIGN.md) for the project's stated scope. In particular:

- **In scope:** Local compliance scanning, profile tailoring, container image scanning, scan history and reporting
- **Out of scope:** Remote SSH scanning, OVAL vulnerability scanning, Red Hat Insights/Satellite integration

## License

cockpit-scap is licensed under the [GNU General Public License v2.0 or later](LICENSE).
