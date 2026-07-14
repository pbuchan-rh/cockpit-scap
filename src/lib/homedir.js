import cockpit from 'cockpit';

/* Shared by lib/tailoring.js and lib/scanHistory.js — both write per-user
 * private data under the same homedir-subtree pattern. */

export function makeTimestamp() {
    return new Date().toISOString()
            .replace(/\.\d{3}Z$/, '')
            .replace(/:/g, '-');
}

let cachedUser = null;
export async function getUser() {
    if (!cachedUser) cachedUser = await cockpit.user();
    return cachedUser;
}

/* Runs as the invoking user (no superuser) — the user already owns their
 * own homedir, so no root/chown is needed. Per-user-private data, chmod 700. */
export async function ensureUserDir(dir) {
    await cockpit.spawn(['mkdir', '-p', dir], { err: 'message' });
    await cockpit.spawn(['chmod', '700', dir], { err: 'message' });
}

/* Binary sibling of cockpit.file().replace() — cockpit.file() is text-only,
 * and report.html / gzipped XML / uploaded SDS blobs are Uint8Array. dd (not
 * tee) avoids echoing the payload back to stdout.
 *
 * Data must be sent via proc.input(), not the { input: data } spawn option —
 * that option is merged verbatim into the JSON "open" control message, which
 * mangles a Uint8Array (JSON.stringify turns it into an index->byte object)
 * and never signals stdin EOF, so dd blocks forever waiting for more input.
 * proc.input() sends it as a real binary channel frame and then sends the
 * "done" control message to close stdin. Shared by lib/scanHistory.js and
 * lib/content.js. */
export async function writeBinaryFile(path, data) {
    const proc = cockpit.spawn(['dd', 'status=none', `of=${path}`], { binary: true, err: 'message' });
    proc.input(data);
    await proc;
}
