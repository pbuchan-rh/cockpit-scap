# cockpit-scap — Project Rules & Conventions

---

## Confirmation Policy

- All work must be planned and discussed before execution
- No code changes without explicit user confirmation
- When in doubt, propose and wait — never assume approval

## Version Tracking

- Module version format: `v0.x` during pre-release development
- Bump minor version (`v0.2` → `v0.3`) at the start of each feature session
- Version string lives in `index.js` as `MODULE_VERSION`
- Current version: see HANDOFF.md

## File Structure

```
cockpit-scap/
├── index.html            # Module structure and markup
├── index.js              # Host scan, tailoring, content, history logic
├── container-scan.js     # Container scan module — single initContainerScan() entry point
├── style.css             # Custom styles (PatternFly overrides + ct- classes)
├── manifest.json         # Cockpit module manifest
├── viewer.html           # IndexedDB-backed report viewer (CSP-compliant)
├── README.md             # Project documentation
├── cockpit-scap.spec     # RPM spec
├── Makefile              # install/uninstall targets
└── selinux/
    └── cockpit-scap.fc   # SELinux file context definitions
```

**container-scan.js modularity contract:**
- All container scan logic lives in this file
- Single entry point: `initContainerScan()` called from `index.js` DOMContentLoaded
- Shares globals from `index.js`: `RESULTS_BASE`, `TAILORING_BASE`, `CONTENT_BASE`, `SSG_CONTENT_DIR`, `PY_PARSE_RESULTS`, `appendOption`, `sdsDisplayName`, `detectSdsVersion`, `loadProfiles`, `parseProfileDescription`, `parseResultsXml`, `makeTimestamp`, `showConfirmModal`, `viewReportFromPath`, `downloadArtifact`, `listSystemContent`, `listUserContent`, `populateContentOptGroups`
- To remove the feature: delete this file, remove `initContainerScan()` call, remove Container Scan tab/panel from HTML, remove CSS block from style.css

## CSS Rules

- All custom classes prefixed with `ct-`
- CSS custom properties only for color — never hardcoded hex values
- PatternFly tokens: `--pf-global--primary-color--100`, `--pf-global--danger-color--100`, etc.
- `--ct-blue` for primary accent where appropriate
- No inline styles in HTML templates
- Visibility: always `classList.add('hidden')` / `classList.remove('hidden')` — never toggle `style.display` directly except via `el.style.display = value` in JS

## JavaScript Rules

- Vanilla JS only — no frameworks, no npm, no CDN imports
- All event listeners wired in `DOMContentLoaded`
- No inline event handlers in HTML (`onclick=`, `onchange=`, etc.)
- `cockpit.spawn()` for all subprocess execution
- `cockpit.file()` for all file I/O
- `{ superuser: "require" }` only on scan execution — never broader than needed
- 3000ms polling loop pattern (if needed) via single `Promise.all()`
- All async operations must handle errors explicitly — no silent failures

## SELinux Rules (CRITICAL)

- Every file written by the module goes to `/var/lib/cockpit-scap/`
- This path must have proper SELinux file context defined in `selinux/cockpit-scap.fc`
- Never write to paths that don't have defined contexts
- Never ask the admin to `setenforce 0` or modify SELinux policy manually
- SELinux compliance is a required deliverable — module is not done until it works in enforcing mode

## Security Rules (Audience-Appropriate)

- Never suggest disabling security features as a workaround
- No outbound network calls from the module — all data is local
- No eval(), no dynamic script injection
- Remediation apply (in-place) button must be clearly stubbed/disabled in v1 with a visible "coming soon" state — never silently missing

## Naming Conventions

- JS functions: camelCase
- CSS classes: `ct-kebab-case`
- Files: kebab-case
- Result timestamps: ISO 8601 format, filesystem-safe (`2026-05-28T14-32-00`)

## PatternFly Component Map

| UI Element | PatternFly Class |
|---|---|
| Page sections | `pf-v6-c-card` |
| Top navigation | `pf-v6-c-tabs` |
| Results table | `pf-v6-c-table` |
| Status banner | `pf-v6-c-alert` |
| Severity counts | `pf-v6-c-badge` |
| Scan in progress | `pf-v6-c-spinner` |
| Empty history | `pf-v6-c-empty-state` |

## Parking Lot (Deferred — Do Not Implement Without Discussion)

- Remote SSH scanning — explicitly out of scope, do not revisit without major discussion
- Arbitrary SDS file upload — deferred to v2
- One-click remediation apply — deferred, stub UI present in v1
- Ansible remediation apply — deferred
- Container/image scanning (`oscap-podman`) — implemented in v3 (branch: v3-container-scan); see container-scan.js
- RPM package spec — needed before community release, not during active dev
