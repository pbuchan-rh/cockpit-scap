import cockpit from 'cockpit';

import { getUser, makeTimestamp } from './homedir.js';
import { getScanHistoryDir } from './scanHistory.js';

/* "Apply now" (PLAN_V4.5_APPLY_NOW.md, amendments 2026-10-15 item 4).
 *
 * A fix must not die half-way when the page closes, so it does not run as a
 * plain cockpit.spawn() (killed with its channel). Each run gets a root-only
 * temp dir holding the generated script, a fixed runner script and the run's
 * metadata, and the runner is started as a transient systemd unit:
 *
 *   systemd-run --unit=cockpit-scap-remediate-<stamp> --collect --no-block
 *       -p Type=oneshot -p TimeoutStartSec=infinity bash <dir>/run.sh ...
 *
 * The runner (RUNNER below) does everything that must happen even with no
 * page open: both syslog lines, the fix itself with its output in
 * <dir>/output.log, the per-run log written AS THE USER (setpriv, so it is
 * the user's own file in ~/SCAP/scans/<scan>/), then removes the temp dir.
 * The page only follows output.log (tail -F), polls the unit, and reads the
 * user's log once the unit is gone.
 *
 * Deviation from the plan's sketch: `-p StandardOutput=file:<dir>/output.log`
 * fails on RHEL 10.2 (status 209/STDOUT, Permission denied: PID 1 may not
 * open a file in the user_tmp_t dir that `sudo mktemp` creates), so the
 * runner redirects its own stdout/stderr instead. */

export const UNIT_PREFIX = 'cockpit-scap-remediate-';
const RUN_DIR_PREFIX = '/tmp/cockpit-scap-remediate-';
const RUN_DIR_RE = /^\/tmp\/cockpit-scap-remediate-[A-Za-z0-9]{6}$/;

const RUNNER = `#!/bin/bash
# cockpit-scap "Apply now" runner, started by systemd-run as a transient unit
# so the fixes keep running when the Cockpit page closes.
# $1 = this run's root-only temp dir, $2 = user, $3 = the user's log file.
dir=$1 user=$2 log=$3
summary=$(cat "$dir/summary")
exec >"$dir/output.log" 2>&1
logger -t cockpit-scap -- "Remediation started: $summary"
bash "$dir/fix.sh"
rc=$?
logger -t cockpit-scap -- "Remediation finished: $summary exit=$rc"
echo "$rc" >"$dir/exit-status"
{
    cat "$dir/header"
    printf '\\n==== Script ====\\n'
    cat "$dir/fix.sh"
    printf '\\n==== Output ====\\n'
    cat "$dir/output.log"
    printf '\\n==== Result ====\\nFinished: %s\\nExit code: %s\\n' "$(date --iso-8601=seconds)" "$rc"
} | setpriv --reuid="$user" --regid="$(id -g "$user")" --init-groups -- \\
    sh -c 'umask 077; set -C; cat >"$1"' sh "$log"
if [ "\${PIPESTATUS[1]}" -eq 0 ]; then
    rm -rf "$dir"
else
    logger -t cockpit-scap -- "Remediation log could not be written to $log; output kept in $dir"
fi
exit "$rc"
`;

const OUTPUT_MARK = '\n==== Output ====\n';
const RESULT_MARK = '\n==== Result ====\n';

/* Every cockpit-scap-remediate-* unit systemd knows about, with whether it
 * is still running, its temp dir and start time. Needs no superuser. */
export async function listRemediationRuns() {
    const out = await cockpit.spawn(
        ['systemctl', 'list-units', '--all', '--plain', '--no-legend', '--type=service', UNIT_PREFIX + '*'],
        { err: 'message' });
    const units = out.split('\n').map(l => l.trim().split(/\s+/)[0])
            .filter(u => u && u.startsWith(UNIT_PREFIX));
    return Promise.all(units.map(async unit => ({ unit, ...(await getRunState(unit)) })));
}

/* { running, dir, startedAt } for one unit. A --no-block start leaves the
 * unit loaded but inactive with no start time for a moment: that counts as
 * running. Once it ends, --collect unloads it (LoadState=not-found). */
export async function getRunState(unit) {
    const out = await cockpit.spawn(
        ['systemctl', 'show', '--timestamp=unix', '-p', 'LoadState', '-p', 'ActiveState',
            '-p', 'ExecMainStartTimestamp', '-p', 'Environment', unit],
        { err: 'message' });
    const prop = name => (out.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1] ?? '').trim();
    const load = prop('LoadState');
    const active = prop('ActiveState');
    const started = prop('ExecMainStartTimestamp').match(/^@(\d+)/);
    const dir = prop('Environment').match(/COCKPIT_SCAP_RUN_DIR=(\S+)/)?.[1] ?? null;
    const running = load === 'loaded' &&
        (['activating', 'active', 'deactivating', 'reloading'].includes(active) || (active === 'inactive' && !started));
    return { running, dir: dir && RUN_DIR_RE.test(dir) ? dir : null, startedAt: started ? Number(started[1]) * 1000 : null };
}

export async function readRunMeta(dir) {
    if (!RUN_DIR_RE.test(dir)) throw new Error('Not a remediation run directory: ' + dir);
    return JSON.parse(await cockpit.spawn(['cat', `${dir}/meta.json`], { superuser: 'require', err: 'message' }));
}

function logHeader(meta) {
    const lines = [
        'cockpit-scap remediation log (Apply now)',
        `User:        ${meta.user}`,
        `Host:        ${meta.host}`,
        `Started:     ${new Date(meta.startedAt).toISOString()}`,
        `Unit:        ${meta.unit}`,
        `Source scan: ${meta.scanId} (${meta.scanDir})`,
        `Profile:     ${meta.profileTitle} (${meta.scanProfileId})`,
        `Content:     ${meta.sdsPath}`,
        `Tailoring:   ${meta.tailoringPath || 'none'}`,
        `Rules (${meta.rules.length}):`,
        ...meta.rules.map(r => `  ${r.id}`),
    ];
    return lines.join('\n') + '\n';
}

/* Starts one run. `source` is the scan the fixes come from:
 * { scanDir, scanId, sdsPath, scanProfileId, baseProfileId, profileTitle,
 * tailoringPath, tailoringName, host, rules: [{id, title, severity}] }.
 * `script` is exactly the text the confirm dialog showed. Resolves with the
 * run's meta (also saved as <dir>/meta.json for a page that reattaches). */
export async function startRemediation(source, script) {
    const user = await getUser();
    const scansRoot = await getScanHistoryDir();
    if (!source.scanDir || !source.scanDir.startsWith(scansRoot + '/') || source.scanDir.includes('..'))
        throw new Error(cockpit.format('The scan is not in $0, so the remediation log has nowhere to go.', scansRoot));
    if (!/^[a-z_][a-z0-9_.-]*\$?$/i.test(user.name))
        throw new Error('Unexpected user name: ' + user.name);

    const running = (await listRemediationRuns()).find(r => r.running);
    if (running) throw new Error(cockpit.format('A remediation is already running on this host ($0).', running.unit));

    const stamp = makeTimestamp();
    const unit = `${UNIT_PREFIX}${stamp}`;
    const dir = (await cockpit.spawn(['mktemp', '-d', `${RUN_DIR_PREFIX}XXXXXX`], { superuser: 'require', err: 'message' })).trim();
    const meta = {
        ...source,
        unit,
        dir,
        user: user.name,
        logPath: `${source.scanDir}/remediation-${stamp}.log`,
        startedAt: Date.now(),
    };
    const summary = `user=${meta.user} host=${meta.host} profile=${meta.scanProfileId} scan=${meta.scanId} ` +
        `rules=${meta.rules.length} unit=${unit}`;
    try {
        const write = (name, text) => cockpit.file(`${dir}/${name}`, { superuser: 'require' }).replace(text);
        await write('fix.sh', script);
        await write('run.sh', RUNNER);
        await write('header', logHeader(meta));
        await write('summary', summary + '\n');
        await write('meta.json', JSON.stringify(meta));
        await cockpit.spawn([
            'systemd-run', `--unit=${unit}`, '--collect', '--no-block', '--quiet',
            '--property=Type=oneshot', '--property=TimeoutStartSec=infinity',
            `--description=cockpit-scap Apply now (${meta.rules.length} rules)`,
            `--setenv=COCKPIT_SCAP_RUN_DIR=${dir}`,
            '/bin/bash', `${dir}/run.sh`, dir, user.name, meta.logPath,
        ], { superuser: 'require', err: 'message' });
    } catch (ex) {
        removeRunDir(dir);
        throw ex;
    }
    return meta;
}

/* Follows <dir>/output.log from its first byte; returns the proc (close()
 * it to stop). tail -F waits for the file and survives it disappearing. */
export function followOutput(dir, onChunk) {
    const proc = cockpit.spawn(['tail', '-c', '+1', '-F', `${dir}/output.log`], { superuser: 'require', err: 'ignore' });
    proc.stream(onChunk);
    proc.catch(() => {});
    return proc;
}

/* After the unit has gone: the user's own log (normal case; the runner
 * already removed the temp dir), else whatever the runner left in the temp
 * dir. The temp dir is removed either way. */
export async function collectRunResult(meta) {
    let text = null;
    try {
        text = await cockpit.file(meta.logPath).read();
    } catch {
        text = null;
    }
    if (text) {
        const out = text.indexOf(OUTPUT_MARK);
        const res = text.lastIndexOf(RESULT_MARK);
        const tail = res >= 0 ? text.slice(res) : '';
        const code = tail.match(/^Exit code: (\d+)$/m);
        const finished = tail.match(/^Finished: (\S+)$/m);
        removeRunDir(meta.dir);
        return {
            exitCode: code ? Number(code[1]) : null,
            output: out >= 0 && res > out ? text.slice(out + OUTPUT_MARK.length, res) : '',
            finishedAt: finished ? Date.parse(finished[1]) || Date.now() : Date.now(),
            logWritten: true,
        };
    }
    let exitCode = null;
    let output = '';
    try {
        exitCode = Number((await cockpit.spawn(['cat', `${meta.dir}/exit-status`], { superuser: 'require', err: 'message' })).trim());
    } catch {
        exitCode = null;
    }
    try {
        output = await cockpit.spawn(['cat', `${meta.dir}/output.log`], { superuser: 'require', err: 'message' });
    } catch {
        output = '';
    }
    await removeRunDir(meta.dir);
    return { exitCode: Number.isFinite(exitCode) ? exitCode : null, output, finishedAt: Date.now(), logWritten: false };
}

export async function readRunLog(logPath) {
    return cockpit.file(logPath).read();
}

async function removeRunDir(dir) {
    if (!dir || !RUN_DIR_RE.test(dir)) return;
    try {
        await cockpit.spawn(['rm', '-rf', dir], { superuser: 'require', err: 'ignore' });
    } catch {
        // best-effort
    }
}
