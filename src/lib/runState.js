/* Parses `systemctl show -p LoadState -p ActiveState -p ExecMainStartTimestamp
 * -p Environment <unit>` for lib/remediate.js's getRunState(). No cockpit
 * import, so tests/v46-review-lifecycle.spec.js can unit-test it.
 *
 * ExecMainStartTimestamp is read in systemd's default format, which every
 * systemd prints: getRunState runs systemctl with TZ=UTC and LC_ALL=C, so it
 * reads "Tue 2026-10-20 14:03:07 UTC". `--timestamp=unix` ("@1792505587")
 * would be simpler but needs systemd >= 248 (RHEL 8 has 239, where the
 * unknown option fails every poll, L1); that form is still accepted. Both
 * have whole-second precision. Empty or "n/a" (not started yet) is null. */
const STAMP_RE = /^(?:\w+ )?(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) UTC$/;

export function parseStartTimestamp(value) {
    const v = (value || '').trim();
    const unix = v.match(/^@(\d+)$/);
    if (unix) return Number(unix[1]) * 1000;
    const m = v.match(STAMP_RE);
    if (!m) return null;
    const ms = Date.parse(`${m[1]}T${m[2]}Z`);
    return Number.isFinite(ms) ? ms : null;
}

/* { running, dir, startedAt } from the systemctl output. A --no-block start
 * leaves the unit loaded but inactive with no start time for a moment: that
 * counts as running. Once it ends, --collect unloads it
 * (LoadState=not-found). `dir` is COCKPIT_SCAP_RUN_DIR when it matches
 * `dirRe`, else null. */
export function parseRunState(out, dirRe) {
    const prop = name => (out.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1] ?? '').trim();
    const load = prop('LoadState');
    const active = prop('ActiveState');
    const startedAt = parseStartTimestamp(prop('ExecMainStartTimestamp'));
    const dir = prop('Environment').match(/COCKPIT_SCAP_RUN_DIR=(\S+)/)?.[1] ?? null;
    const running = load === 'loaded' &&
        (['activating', 'active', 'deactivating', 'reloading'].includes(active) || (active === 'inactive' && startedAt === null));
    return { running, dir: dir && dirRe.test(dir) ? dir : null, startedAt };
}
