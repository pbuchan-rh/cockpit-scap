Name:           cockpit-scap
Version:        3.4
Release:        1%{?dist}
Summary:        Cockpit module for SCAP compliance scanning and tailoring on RHEL

License:        GPL-2.0-or-later
URL:            https://github.com/pbuchan-rh/cockpit-scap
Source0:        https://github.com/pbuchan-rh/%{name}/archive/v%{version}/%{name}-%{version}.tar.gz

BuildArch:      noarch

Requires:       cockpit >= 344
Requires(post): policycoreutils-python-utils
Recommends:     openscap-scanner
Recommends:     scap-security-guide
Recommends:     openscap-utils

%description
cockpit-scap is a native Cockpit module for SCAP compliance scanning, reporting,
and tailoring on RHEL systems. It replaces the archived SCAP Workbench GUI,
integrating directly into the Cockpit web console.

Features:
  - Auto-detects system-installed SCAP Security Guide data stream files
  - Multi-version content: system and user-staged SDS files with optgroup selector
  - Cross-version OS compatibility detection with inline warning
  - Full XCCDF tailoring editor: rule tree, variables, saved profiles, upload/download
  - Container image scanning via oscap-podman with per-image scan history
  - Selective Remediation Builder: cherry-pick failing rules before downloading
    bash or Ansible remediation scripts (host and container)
  - Scan history with CSP-compliant HTML report viewer and results XML download
  - Activity log: real-time log of all actions with semantic badge colors
  - Compliance Dashboard (preview): latest scan status per host and container image
  - Operates correctly with SELinux in enforcing mode

%prep
%autosetup

%build
# nothing to build — vanilla JS module

%check
# No automated build-time tests for a vanilla JS Cockpit module.
# Runtime integration tests require a live Cockpit + RHEL environment.

%install
# Module files → /usr/share/cockpit/cockpit-scap/
install -d -m 755 %{buildroot}%{_datadir}/cockpit/%{name}
install -m 644 src/index.html src/index.js src/container-scan.js src/dashboard.js src/style.css src/manifest.json src/viewer.html \
    %{buildroot}%{_datadir}/cockpit/%{name}/

# SELinux file context definitions (shipped as a formal deliverable)
install -d -m 755 %{buildroot}%{_datadir}/%{name}/selinux
install -m 644 selinux/cockpit-scap.fc \
    %{buildroot}%{_datadir}/%{name}/selinux/

# Runtime directories — created here so %post restorecon has paths to label
install -d -m 755 %{buildroot}/var/lib/%{name}
install -d -m 755 %{buildroot}/var/lib/%{name}/results
install -d -m 755 %{buildroot}/var/lib/%{name}/tailoring
install -d -m 755 %{buildroot}/var/lib/%{name}/content

%post
# Set SELinux file context for /var/lib/cockpit-scap/ and apply it
if semanage fcontext -a -t cockpit_var_lib_t '/var/lib/cockpit-scap(/.*)?' 2>/dev/null || \
   semanage fcontext -m -t cockpit_var_lib_t '/var/lib/cockpit-scap(/.*)?'; then
    restorecon -Rv /var/lib/cockpit-scap || true
else
    echo "WARNING: Failed to configure SELinux context for /var/lib/cockpit-scap/" >&2
    echo "WARNING: Run manually: semanage fcontext -a -t cockpit_var_lib_t '/var/lib/cockpit-scap(/.*)?'" >&2
    echo "WARNING: Then run:     restorecon -Rv /var/lib/cockpit-scap" >&2
fi

%postun
# Remove the fcontext entry only on full uninstall, not on upgrade
if [ $1 -eq 0 ]; then
    semanage fcontext -d '/var/lib/cockpit-scap(/.*)?' 2>/dev/null || true
fi

%files
%license LICENSE
%doc README.md
%{_datadir}/cockpit/%{name}/
%{_datadir}/%{name}/
%dir /var/lib/%{name}
%dir /var/lib/%{name}/results
%dir /var/lib/%{name}/tailoring
%dir /var/lib/%{name}/content

%changelog
* Sun May 31 2026 Peter Buchan <pbuchan@redhat.com> - 3.4-1
- Compliance Dashboard: per-profile cards with score sparkline (trend over
  time), Quick Scan one-click re-run, View Last Scan navigation, Needs
  Attention banner (regressions + stale profiles), staleness badges
- SDS file upload: browser file picker writes directly to content library;
  overwrite confirmation shows existing file size and date; confirmed
  working up to 26 MB through Cockpit bridge
- Admin gate: upload and delete operations disabled for non-admin sessions
  via cockpit.permission; clear tooltip feedback; Container Scan tab shows
  actionable guidance in limited access mode
- Failing rules summary: collapsible HIGH/MEDIUM/LOW groups; CCE identifiers;
  Automated/Manual remediation annotation; inline description and rationale
  expansion via <details>/<summary>
- Regression and improvement detection: banner fires automatically comparing
  same profile; "See what changed" diffs two results.xml files showing
  Fixed/Regressed/New rule groups
- Compliance score visualization with pass/fail/error counts and timestamp
- View Scan from history loads full results card; Run Again on results card
- Unified single-card scan configuration layout on all three scan tabs
- Content Library: Size and Modified columns on uploaded content table
- Code review and security audit: path traversal hardening, timestamp
  re-validation on rm paths, dead code removal, CSS consistency fixes

* Sun May 31 2026 Peter Buchan <pbuchan@redhat.com> - 3.3-1
- Selective Remediation Builder: after any scan, choose individual failing
  rules before downloading bash or Ansible remediation scripts; rules grouped
  HIGH/MEDIUM/LOW with per-group and global select/deselect; available for
  both host scans and container image scans
- Results XML download: "Download Results XML" button on scan results and
  history rows for both host and container scans
- Compliance Dashboard (preview): hostname, score delta vs previous scan,
  cached load with manual Refresh button, per-image container cards
- Activity log: semantic badge colors (red=delete/error, orange=remediation,
  blue=scan, teal=tailoring, yellow=validate); tailor download logging
- Tailoring Update-in-place: "Update" overwrites existing file;
  "Save as New" creates timestamped copy
- Tailoring inline name field: pencil icon and editable name in editor header
- Container scan: eager parallel prereq checks at module init for instant tab
- Host scan history table: full-width layout fix

* Sat May 30 2026 Peter Buchan <pbuchan@redhat.com> - 3.2-1
- Activity tab: real-time log of all oscap actions (scans, guide generation,
  content validation, tailoring operations); auto-refresh every 3 seconds;
  filter by action type; clear log; log capped at 1000 entries
- src/ restructure: module source files moved to src/ subdirectory

* Sat May 30 2026 Peter Buchan <pbuchan@redhat.com> - 3.1-1
- Run Again action on host and container scan history rows; pre-fills
  content, profile, and tailoring file from scan manifest
- View Guide button on Host Scan, Container Scan, and Tailoring tabs;
  generates oscap security guide directly from profile selection
- Export CSV for host and container scan history; includes all manifest
  fields including image info for container scans
- Content validation: per-file Validate button on uploaded content using
  oscap ds sds-validate with inline pass/fail and error detail modal
- Community files: CONTRIBUTING.md, CODE_OF_CONDUCT.md, issue templates
- History rewrite: clean author identity throughout, private docs removed

* Sat May 30 2026 Peter Buchan <pbuchan@redhat.com> - 3.0-1
- Container image scanning via oscap-podman: image enumeration from root
  Podman store, version mismatch detection, per-image scan history
- Per-type scan history pruning: host and container scans each retain
  up to 10 entries independently
- Server-side XML parsing for results (fixes large file WebSocket limit)
- Code review hardening: stale tailoring selector fix, remediation path
  fix, pruneHistoryByType, manifest tools key fix for nav highlight

* Fri May 29 2026 Peter Buchan <pbuchan@redhat.com> - 2.1-1
- Dark mode: full prefers-color-scheme and Cockpit theme toggle support,
  all colors matched to PatternFly 6 dark token chain
- Results footer: cleaned up Apply Remediation stub, New Scan separated
- UI polish: native Cockpit layout alignment, single-panel design

* Fri May 29 2026 Peter Buchan <pbuchan@redhat.com> - 2.0-1
- Initial package release
- v2.0: content tab, multi-version SDS support, CPE compatibility detection,
  satellite content staging, uploaded-content security warnings
