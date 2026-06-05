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
