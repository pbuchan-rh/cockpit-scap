import cockpit from 'cockpit';

/* One byte formatter for every list footer and size column (F5), so the
 * history, policy and content lists all read "N items · 12.3 MB". */
export function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(1)} ${units[unit]}`;
}

/* "3 items · 1.2 MB", the footer under every list (F5). */
export function listFooterText(count, bytes) {
    const items = cockpit.format(cockpit.ngettext("$0 item", "$0 items", count), count);
    return bytes === null || bytes === undefined ? items : `${items} · ${formatBytes(bytes)}`;
}

/* Bytes used under `dir` (du -sb), 0 when it does not exist yet. Runs as
 * the user: every list lives in their own ~/SCAP. */
export async function diskUsageBytes(dir) {
    try {
        const output = await cockpit.spawn(['du', '-sb', dir], { err: 'message' });
        return Number(output.split(/\s+/)[0]) || 0;
    } catch {
        return 0;
    }
}

/* "2026-10-14 22:05:37" from a 2026-10-14T22-05-37 / ISO timestamp. */
export function formatTimestamp(ts) {
    if (!ts) return '—';
    return ts.slice(0, 10) + ' ' + ts.slice(11, 19).replace(/-/g, ':');
}
