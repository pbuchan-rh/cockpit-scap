import cockpit from 'cockpit';

import { ensureUserDir, getUser, makeTimestamp } from './homedir.js';

const SCAN_HISTORY_SUBDIR = 'SCAP/scans';

export async function getScanHistoryDir() {
    const user = await getUser();
    return `${user.home}/${SCAN_HISTORY_SUBDIR}`;
}

/* Binary sibling of cockpit.file().replace() — cockpit.file() is text-only,
 * and report.html / the gzipped XML blobs are Uint8Array. dd (not tee)
 * avoids echoing the payload back to stdout.
 *
 * Data must be sent via proc.input(), not the { input: data } spawn option —
 * that option is merged verbatim into the JSON "open" control message, which
 * mangles a Uint8Array (JSON.stringify turns it into an index->byte object)
 * and never signals stdin EOF, so dd blocks forever waiting for more input.
 * proc.input() sends it as a real binary channel frame and then sends the
 * "done" control message to close stdin. */
async function writeBinaryFile(path, data) {
    const proc = cockpit.spawn(['dd', 'status=none', `of=${path}`], { superuser: 'require', binary: true, err: 'message' });
    proc.input(data);
    await proc;
}

/* Write manifest.json, chown/chmod, then read it back and compare — same
 * hardened-system write-verification guard as lib/tailoring.js's
 * writeTailoringFiles(), applied here since it was never done for scan
 * manifests in old main. */
async function writeManifest(path, manifest, username) {
    const content = JSON.stringify(manifest, null, 2);
    await cockpit.file(path, { superuser: 'require' }).replace(content);
    await cockpit.spawn(['chown', `${username}:${username}`, path], { superuser: 'require', err: 'message' });
    await cockpit.spawn(['chmod', '600', path], { superuser: 'require', err: 'message' });

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
 * shape (lib/results.js): { scorePercent, pass, fail, ... }. */
export async function saveScan({ profileId, profileTitle, sdsPath, tailoringFile, parsed, files }) {
    const user = await getUser();
    const rootDir = await getScanHistoryDir();
    await ensureUserDir(rootDir, user.name);

    const ts = makeTimestamp();
    const dir = `${rootDir}/${ts}`;
    await cockpit.spawn(['mkdir', '-p', dir], { superuser: 'require', err: 'message' });

    const reportPath = `${dir}/report.html`;
    const resultsGzPath = `${dir}/results.xml.gz`;
    const arfGzPath = `${dir}/arf.xml.gz`;
    const manifestPath = `${dir}/manifest.json`;

    await Promise.all([
        writeBinaryFile(reportPath, files.reportHtml),
        writeBinaryFile(resultsGzPath, files.resultsXmlGz),
        writeBinaryFile(arfGzPath, files.arfXmlGz),
    ]);

    await cockpit.spawn(
        ['chown', `${user.name}:${user.name}`, dir, reportPath, resultsGzPath, arfGzPath],
        { superuser: 'require', err: 'message' }
    );
    await cockpit.spawn(['chmod', '700', dir], { superuser: 'require', err: 'message' });
    await cockpit.spawn(
        ['chmod', '600', reportPath, resultsGzPath, arfGzPath],
        { superuser: 'require', err: 'message' }
    );

    const manifest = {
        timestamp: ts,
        profile_id: profileId,
        profile_title: profileTitle || profileId,
        sds_file: sdsPath,
        tailoring_file: tailoringFile || null,
        score: parsed.scorePercent,
        counts: { pass: parsed.pass, fail: parsed.fail },
    };
    await writeManifest(manifestPath, manifest, user.name);
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
    await cockpit.spawn(['rm', '-rf', manifest.dir], { superuser: 'require', err: 'message' });
}
