# cockpit-scap — Troubleshooting

Most of these issues appear only after CIS Level 2 or similar hardening has been applied to
the host, often by cockpit-scap's own remediation.

## Cockpit service masked after hardening

CIS profiles include rules that mask services considered non-essential, including Cockpit.
After remediation, both `cockpit.service` and `cockpit.socket` may be masked, and the socket
fails to start with: `Socket service cockpit.service not loaded, refusing.` The firewall rule
for Cockpit (port 9090) may also be removed.

Restore Cockpit with:

```bash
sudo systemctl unmask cockpit.service cockpit.socket
sudo systemctl enable --now cockpit.socket
sudo firewall-cmd --add-service=cockpit --permanent
sudo firewall-cmd --reload
```

To prevent this, disable the service-masking and firewall rules in a tailoring policy
(Policy Tailoring tab) before you remediate: scan, review, tailor out the rules that would
break management access, then remediate.

## Privileged operations fail after hardening (`use_pty`)

CIS hardening adds `Defaults use_pty` to `/etc/sudoers`, which stops Cockpit's privileged
bridge from working. Turning on administrative access, scans and Apply now then fail.

Create `/etc/sudoers.d/cockpit-bridge` (mode `0440`) with this content:

```
Defaults!/usr/bin/cockpit-bridge !use_pty
```

## Sudoers entries removed after remediation

The CIS remediation for sudoers rules can rewrite the files in `/etc/sudoers.d/`. After a
remediation that includes sudoers rules, check that `/etc/sudoers.d/cockpit-bridge` is still
there and add it again if needed.

## Sudoers exceptions ignored (bad file permissions)

If a file in `/etc/sudoers.d/` has the wrong permissions, sudo ignores it, including the
`cockpit-bridge` entry above. Check with:

```bash
sudo visudo -c
```

Fix any file it flags:

```bash
sudo chmod 440 /etc/sudoers.d/<filename>
```

## Apply now log in the journal

Apply now writes a start and finish line (with the exit status) to the journal under the tag
`cockpit-scap`:

```bash
journalctl -t cockpit-scap
```

The run itself is a transient systemd unit named `cockpit-scap-remediate-<timestamp>`; its
full output is kept with the scan in Scan History. If that log cannot be written, the journal
says so and the output stays in `/tmp/cockpit-scap-remediate-XXXXXX`.
