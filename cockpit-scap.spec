Name:           cockpit-scap
Version:        3.8
Release:        1%{?dist}
Summary:        Cockpit module for SCAP compliance scanning and tailoring on RHEL

License:        GPL-2.0-or-later
URL:            https://github.com/pbuchan-rh/cockpit-scap
Source0:        https://github.com/pbuchan-rh/%{name}/archive/v%{version}/%{name}-%{version}.tar.gz

BuildArch:      noarch

Requires:       cockpit >= 344
Requires:       openscap-scanner
Requires:       scap-security-guide
Requires:       openscap-utils
Requires(post): policycoreutils-python-utils

%description
cockpit-scap is a native Cockpit module that brings OpenSCAP compliance
scanning, profile tailoring, and selective remediation directly into
the browser console RHEL administrators already use.

  - Host and container image scanning on demand; configurable history
    retention per scan type; regression and improvement detection;
    CSV export
  - Selective Remediation Builder: filter and cherry-pick failing
    rules; download bash or Ansible scripts; or Apply Now directly
    on the host with two-gate confirmation and full audit trail
  - Profile tailoring editor: rule tree with enable/disable, variable
    adjustment, and saved XCCDF tailoring files; upload and download
  - Activity log with systemd journal integration; admin-gated
    privileged operations; full SELinux enforcing mode support

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

# AppStream metadata
install -d -m 755 %{buildroot}%{_datadir}/metainfo
install -m 644 org.cockpit_project.cockpit-scap.metainfo.xml \
    %{buildroot}%{_datadir}/metainfo/

# SELinux file context definitions (shipped as a formal deliverable)
install -d -m 755 %{buildroot}%{_datadir}/%{name}/selinux
install -m 644 selinux/cockpit-scap.fc \
    %{buildroot}%{_datadir}/%{name}/selinux/

# Runtime directories — created here so %%post restorecon has paths to label
install -d -m 755 %{buildroot}/var/lib/%{name}
install -d -m 755 %{buildroot}/var/lib/%{name}/results
install -d -m 755 %{buildroot}/var/lib/%{name}/tailoring
install -d -m 755 %{buildroot}/var/lib/%{name}/content
install -d -m 755 %{buildroot}/var/lib/%{name}/remediation-logs

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
%{_datadir}/metainfo/org.cockpit_project.cockpit-scap.metainfo.xml
%dir /var/lib/%{name}
%dir /var/lib/%{name}/results
%dir /var/lib/%{name}/tailoring
%dir /var/lib/%{name}/content
%dir /var/lib/%{name}/remediation-logs

%changelog
* Mon Jun 02 2026 Peter Buchan <pbuchan@redhat.com> - 3.8-1
- Drawer remediation: remediation panel slides in from right; scan results
  remain visible; close with Esc, backdrop click, or Close button
- Action Board: severity counts (HIGH/MEDIUM/LOW) with automatable rule count;
  Critical Rules pre-selects automatable rules; All Failures opens full drawer
- Failing rules search: filter by rule title or CCE identifier
- Score trend chart in Compliance Dashboard with hover tooltips
- Rule detail drawer: click any HIGH finding in Dashboard for full description,
  rationale, CCE, and View in Scan button
- Scan ETA: estimated time remaining shown during active scans
- Keyboard shortcuts: / focuses search, Q triggers Quick Fix, Esc closes drawers
- ARF export: every scan generates Asset Reporting Format bundle; available in
  export dropdown alongside HTML and Results XML
- Not applicable badge: distinct outlined badge, shown only when count > 0
- SSG benchmark version in Content Library replaces file modification date
- Export split button: Download Report default with dropdown for HTML/XML/ARF
- Full profile remediation: bash and Ansible scripts for entire profile without
  a prior scan; available on Host Scan, Container Scan, and Policy Tailoring tabs
- Settings 2-card layout: Settings and Content Library side by side; responsive
  single-column below 900px
- Container and Dashboard tabs disabled by default on fresh installs
- Donut animation on scan complete; scan duration and scan ID in results header
- Score delta shown inline in scan history table

* Mon Jun 02 2026 Peter Buchan <pbuchan@redhat.com> - 3.6-1
- Settings: Clear All Data wipes all scan results, tailoring files, uploaded
  content, and remediation logs in one admin-gated action with modal confirmation
- Selective Remediation Builder: Gate 2 shows affected rule titles before
  applying; raw script accessible via collapsible details element
- Remediation groups collapsed by default; expand individual severity groups
- Download buttons show brief confirmation feedback after file is saved
- Scan elapsed timer displayed during active host and container scans
- Activity log: contextual empty state message per filter type
- Disk usage in Settings reflects full /var/lib/cockpit-scap/ tree
- View Compliance Guide shows loading page during generation delay

* Mon Jun 01 2026 Peter Buchan <pbuchan@redhat.com> - 3.5-1
- Apply Now: two-gate danger confirmation, live streaming bash output,
  admin-gated with full remediation audit log (structured log file,
  systemd journal entry, Activity tab View Log link)
- Settings tab: scan result retention per type, tab visibility toggle,
  admin-gated and activity-logged
- Activity log user field: all entries record the authenticated user
- Selective Remediation Builder: search/filter by title or rule ID;
  inline rule description and rationale expansion
- Container scan limited access: history visible and View Scan works
  without admin elevation
- Remediate from history loads scan results first (host scan parity)
- Large file downloads: max_read_size bypass for files over 15 MB
- Stale cache fixes: tailoring/content cross-notify after save/delete
- Admin gate audit: all privileged UI actions gated and tooltip-annotated
- Security hardening: remediation log path validation
- Dashboard hero card: weighted risk score, severity breakdown, async
  HIGH severity failure names
- Platform: broadened support references to CentOS Stream 10

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
