// Safety guard for every spec that can click "Apply now" / "Apply" (fixes run
// as root and change the host) or that removes/installs packages. Those
// specs may only ever run against the disposable host scap-apply10. Call requireApplyHost() at the top of the
// spec file, so a wrong COCKPIT_URL (including the tests/.env default) makes
// the whole file fail before a browser starts.
const { execFileSync } = require('child_process');

const APPLY_HOST_PREFIX = 'scap-apply10';

function applyHost() {
    let host = '';
    try {
        host = new URL(process.env.COCKPIT_URL || '').hostname;
    } catch {
        host = '';
    }
    return host;
}

function requireApplyHost() {
    const host = applyHost();
    if (!host.startsWith(APPLY_HOST_PREFIX))
        throw new Error(`REFUSING TO RUN: this spec changes the host as root (applies fixes or removes packages) and may only target ${APPLY_HOST_PREFIX}*, ` +
            `but COCKPIT_URL's host is "${host || '(unset)'}".`);
    return host;
}

/* Runs a shell command on the apply host over ssh (as COCKPIT_USER). */
function sshApplyHost(command) {
    const host = requireApplyHost();
    const user = process.env.COCKPIT_USER || 'pbuchan';
    return execFileSync('ssh', ['-o', 'BatchMode=yes', `${user}@${host}`, command], { encoding: 'utf8' });
}

/* Copies a file from the apply host to this machine (as COCKPIT_USER). */
function scpFromApplyHost(remotePath, localPath) {
    const host = requireApplyHost();
    const user = process.env.COCKPIT_USER || 'pbuchan';
    execFileSync('scp', ['-q', '-o', 'BatchMode=yes', `${user}@${host}:${remotePath}`, localPath]);
}

module.exports = { APPLY_HOST_PREFIX, requireApplyHost, sshApplyHost, scpFromApplyHost };
