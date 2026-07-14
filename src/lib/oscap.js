import cockpit from 'cockpit';

import { listUploadedContent } from './content.js';
import { parseTailoringXml, readTailoringXml } from './tailoring.js';

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

// Both of these run directly against static, world-readable SCAP content
// (no results.xml, no scan, no tmpdir) — no superuser needed. profileId must
// already be resolved to the tailoring's base profile id when tailoringPath
// is set — oscap resolves a tailoring profile against the base Benchmark.
// generateGuide is used by ScanSetup.jsx (pre-scan); generateProfileFix here
// is the *whole-profile* fix, also only used by ScanSetup.jsx. Rule-scoped
// Fix generation (ScanResults.jsx, live or saved scan) uses generateScopedFix
// below instead — see its comment for why.
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

function escapeXml(s) {
    return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
}

/* oscap 1.4.3's `xccdf generate fix` has no working per-rule scoping: its
 * `--rule` flag isn't a documented Fix option (confirmed against --help) and
 * is silently ignored — passing it alongside --profile/--tailoring-file
 * still generates a fix for the *entire* profile, not just the named
 * rule(s). Verified empirically: --rule combined with --profile produced a
 * 321-rule script for a single requested rule.
 *
 * The only way to scope `generate fix` to an arbitrary rule subset is a
 * *standalone* (non-extending) XCCDF tailoring Profile containing only
 * <select idref=.../> entries for the wanted rules — with no `extends`,
 * nothing else is selected, so the output is exactly those rules. Verified
 * this produces byte-identical remediation content (module minor "N / total"
 * counter comments) to generating the full set of failing rules via
 * --result-id and diffing out the one rule of interest.
 *
 * If tailoringPath is given, its <set-value> overrides are copied into the
 * ephemeral profile too, so a customized rule parameter (e.g. a tailored
 * password length) still remediates to the tailored value instead of the
 * profile default — rule *selection* deltas from the original tailoring are
 * irrelevant here since selection is being overridden anyway. */
export async function generateScopedFix(sdsPath, tailoringPath, ruleIds, fixType) {
    let valueChanges = {};
    if (tailoringPath) {
        const xml = await readTailoringXml(tailoringPath);
        valueChanges = parseTailoringXml(xml).valueChanges;
    }

    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Tailoring xmlns="http://checklists.nist.gov/xccdf/1.2" id="xccdf_cockpit-scap_tailoring_fixscope">',
        '  <version time="' + new Date().toISOString()
                .slice(0, 19) + '">1</version>',
        '  <Profile id="xccdf_cockpit-scap_profile_fixscope">',
        '    <title>cockpit-scap rule-scoped fix</title>',
    ];
    for (const id of ruleIds) lines.push('    <select idref="' + escapeXml(id) + '" selected="true"/>');
    for (const [id, val] of Object.entries(valueChanges)) {
        lines.push('    <set-value idref="' + escapeXml(id) + '">' + escapeXml(val) + '</set-value>');
    }
    lines.push('  </Profile>', '</Tailoring>');
    const xml = lines.join('\n');

    const tmpPath = (await cockpit.spawn(
        ['mktemp', '/tmp/cockpit-scap-fixscope-XXXXXX.xml'], { err: 'message' }
    )).trim();
    try {
        await cockpit.file(tmpPath).replace(xml);
        return await cockpit.spawn([
            'oscap', 'xccdf', 'generate', 'fix', '--fix-type', fixType,
            '--profile', 'xccdf_cockpit-scap_profile_fixscope',
            '--tailoring-file', tmpPath, sdsPath,
        ], { err: 'message' });
    } finally {
        cockpit.spawn(['rm', '-f', tmpPath], { err: 'ignore' }).catch(() => {});
    }
}
