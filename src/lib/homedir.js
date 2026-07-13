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

/* Root (Cockpit's superuser bridge) creates the dir, then chown to the
 * owning user — per-user-private homedir data, chmod 700. */
export async function ensureUserDir(dir, username) {
    await cockpit.spawn(['mkdir', '-p', dir], { superuser: 'require', err: 'message' });
    await cockpit.spawn(['chown', `${username}:${username}`, dir], { superuser: 'require', err: 'message' });
    await cockpit.spawn(['chmod', '700', dir], { superuser: 'require', err: 'message' });
}
