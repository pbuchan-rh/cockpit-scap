# Security Policy

## Supported Versions

Only the latest release receives security fixes.

| Version | Supported |
|---------|-----------|
| Latest release | ✅ |
| Older releases | ❌ |

## Reporting a Vulnerability

You can report security issues either by:
- Opening a [GitHub issue](https://github.com/pbuchan-rh/cockpit-scap/issues) for lower-severity findings
- Using GitHub's [private vulnerability reporting](https://github.com/pbuchan-rh/cockpit-scap/security/advisories/new) if you prefer to disclose confidentially
- Emailing pbuchan@redhat.com with "cockpit-scap security" in the subject line

Please include OS version, Cockpit version (`cockpit --version`), steps to reproduce, and potential impact.

## Context and Scope

cockpit-scap is a Cockpit browser UI module that runs locally on a single host. It is not
a network daemon and does not expose any external services. It invokes `oscap` and `podman` as
subprocesses and writes output to `/var/lib/cockpit-scap/`.

The attack surface is intentionally narrow: only users who already have access to Cockpit on the
host can interact with this module.

In scope:
- Unintended privilege escalation via `cockpit.spawn()` calls
- Path traversal or arbitrary file writes outside `/var/lib/cockpit-scap/`
- XSS via scan results or report content

Out of scope:
- Vulnerabilities in `openscap`, `scap-security-guide`, `podman`, or Cockpit itself — report those upstream
- Issues requiring prior compromise of the host
