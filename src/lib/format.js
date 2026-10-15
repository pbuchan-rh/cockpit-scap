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

/* "just now", "5 minutes ago", "3 hours ago", "1 day ago" for a past time
 * (ms or anything Date accepts), relative to `now`. */
export function formatAge(when, now = Date.now()) {
    const t = new Date(when).getTime();
    if (isNaN(t)) return '';
    const min = Math.floor(Math.max(0, now - t) / 60000);
    if (min < 1) return cockpit.gettext("just now");
    if (min < 60) return cockpit.format(cockpit.ngettext("$0 minute ago", "$0 minutes ago", min), min);
    const hours = Math.floor(min / 60);
    if (hours < 24) return cockpit.format(cockpit.ngettext("$0 hour ago", "$0 hours ago", hours), hours);
    const days = Math.floor(hours / 24);
    return cockpit.format(cockpit.ngettext("$0 day ago", "$0 days ago", days), days);
}
