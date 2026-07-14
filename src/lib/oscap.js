import cockpit from 'cockpit';

import { listUploadedContent } from './content.js';

const SSG_CONTENT_DIR = '/usr/share/xml/scap/ssg/content';

async function detectSystemContent() {
    try {
        const output = await cockpit.spawn(
            ['find', SSG_CONTENT_DIR, '-name', '*-ds.xml', '-type', 'f'],
            { err: 'ignore' }
        );
        return output.trim().split('\n')
                .filter(Boolean)
                .sort();
    } catch {
        return [];
    }
}

/* Merges auto-detected SSG system content with the user's uploaded content
 * (~/SCAP/content/, see lib/content.js), tagged by source so every picker
 * (ScanSetup.jsx, TailoringEditor.jsx, TailoringList.jsx) can render both
 * without reimplementing detection. Breaking return-shape change from bare
 * path strings to {path, source} objects — see PLAN_V4.3_CONTENT_UPLOAD.md
 * Decision 6. */
export async function detectContent() {
    const [system, uploaded] = await Promise.all([detectSystemContent(), listUploadedContent()]);
    return [
        ...system.map(path => ({ path, source: 'system' })),
        ...uploaded.map(c => ({ path: c.path, source: 'uploaded' })),
    ];
}

/* Consolidates three previously copy-pasted sdsDisplayName() implementations
 * (ScanSetup.jsx, TailoringEditor.jsx, TailoringList.jsx). SSG's
 * ssg-<id>-ds.xml stripping only makes sense for system content; uploaded
 * files just lose their .xml extension. `source` is optional — call sites
 * that only have a bare path (e.g. a saved tailoring sidecar's sds_path,
 * with no {path,source} object available) fall back to detecting system
 * content by its fixed install-path prefix. */
export function sdsDisplayName(path, source) {
    if (!path) return '—';
    const name = path.split('/').pop() ?? path;
    const src = source ?? (path.startsWith(SSG_CONTENT_DIR + '/') ? 'system' : 'uploaded');
    if (src === 'system') {
        return name.replace(/^ssg-/, '').replace(/-ds\.xml$/, '')
                .replace(/-/g, ' ');
    }
    return name.replace(/\.xml$/, '');
}

export async function getOsRelease() {
    try {
        const output = await cockpit.spawn(['cat', '/etc/os-release'], { err: 'ignore' });
        const id = (output.match(/^ID=(.*)$/m)?.[1] ?? '').replace(/"/g, '').toLowerCase();
        const versionId = (output.match(/^VERSION_ID=(.*)$/m)?.[1] ?? '').replace(/"/g, '').toLowerCase();
        return { id, versionId };
    } catch {
        return { id: '', versionId: '' };
    }
}

export async function getProfiles(sdsPath) {
    const output = await cockpit.spawn(['oscap', 'info', sdsPath], { err: 'message' });
    const profiles = [];
    let currentTitle = null;
    for (const line of output.split('\n')) {
        const s = line.trim();
        if (s.startsWith('Title:')) {
            currentTitle = s.slice(6).trim();
        } else if (s.startsWith('Id:') && currentTitle) {
            profiles.push({ id: s.slice(3).trim(), title: currentTitle });
            currentTitle = null;
        }
    }
    return profiles;
}

export async function makeTmpdir() {
    const output = await cockpit.spawn(
        ['mktemp', '-d', '/tmp/cockpit-scap-XXXXXX'],
        { superuser: 'require', err: 'message' }
    );
    return output.trim();
}

export function startScan(config, tmpdir, onOutput) {
    const args = ['oscap', 'xccdf', 'eval'];
    if (config.tailoring) args.push('--tailoring-file', config.tailoring);
    args.push('--profile', config.profile);
    args.push('--results', `${tmpdir}/results.xml`);
    args.push('--results-arf', `${tmpdir}/arf.xml`);
    args.push('--report', `${tmpdir}/report.html`);
    args.push(config.content);

    const proc = cockpit.spawn(args, { superuser: 'require', err: 'out' });
    let buf = '';
    proc.stream(chunk => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) onOutput(line);
    });
    return proc;
}

export async function readResults(tmpdir) {
    const [reportHtml, resultsXmlGz, arfXmlGz, resultsXml] = await Promise.all([
        cockpit.spawn(['cat', `${tmpdir}/report.html`], { binary: true, superuser: 'require', err: 'message' }),
        cockpit.spawn(['gzip', '-c', `${tmpdir}/results.xml`], { binary: true, superuser: 'require', err: 'message' }),
        cockpit.spawn(['gzip', '-c', `${tmpdir}/arf.xml`], { binary: true, superuser: 'require', err: 'message' }),
        cockpit.spawn(['cat', `${tmpdir}/results.xml`], { superuser: 'require', err: 'message' }),
    ]);
    return { reportHtml, resultsXmlGz, arfXmlGz, resultsXml };
}

export async function cleanupTmpdir(tmpdir) {
    try {
        await cockpit.spawn(['rm', '-rf', tmpdir], { superuser: 'require', err: 'ignore' });
    } catch {
        // best-effort
    }
}

export async function generateFix(tmpdir, ruleIds, fixType) {
    const args = ['oscap', 'xccdf', 'generate', 'fix', '--fix-type', fixType];
    for (const id of ruleIds) args.push('--rule', id);
    args.push(`${tmpdir}/results.xml`);
    return cockpit.spawn(args, { superuser: 'require', err: 'message' });
}

// Both of these run directly against static, world-readable SCAP content
// (no results.xml, no scan) — no superuser needed, unlike generateFix()
// above which reads out of the root-owned scan tmpdir. profileId must
// already be resolved to the tailoring's base profile id when tailoringPath
// is set — oscap resolves a tailoring profile against the base Benchmark.
export async function generateGuide(sdsPath, profileId, tailoringPath) {
    const args = ['oscap', 'xccdf', 'generate', 'guide', '--profile', profileId];
    if (tailoringPath) args.push('--tailoring-file', tailoringPath);
    args.push(sdsPath);
    return cockpit.spawn(args, { err: 'message' });
}

export async function generateProfileFix(sdsPath, profileId, tailoringPath, fixType) {
    const args = ['oscap', 'xccdf', 'generate', 'fix', '--fix-type', fixType, '--profile', profileId];
    if (tailoringPath) args.push('--tailoring-file', tailoringPath);
    args.push(sdsPath);
    return cockpit.spawn(args, { err: 'message' });
}
