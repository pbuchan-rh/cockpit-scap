# cockpit-scap — Troubleshooting

These issues only surface on hosts with CIS Level 2 or similar hardening applied.

## Cockpit service masked after hardening

CIS rule `xccdf_org.ssgproject.content_rule_mask_nonessential_services` masks `cockpit.service`. After rebooting a hardened host, Cockpit's socket will not start.

```bash
sudo systemctl unmask cockpit.service
sudo systemctl enable --now cockpit.socket
```

To prevent recurrence, tailor this rule out of the profile in the Policy Tailoring tab before applying remediation.

## Privileged operations fail after hardening (`use_pty`)

CIS hardening adds `Defaults use_pty` to `/etc/sudoers`, which prevents Cockpit's privileged bridge from operating correctly. Scans, Apply Now, and file writes will fail with a session error.

Create `/etc/sudoers.d/cockpit-bridge` with the following content:

```
Defaults!/usr/bin/cockpit-bridge !use_pty
```

## Sudoers entries wiped after running remediation scripts

The CIS remediation script for sudoers rules overwrites `/etc/sudoers.d/` entries. After each remediation batch that includes sudoers rules, re-add the `/etc/sudoers.d/cockpit-bridge` file above.

## Sudoers exceptions silently ignored (bad file permissions)

If any file in `/etc/sudoers.d/` has permissions other than `0440`, sudo rejects the entire directory and all exceptions — including the `cockpit-bridge` entry above — are silently ignored. This can cause settings saves and privileged operations to fail even after the `use_pty` fix is applied.

Check for bad permissions:

```bash
sudo visudo -c
```

If any file is flagged, fix it:

```bash
sudo chmod 440 /etc/sudoers.d/<filename>
```

## Scan history empty, downloads failing, settings not saving (umask 027)

CIS Level 2 hardening sets `Defaults umask=027` in sudoers, which causes all files written by the Cockpit bridge under `superuser: require` to be created as `root:root 640`. Non-privileged reads then fail silently, producing these symptoms:

- History shows "No scans yet" immediately after a scan completes
- Download Report, Download ARF, and Download Results XML buttons do nothing
- Settings appear to save but are lost on reload
- Remediation context headers are blank

This was fixed in **v3.9**. If you are running an earlier version, upgrade via COPR:

```bash
sudo dnf upgrade --enablerepo=copr:copr.fedorainfracloud.org:pbuchan-rh:cockpit-scap cockpit-scap
```

To fix permissions on existing scan results without rescanning:

```bash
sudo find /var/lib/cockpit-scap -type f -exec chmod 644 {} +
sudo find /var/lib/cockpit-scap -type d -exec chmod 755 {} +
```
