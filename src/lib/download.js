import cockpit from 'cockpit';

import { writeBinaryFile } from './homedir.js';

const TMP_PREFIX = '/tmp/cockpit-scap-dl-';
// How long a staged download file is kept before it is removed. cockpit-ws
// opens it as soon as the hidden frame requests the channel URL (well under
// a second); the margin only covers a slow or busy host.
const CLEANUP_DELAY_MS = 60000;

/* Downloads `data` (string or Uint8Array) as `filename`.
 *
 * A blob: URL + <a download> (what this module used before V4.6) is
 * silently blocked by Firefox when the module runs inside the Cockpit shell
 * iframe: Firefox checks the blob load against the SHELL page's CSP, which
 * has no blob: (C§1b). Instead, the data goes to a user-private temp file
 * that is served through Cockpit's external channel
 * (/cockpit/channel/<csrf>?<base64 open options>, payload fsread1, with a
 * content-disposition: attachment header) — the same mechanism
 * cockpit-files uses. That URL is same-origin ('self'), so neither CSP
 * objects. It is loaded in a hidden iframe: no popup to be blocked after
 * the async generation step, and an unexpected error page never replaces
 * the module's own frame. Spike: tests/adhoc/v46-firefox-download-spike.js.
 *
 * Rejects (so callers can show the error) if the temp file can't be
 * written. The temp file is removed after CLEANUP_DELAY_MS; anything a
 * closed tab left behind is swept by the next download. */
export async function downloadFile(data, filename) {
    if (data === null || data === undefined) throw new Error(cockpit.format('Nothing to download for $0', filename));
    sweepStaleDownloads();
    const path = (await cockpit.spawn(['mktemp', TMP_PREFIX + 'XXXXXX'], { err: 'message' })).trim();
    try {
        if (typeof data === 'string')
            await cockpit.file(path).replace(data);
        else
            await writeBinaryFile(path, data);
    } catch (ex) {
        cockpit.spawn(['rm', '-f', path], { err: 'ignore' }).catch(() => {});
        throw ex;
    }

    const safeName = filename.replace(/["\\\r\n]/g, '_');
    const opts = {
        payload: 'fsread1',
        binary: 'raw',
        path,
        host: cockpit.transport.host,
        external: {
            'content-disposition': `attachment; filename="${safeName}"`,
            'content-type': 'application/octet-stream',
        },
        // The bridge has no "unlimited"; same workaround as cockpit-files.
        max_read_size: Number.MAX_SAFE_INTEGER,
    };
    const bytes = new TextEncoder().encode(JSON.stringify(opts));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    const prefix = new URL(cockpit.transport.uri('channel/' + cockpit.transport.csrf_token)).pathname;

    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.className = 'ct-download-frame';
    frame.src = `${prefix}?${window.btoa(bin)}`;
    document.body.appendChild(frame);

    pending.add(path);
    setTimeout(() => {
        frame.remove();
        pending.delete(path);
        cockpit.spawn(['rm', '-f', path], { err: 'ignore' }).catch(() => {});
    }, CLEANUP_DELAY_MS);
}

// Staged files whose cleanup timer hasn't fired yet; removed best-effort
// when the page goes away (the bridge may already be closing).
const pending = new Set();
window.addEventListener('pagehide', () => {
    if (pending.size > 0)
        cockpit.spawn(['rm', '-f', ...pending], { err: 'ignore' }).catch(() => {});
});

let swept = false;
function sweepStaleDownloads() {
    if (swept) return;
    swept = true;
    // Runs as the user: /tmp is sticky, so only our own files can go.
    cockpit.spawn(['find', '/tmp', '-maxdepth', '1', '-name', 'cockpit-scap-dl-*', '-mmin', '+10', '-delete'],
                  { err: 'ignore' }).catch(() => {});
}
