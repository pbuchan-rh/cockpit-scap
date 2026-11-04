import cockpit from 'cockpit';

import { diskUsageBytes } from './format.js';
import { ensureUserDir, getUser, makeTimestamp, readUserFile, spawnUserRead, writeBinaryFile } from './homedir.js';

const SCAN_HISTORY_SUBDIR = 'SCAP/scans';

export async function getScanHistoryDir() {
    const user = await getUser();
    return `${user.home}/${SCAN_HISTORY_SUBDIR}`;
}

/* Bytes used by ~/SCAP/scans (user-owned, no superuser); 0 before the
 * first scan. */
export async function getScanHistoryDiskUsage() {
    return diskUsageBytes(await getScanHistoryDir());
}

/* Write manifest.json, chmod, then read it back and compare — same
 * hardened-system write-verification guard as lib/tailoring.js's
 * writeTailoringFiles(), applied here since it was never done for scan
 * manifests in old main. */
async function writeManifest(path, manifest) {
    const content = JSON.stringify(manifest, null, 2);
    await cockpit.file(path).replace(content);
    await cockpit.spawn(['chmod', '600', path], { err: 'message' });

    const written = await readUserFile(path);
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
 * distinct since they're different strings. `scanDurationS` is whole seconds
 * from scan start to oscap's exit: the next scan of the same content,
 * profile and tailoring counts down from it (findPriorScanDuration). */
export async function saveScan({ profileId, profileTitle, sdsPath, tailoringFile, tailoringPath, parsed, files, ruleMeta, baseProfileId, scanDurationS }) {
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
        scan_duration_s: Number.isFinite(scanDurationS) ? scanDurationS : null,
        rule_meta: ruleMeta || {},
    };
    await writeManifest(manifestPath, manifest);
    return { ...manifest, dir };
}

const SCAN_PROFILE_FIELDS = ['timestamp', 'sds_file', 'profile_id', 'base_profile_id', 'profile_title'];

/* Saved scans as [{dir, timestamp, sds_file, profile_id, base_profile_id,
 * profile_title}], newest first, for Host Scan's preselected profile
 * (4.6.2). One grep of the manifests' top-level lines (writeManifest
 * indents them by two spaces) instead of reading them whole: a manifest
 * carries its rule_meta, ~1.5 MB, and listScans() pulls all of them
 * through the bridge. Root-owned scans: a manifest the user cannot read
 * reports a permission error, so spawnUserRead() retries as superuser. */
export async function listScanProfiles() {
    const rootDir = await getScanHistoryDir();
    const script = [
        'denied() { echo "Permission denied" >&2; exit 2; }',
        'cd -- "$1" 2>/dev/null || { [ -e "$1" ] && denied; exit 0; }',
        'for d in */; do',
        '    [ -d "$d" ] || continue',
        '    { [ -r "$d" ] && [ -x "$d" ]; } || denied',
        '    [ ! -e "$d/manifest.json" ] || [ -r "$d/manifest.json" ] || denied',
        'done',
        `grep -s -H -E '^  "(${SCAN_PROFILE_FIELDS.join('|')})": ' -- */manifest.json || true`,
    ].join('\n');
    let output;
    try {
        output = await spawnUserRead(['sh', '-c', script, 'sh', rootDir]);
    } catch {
        return [];
    }
    const scans = new Map();
    for (const line of output.split('\n')) {
        const m = line.match(/^([^/]+)\/manifest\.json: {2}("[a-z_]+": .*?),?$/);
        if (!m) continue;
        try {
            const field = JSON.parse('{' + m[2] + '}');
            if (!scans.has(m[1])) scans.set(m[1], { dir: `${rootDir}/${m[1]}` });
            Object.assign(scans.get(m[1]), field);
        } catch {
            // not a plain one-line value: skip it
        }
    }
    return [...scans.values()].filter(sc => sc.timestamp)
            .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}

/* A manifest without its rule_meta value, as JSON: awk drops the lines
 * between '  "rule_meta": {' and its closing '  }' (writeManifest indents
 * top-level keys by two spaces; JSON.stringify leaves no raw newline inside
 * a string, so no deeper line starts that way) and writes
 * '"rule_meta": null' in their place. One record per scan dir, each
 * starting with \x1e and the dir name on its own line. Same permission
 * checks as listScanProfiles(). */
const LIGHT_MANIFESTS_SCRIPT = [
    'denied() { echo "Permission denied" >&2; exit 2; }',
    'cd -- "$1" 2>/dev/null || { [ -e "$1" ] && denied; exit 0; }',
    'for d in */; do',
    '    [ -d "$d" ] || continue',
    '    { [ -r "$d" ] && [ -x "$d" ]; } || denied',
    '    [ ! -e "$d/manifest.json" ] || [ -r "$d/manifest.json" ] || denied',
    'done',
    'set -- */manifest.json',
    '[ -e "$1" ] || exit 0',
    "exec awk '",
    'FNR == 1 { skip = 0; d = FILENAME; sub(/\\/manifest\\.json$/, "", d); printf "\\036%s\\n", d }',
    'skip { if ($0 ~ /^  }/) { skip = 0; print "  \\"rule_meta\\": null" ($0 ~ /,$/ ? "," : "") } next }',
    '/^  "rule_meta": \\{$/ { skip = 1; next }',
    '{ print }',
    "' \"$@\"",
].join('\n');

/* List all saved scans, newest first. Each entry is the manifest content
 * plus a runtime-only `dir` field (derived from rootDir + the directory
 * name, not persisted — the timestamp doubles as the directory name).
 * Entries leave out rule_meta (~1.5 MB per scan; 4.6.2): the list does not
 * need it, and View reads that one scan's whole manifest
 * (readScanManifest). A manifest the light read cannot parse is read
 * whole, so a row shows whenever its manifest parses, as before. */
export async function listScans() {
    const rootDir = await getScanHistoryDir();
    let output;
    try {
        output = await spawnUserRead(['sh', '-c', LIGHT_MANIFESTS_SCRIPT, 'sh', rootDir]);
    } catch {
        return [];
    }
    const records = output.split('\x1e').filter(Boolean);
    const manifests = await Promise.all(records.map(async record => {
        const nl = record.indexOf('\n');
        if (nl < 0) return null;
        const dir = `${rootDir}/${record.slice(0, nl)}`;
        let manifest;
        try {
            manifest = JSON.parse(record.slice(nl + 1));
        } catch {
            try {
                manifest = JSON.parse(await readUserFile(`${dir}/manifest.json`));
            } catch {
                return null;
            }
        }
        // A directory left behind by a failed/interrupted save (no
        // manifest.json) gives no record; an empty manifest gives no row.
        if (!manifest || typeof manifest !== 'object') return null;
        delete manifest.rule_meta;
        return { ...manifest, dir };
    }));
    return manifests.filter(Boolean)
            .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}

function checkScanDir(rootDir, dir) {
    if (!dir || !dir.startsWith(rootDir + '/')) {
        throw new Error('Refusing to read a scan directory outside ' + rootDir);
    }
}

/* One saved scan's whole manifest (rule_meta included), plus `dir`. */
export async function readScanManifest(dir) {
    checkScanDir(await getScanHistoryDir(), dir);
    const manifest = JSON.parse(await readUserFile(`${dir}/manifest.json`));
    if (!manifest || typeof manifest !== 'object') throw new Error('empty manifest');
    return { ...manifest, dir };
}

/* Seconds a saved scan took, from its own results' TestResult start-time
 * and end-time (what the results page shows as "Duration"). Only the
 * opening tag is read: grep -m1 stops gzip right after it. */
async function resultsDurationS(dir) {
    try {
        const tag = await spawnUserRead(
            ['sh', '-c', 'gzip -dc -- "$1" | grep -m1 -oE "<([A-Za-z0-9_.-]+:)?TestResult [^>]*>"', 'sh', `${dir}/results.xml.gz`]
        );
        const start = tag.match(/start-time="([^"]+)"/)?.[1];
        const end = tag.match(/end-time="([^"]+)"/)?.[1];
        const s = Math.round((new Date(end) - new Date(start)) / 1000);
        return Number.isFinite(s) && s > 0 ? s : null;
    } catch {
        return null;
    }
}

/* How long the newest saved scan of the same content, profile and
 * tailoring took, in seconds, for the running view's countdown (as v3).
 * Scan dirs newest first by name, from the light listing (no rule_meta);
 * a match saved before scan_duration_s existed falls back to its own
 * results file. null when no saved scan matches. */
export async function findPriorScanDuration({ profileId, sdsPath, tailoringPath }) {
    const scans = (await listScans()).sort((a, b) => b.dir.localeCompare(a.dir));
    const match = scans.find(m => m.profile_id === profileId && m.sds_file === sdsPath &&
        (m.tailoring_path || null) === (tailoringPath || null));
    if (!match) return null;
    if (Number.isFinite(match.scan_duration_s) && match.scan_duration_s > 0)
        return match.scan_duration_s;
    return resultsDurationS(match.dir);
}

/* gzip bytes -> text, in the browser. */
async function gunzipText(bytes) {
    const stream = new Blob([bytes]).stream()
            .pipeThrough(new DecompressionStream('gzip'));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

/* What the results view needs from a saved scan's files (with its
 * manifest): resultsXml, the decompressed results XML, and resultsXmlGz,
 * the saved results.xml.gz as read (Download -> Results XML). Only the
 * gzipped file crosses the bridge (~1.2 MB instead of ~15 MB) and is
 * decompressed here; without DecompressionStream, or if it fails, gzip -dc
 * on the host as before. report.html and arf.xml.gz are read only when
 * View report or a Download asks for them (readSavedScanFile; 4.6.2). */
export async function readSavedScanResults(manifest) {
    const resultsXmlGz = await readSavedScanFile(manifest, 'xml');
    let resultsXml;
    try {
        resultsXml = await gunzipText(resultsXmlGz);
    } catch {
        resultsXml = await spawnUserRead(['gzip', '-dc', `${manifest.dir}/results.xml.gz`]);
    }
    return { resultsXml, resultsXmlGz };
}

const SAVED_SCAN_FILES = { html: 'report.html', xml: 'results.xml.gz', arf: 'arf.xml.gz' };

/* One saved scan file, byte for byte, as a Uint8Array: 'html'
 * (report.html), 'xml' (results.xml.gz) or 'arf' (arf.xml.gz). */
export async function readSavedScanFile(manifest, kind) {
    checkScanDir(await getScanHistoryDir(), manifest.dir);
    const name = SAVED_SCAN_FILES[kind];
    if (!name) throw new Error('Unknown scan file: ' + kind);
    return spawnUserRead(['cat', `${manifest.dir}/${name}`], { binary: true });
}

export async function deleteScan(manifest) {
    const rootDir = await getScanHistoryDir();
    if (!manifest.dir || !manifest.dir.startsWith(rootDir + '/')) {
        throw new Error('Refusing to delete a scan directory outside ' + rootDir);
    }
    await cockpit.spawn(['rm', '-rf', manifest.dir], { err: 'message' });
}
