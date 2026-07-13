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
