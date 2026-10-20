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

/* Reads of the user's own ~/SCAP files run as the user, like the writes
 * above: with admin on, a superuser read fails on an NFS home with
 * root_squash (L10). Only a permission error (a file still owned by root,
 * e.g. from V4.1/V4.2, which wrote as root and then chowned) retries with
 * superuser 'try'. */
function isPermissionDenied(ex) {
    return ex?.problem === 'access-denied' || /permission denied/i.test(ex?.message || '');
}

export async function readUserFile(path) {
    try {
        return await cockpit.file(path).read();
    } catch (ex) {
        if (!isPermissionDenied(ex)) throw ex;
        return cockpit.file(path, { superuser: 'try' }).read();
    }
}

/* cockpit.spawn() as the user (stderr kept for the error), retried with
 * superuser 'try' on a permission error. `options` as for cockpit.spawn,
 * e.g. { binary: true }. */
export async function spawnUserRead(args, options = {}) {
    try {
        return await cockpit.spawn(args, { ...options, err: 'message' });
    } catch (ex) {
        if (!isPermissionDenied(ex)) throw ex;
        return cockpit.spawn(args, { ...options, superuser: 'try', err: 'message' });
    }
}
