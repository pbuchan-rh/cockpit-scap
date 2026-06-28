import cockpit from 'cockpit';

const SSG_CONTENT_DIR = '/usr/share/xml/scap/ssg/content';

export async function detectContent() {
    try {
        const output = await cockpit.spawn(
            ['find', SSG_CONTENT_DIR, '-name', '*-ds.xml', '-type', 'f'],
            { err: 'ignore' }
        );
        return output.trim().split('\n').filter(Boolean).sort();
    } catch {
        return [];
    }
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

export async function generateFix(tmpdir, ruleIds, template) {
    const args = ['oscap', 'xccdf', 'generate', 'fix', '--template', template];
    for (const id of ruleIds) args.push('--rule', id);
    args.push(`${tmpdir}/results.xml`);
    return cockpit.spawn(args, { superuser: 'require', err: 'message' });
}
