import cockpit from 'cockpit';

import { ensureUserDir, getUser, makeTimestamp, writeBinaryFile } from './homedir.js';

const SCAN_HISTORY_SUBDIR = 'SCAP/scans';

export async function getScanHistoryDir() {
    const user = await getUser();
    return `${user.home}/${SCAN_HISTORY_SUBDIR}`;
}

/* ~/SCAP/scans is already user-owned (see homedir.js's ensureUserDir), so
 * no superuser is needed here. Falls back to '0' both when the directory
 * doesn't exist yet (fresh install, no scans run) and on any other `du`
 * failure — either way there's nothing to report. */
export async function getScanHistoryDiskUsage() {
    const dir = await getScanHistoryDir();
    try {
        const output = await cockpit.spawn(['du', '-sh', dir], { err: 'message' });
        return output.split(/\s+/)[0];
    } catch {
        return '0';
    }
}

/* Write manifest.json, chmod, then read it back and compare — same
 * hardened-system write-verification guard as lib/tailoring.js's
 * writeTailoringFiles(), applied here since it was never done for scan
 * manifests in old main. */
async function writeManifest(path, manifest) {
    const content = JSON.stringify(manifest, null, 2);
    await cockpit.file(path).replace(content);
    await cockpit.spawn(['chmod', '600', path], { err: 'message' });

    const written = await cockpit.file(path, { superuser: 'try' }).read();
    if (written !== content) {
        throw new Error(
            'Scan manifest was not written correctly. On hardened systems, add ' +
            "'Defaults!/usr/bin/cockpit-bridge !use_pty' to /etc/sudoers.d/cockpit-bridge and try again."
        );
    }
}

/* Persist a just-completed scan's result files + a manifest.json to
 * ~/SCAP/scans/<timestamp>/. `files` is readResults()'s return shape
 * (lib/oscap.js): { reportHtml, resultsXmlGz, arfXmlGz } as Uint8Array,
 * already gzipped for the XML/ARF. `parsed` is parseResults()'s return
 * shape (lib/results.js): { scorePercent, pass, fail, ... }. `ruleMeta` is
 * handleScan()'s already-computed id -> {title,description,rationale,cce,
 * automated} map (app.jsx) — persisted as-is so a saved scan viewed later
 * from history doesn't lose rule detail (it can't be reconstructed from the
 * manifest alone). `baseProfileId` is the base profile id used to resolve
 * ruleMeta/fix generation, which for a tailoring-based scan differs from
 * profileId (the tailoring's own extended profile id used to run the scan
 * itself) — needed so Fix generation from a saved scan can call
 * generateProfileFix() the same way ScanSetup.jsx does. `tailoringFile` is
 * the tailoring's display name (shown in the history table); `tailoringPath`
 * is the actual sidecar XML path oscap needs for --tailoring-file — kept
 * distinct since they're different strings. */
export async function saveScan({ profileId, profileTitle, sdsPath, tailoringFile, tailoringPath, parsed, files, ruleMeta, baseProfileId }) {
    const rootDir = await getScanHistoryDir();
    await ensureUserDir(rootDir);

    const ts = makeTimestamp();
    const dir = `${rootDir}/${ts}`;
    await cockpit.spawn(['mkdir', '-p', dir], { err: 'message' });

    const reportPath = `${dir}/report.html`;
    const resultsGzPath = `${dir}/results.xml.gz`;
    const arfGzPath = `${dir}/arf.xml.gz`;
    const manifestPath = `${dir}/manifest.json`;

    await Promise.all([
        writeBinaryFile(reportPath, files.reportHtml),
        writeBinaryFile(resultsGzPath, files.resultsXmlGz),
        writeBinaryFile(arfGzPath, files.arfXmlGz),
    ]);

    await cockpit.spawn(['chmod', '700', dir], { err: 'message' });
    await cockpit.spawn(
        ['chmod', '600', reportPath, resultsGzPath, arfGzPath],
        { err: 'message' }
    );

    const manifest = {
        timestamp: ts,
        profile_id: profileId,
        profile_title: profileTitle || profileId,
        base_profile_id: baseProfileId || profileId,
        sds_file: sdsPath,
        tailoring_file: tailoringFile || null,
        tailoring_path: tailoringPath || null,
        score: parsed.scorePercent,
        counts: { pass: parsed.pass, fail: parsed.fail },
        rule_meta: ruleMeta || {},
    };
    await writeManifest(manifestPath, manifest);
    return { ...manifest, dir };
}

/* List all saved scans, newest first. Each entry is the manifest content
 * plus a runtime-only `dir` field (derived from rootDir + timestamp, not
 * persisted — the timestamp doubles as the directory name). */
export async function listScans() {
    const rootDir = await getScanHistoryDir();
    let output;
    try {
        output = await cockpit.spawn(['ls', rootDir], { superuser: 'try', err: 'ignore' });
    } catch {
        return [];
    }
    const entries = output.trim().split('\n')
            .filter(Boolean);
    const manifests = await Promise.all(entries.map(async ts => {
        const dir = `${rootDir}/${ts}`;
        try {
            // cockpit.file().read() resolves with null (doesn't reject) for a
            // missing file, and JSON.parse(null) returns null without
            // throwing — so a directory left behind by a failed/interrupted
            // save (mkdir succeeded, manifest.json write never reached)
            // would otherwise pass through as {dir} and render a blank row.
            const content = await cockpit.file(`${dir}/manifest.json`, { superuser: 'try' }).read();
            const manifest = JSON.parse(content);
            if (!manifest || typeof manifest !== 'object') throw new Error('empty manifest');
            return { ...manifest, dir };
        } catch {
            return null;
        }
    }));
    return manifests.filter(Boolean)
            .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}

/* Read back a saved scan's files for the "View report"/"Download" actions.
 * Mirrors readResults()'s shape (lib/oscap.js) so ScanResults.jsx can
 * consume either without special-casing: reportHtml/resultsXmlGz/arfXmlGz
 * as Uint8Array, resultsXml as plain text (decompressed on the fly for
 * re-parsing — no extra file kept on disk beyond the three saved above). */
export async function readSavedScanFiles(manifest) {
    const rootDir = await getScanHistoryDir();
    if (!manifest.dir || !manifest.dir.startsWith(rootDir + '/')) {
        throw new Error('Refusing to read a scan directory outside ' + rootDir);
    }
    const [reportHtml, resultsXmlGz, arfXmlGz, resultsXml] = await Promise.all([
        cockpit.spawn(['cat', `${manifest.dir}/report.html`], { binary: true, superuser: 'try', err: 'message' }),
        cockpit.spawn(['cat', `${manifest.dir}/results.xml.gz`], { binary: true, superuser: 'try', err: 'message' }),
        cockpit.spawn(['cat', `${manifest.dir}/arf.xml.gz`], { binary: true, superuser: 'try', err: 'message' }),
        cockpit.spawn(['gzip', '-dc', `${manifest.dir}/results.xml.gz`], { superuser: 'try', err: 'message' }),
    ]);
    return { reportHtml, resultsXmlGz, arfXmlGz, resultsXml };
}

export async function deleteScan(manifest) {
    const rootDir = await getScanHistoryDir();
    if (!manifest.dir || !manifest.dir.startsWith(rootDir + '/')) {
        throw new Error('Refusing to delete a scan directory outside ' + rootDir);
    }
    await cockpit.spawn(['rm', '-rf', manifest.dir], { err: 'message' });
}
