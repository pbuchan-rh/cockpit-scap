# cockpit-scap — Ecosystem & Landscape Research

**Researched:** 2026-05-29  
**Purpose:** Community and competitive landscape analysis — confirms project positioning and informs upstream engagement strategy

---

## Summary

The single-host, browser-based, air-gap-capable SCAP compliance scanning and tailoring use case has **no existing tool** in the RHEL 10 / Cockpit ecosystem. cockpit-scap is the only project addressing this gap.

---

## The Gap Is Officially Documented

Red Hat formally acknowledges the removal of the two major GUI-era compliance tools in RHEL 10:

- **`scap-workbench` removed** — listed explicitly in the RHEL 10 "Considerations in Adopting" document. Stated CLI replacements: `oscap` + `autotailor`. Stated cloud replacement: Red Hat Lightspeed.
- **`oscap-anaconda-addon` removed** — the installer Security Policy spoke is gone. RHEL 10 does not support applying a compliance profile at install time via the graphical installer.
- **SCAP Workbench archived September 27, 2024** — GitHub repository set to read-only with no explanation, no named replacement, no migration guide. Last actual release was 1.2.1 in January 2020.
- **`openscap-daemon` archived January 3, 2023** — the DBus-based continuous scanning service that had "Cockpit integration planned" was abandoned before that integration shipped.

The OpenSCAP project website has not been updated to reflect any of this. Both tools are still listed as active on the Tools page.

---

## The Cockpit Project Has No SCAP Module

The cockpit-project GitHub organization has 30 repositories covering file management, virtual machines, containers, ostree, subscriptions, and infrastructure tooling. **Zero** are related to SCAP, OpenSCAP, compliance scanning, or security auditing.

The only record of SCAP in the cockpit-project is:

> **GitHub Issue #19691** — "OpenSCAP integration security audit and logs"  
> Opened: December 4, 2023  
> Labels: `enhancement`, `help-wanted`, `plugin-ideas`, `plugin-request`  
> Status: Open. No maintainer comments. No linked PRs. No milestone. No assigned developer.

The Cockpit project wiki has a "Feature: container security scanning" page that references SCAP Workbench as prior art — last edited March 2017, abandoned.

The `help-wanted` and `plugin-request` labels on issue #19691 are the Cockpit project's way of saying: *someone from the community should build this.* No one has.

A historical note: in 2014, the OpenSCAP and Cockpit projects explicitly discussed what Cockpit would and would not implement from SCAP Workbench. The conclusion was that profile tailoring and customization would **not** be implemented in Cockpit, and the two projects would remain separate tools. That decision stood for a decade — until SCAP Workbench was archived and no replacement appeared.

---

## No Community Projects Fill This Gap

A complete audit of GitHub topics (`scap`, `cockpit-plugin`, `cockpit`), Fedora COPR, and direct package searches returns **no existing Cockpit module for SCAP compliance scanning** from any source.

- 14 `cockpit-plugin`-tagged GitHub repos: one antivirus tool (cockpit-clamav), zero compliance scanning tools
- 203+ `cockpit`-tagged repos: nothing SCAP-related
- Fedora COPR: no `cockpit-scap` or `cockpit-openscap` entry. The only SCAP-related COPR (`openscapmaint/openscap-latest`) packages the binaries themselves, not a Cockpit integration

**cockpit-scap is the only existing project** attempting a browser-based, Cockpit-integrated SCAP compliance GUI.

---

## What Red Hat Officially Recommends Instead

| Replacement | Type | Air-gap capable? | Local GUI? |
|---|---|---|---|
| `oscap` + `autotailor` | CLI only | Yes | No |
| Red Hat Lightspeed (Insights Compliance) | Cloud SaaS | No — requires internet + subscription | No |
| RHEL Image Builder + OpenSCAP | Build-time only | Yes | No |

None of these provide what SCAP Workbench did: a local GUI for scanning a running system, viewing results, and tailoring a profile without cloud connectivity.

---

## Adjacent and Complementary Projects (Not Competing)

| Project | What it does | Why it's not competing |
|---|---|---|
| **Foreman / foreman_openscap** | Full web UI for SCAP compliance across fleets | Requires full Foreman/Satellite infrastructure — not a single-host tool |
| **Red Hat Satellite OpenSCAP** | Same as Foreman | Same — enterprise fleet management overhead |
| **`complyctl`** (Fedora 42+) | CLI compliance tool using OSCAL format, openscap plugin available | CLI only — no GUI, no Cockpit integration |
| **SCAPtimony** | Centralized ARF report storage | Unmaintained |
| **ComplianceAsCode/content** | SSG content project | Content only, not a tool |

---

## The Landscape Map

| Use Case | Existing Tool |
|---|---|
| Fleet-wide SCAP at enterprise scale | Foreman/Satellite — requires full infrastructure |
| Cloud-connected compliance management | Red Hat Lightspeed — requires internet + Red Hat subscription |
| CLI scanning and tailoring | `oscap` + `autotailor` — terminal only, no history, no GUI |
| Build-time compliance hardening | RHEL Image Builder + OpenSCAP — not for running systems |
| **Single-host, browser-based, local, air-gap capable** | **cockpit-scap — no other project exists** |

---

## Upstream Engagement Strategy

When v1 is complete (SELinux `.fc` + Makefile deliverables), the natural next steps for community visibility are:

1. **Comment on Cockpit issue #19691** with a link to the repo — this is the designated place where the Cockpit maintainers invited community solutions for exactly this problem
2. **Publish to Fedora COPR** — makes the module installable via `dnf` for any RHEL 10 / Fedora user without manual file copying
3. **Contact the OpenSCAP project** — the maintainers archived SCAP Workbench without naming a replacement; cockpit-scap is a candidate to be listed on open-scap.org as a community tool
4. **RPM spec** — required before COPR submission; already in the backlog

The timing is favorable: the gap has been officially acknowledged, no community project has appeared in the 18 months since SCAP Workbench was archived, and the Cockpit project has an open `help-wanted` issue waiting for exactly this.

---

## Sources

- [SCAP Workbench GitHub repository (archived)](https://github.com/OpenSCAP/scap-workbench)
- [OpenSCAP integration security audit and logs · Issue #19691 · cockpit-project/cockpit](https://github.com/cockpit-project/cockpit/issues/19691)
- [Considerations in Adopting RHEL 10 — Chapter 20: Security](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/10/html/considerations_in_adopting_rhel_10/security)
- [RHEL 10.0 Release Notes — Removed Features](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/10/html/10.0_release_notes/removed-features)
- [Red Hat Lightspeed Compliance Service documentation](https://docs.redhat.com/en/documentation/red_hat_lightspeed/1-latest/html-single/assessing_and_monitoring_security_policy_compliance_of_rhel_systems/index)
- [Foreman OpenSCAP plugin](https://github.com/theforeman/foreman_openscap)
- [OpenSCAP-Daemon (archived Jan 2023)](https://github.com/OpenSCAP/openscap-daemon)
- [Introducing complyctl — Fedora Magazine](https://fedoramagazine.org/effortless-flexible-scalable-and-standardized-compliance-checks-for-fedora-using-complyctl/)
- [cockpit-project repositories](https://github.com/orgs/cockpit-project/repositories)
- [OpenSCAP Tools page](https://www.open-scap.org/tools/)
