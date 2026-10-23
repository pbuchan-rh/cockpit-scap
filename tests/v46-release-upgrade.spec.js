// Release gate: data written by the INSTALLED 4.6.0 RPM still works after
// `dnf upgrade` to the release candidate. Two phases on the disposable
// scap-apply10, run with SCAP_SHELL_PATH=/scap (the RPM, not the dev copy):
//
//   UPGRADE_PHASE=seed    with 4.6.0 installed: one CIS L1 scan saved to
//                         Scan History, one editor-made CIS tailoring (a
//                         rule and a variable change), one uploaded
//                         tailoring (refine-value, refine-rule, a
//                         description, a second Profile, a Profile without
//                         extends); records every ~/SCAP md5sum.
//   (dnf upgrade to the release candidate)
//   UPGRADE_PHASE=verify  the files are unchanged by the upgrade; the old
//                         scan lists, opens, its report view and downloads
//                         work; the editor-made tailoring opens with its
//                         deltas and CIS minlen now shows the profile's 14;
//                         Update on both tailorings keeps what the editor
//                         does not write, and the uploaded file's bytes
//                         outside its root (P1); the uploaded two-Profile
//                         policy lists with the counted "Rules Modified",
//                         not 4.6.0's stored one, its files untouched (P2);
//                         a scan with each tailoring runs.
//
// Without UPGRADE_PHASE every test skips, so the spec is inert in a suite
// run. The phases share tests/test-results/upgrade-state.json (gitignored).
// It leaves its data in ~/SCAP for inspection; everything it creates
// carries "v46-test" in its name (scans: see the state file).
const { requireApplyHost, sshApplyHost } = require('./helpers/apply-host');
requireApplyHost();

const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn, SHELL_PATH } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

const PHASE = process.env.UPGRADE_PHASE || '';
const STATE = `${__dirname}/test-results/upgrade-state.json`;
const OLD_NVR = /^cockpit-scap-4\.6\.0-1\.el10\.noarch$/;
const NEW_NVR = /^cockpit-scap-4\.6\.1-(0\.\d+\.rc\d+|1)\.el10\.noarch$/;

const PROFILE_CIS = 'xccdf_org.ssgproject.content_profile_cis';
const VAL = 'xccdf_org.ssgproject.content_value_';
const MINLEN = VAL + 'var_password_pam_minlen';
const DENY = VAL + 'var_accounts_passwords_pam_faillock_deny';
const EDITOR_NAME = 'v46-test upgrade editor';
const EDITOR_SLUG = 'v46-test-upgrade-editor';
const UPLOAD_NAME = 'v46-test upgrade uploaded';
const UPLOAD_SLUG = 'v46-test-upgrade-uploaded';
const UPLOAD_PROFILE = 'xccdf_org.cockpit-scap.test_profile_v46-test-upgrade-uploaded';

const UPLOAD_XML = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- v46-test: uploaded on 4.6.0, with elements the editor does not write -->',
    '<Tailoring xmlns="http://checklists.nist.gov/xccdf/1.2" id="xccdf_org.cockpit-scap.test_tailoring_v46-test-upgrade">',
    `  <benchmark href="${S.DS}"/>`,
    '  <status>draft</status>',
    '  <version time="2026-10-20T00:00:00">7</version>',
    `  <Profile id="${UPLOAD_PROFILE}">`,
    `    <title>${UPLOAD_NAME}</title>`,
    '    <description>Uploaded on 4.6.0 with extras</description>',
    `    <select idref="${S.RULE}package_aide_installed" selected="true"/>`,
    `    <refine-value idref="${MINLEN}" selector="12"/>`,
    `    <refine-rule idref="${S.RULE}package_aide_installed" severity="high"/>`,
    '  </Profile>',
    `  <Profile id="${UPLOAD_PROFILE}-other" extends="${S.PROFILE_L1}">`,
    '    <title>v46-test upgrade uploaded other</title>',
    `    <select idref="${S.RULE}aide_build_database" selected="false"/>`,
    '  </Profile>',
    '</Tailoring>',
    '',
].join('\n');

let page, frame, home;

test.beforeAll(async ({ browser }) => {
    test.skip(!['seed', 'verify'].includes(PHASE), 'set UPGRADE_PHASE=seed (4.6.0 installed) or verify (after dnf upgrade)');
    if (SHELL_PATH !== '/scap') throw new Error(`run with SCAP_SHELL_PATH=/scap (the installed RPM), not ${SHELL_PATH}`);
    page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    home = await S.homeDir(frame);
});

test.afterAll(async () => { await page?.close() });

const editor = () => frame.locator('.ct-tailor-editor-card');
const bar = () => editor().locator('[data-ct-tailor-actionbar]');
const policiesCard = () => frame.locator('.pf-v6-c-card').filter({ has: frame.getByRole('heading', { name: 'Saved Tailoring Policies' }) });
const policyRow = name => policiesCard().locator('tbody tr')
        .filter({ has: frame.getByRole('gridcell', { name, exact: true }) });
const valueField = id => editor().locator(`[id="ct-tailor-value-${id}"]`);
const historyRow = ts => frame.getByRole('grid', { name: 'Scan history' }).locator('tbody tr')
        .filter({ hasText: ts.slice(0, 10) + ' ' + ts.slice(11).replace(/-/g, ':') });

function readState() { return JSON.parse(fs.readFileSync(STATE, 'utf8')) }
function writeState(patch) {
    const cur = fs.existsSync(STATE) ? readState() : {};
    fs.mkdirSync(`${__dirname}/test-results`, { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify({ ...cur, ...patch }, null, 2));
}

async function md5s() {
    const out = await hostSpawn(frame, ['sh', '-c', `cd "${home}" && find SCAP -type f -print0 | sort -z | xargs -0 -r md5sum`]);
    return Object.fromEntries(out.trim().split('\n')
            .filter(Boolean)
            .map(l => [l.slice(34), l.slice(0, 32)]));
}

async function tailoringPath(slug) {
    return (await hostSpawn(frame, ['sh', '-c', `ls "${home}"/SCAP/tailoring/${slug}-*.xml`])).trim();
}

async function profilesOf(xml) {
    return frame.evaluate(xml => {
        const NS = 'http://checklists.nist.gov/xccdf/1.2';
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        return Array.from(doc.getElementsByTagNameNS(NS, 'Profile')).map(p => ({
            id: p.getAttribute('id'),
            hasExtends: p.hasAttribute('extends'),
            extends: p.getAttribute('extends'),
            children: Array.from(p.children).map(c => ({
                tag: c.localName,
                idref: c.getAttribute('idref'),
                selected: c.getAttribute('selected'),
                selector: c.getAttribute('selector'),
                severity: c.getAttribute('severity'),
                text: c.children.length ? '' : c.textContent.trim(),
            })),
        }));
    }, xml);
}

async function showVariable(term) {
    const toggle = editor().locator('#ct-tailor-values-title-toggle');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await editor().locator('#ct-tailor-values-title-content')
            .getByRole('textbox', { name: 'Search variables' })
            .fill(term);
}

async function toggleRule(title) {
    const search = editor().getByRole('textbox', { name: 'Search rules' });
    await search.fill(title);
    await editor().locator('.ct-tailor-tree input[type=checkbox]')
            .first()
            .click();
    await search.fill('');
}

async function rpmNvr() {
    return sshApplyHost('rpm -q cockpit-scap').trim();
}

test.describe('seed (4.6.0 installed)', () => {
    test.beforeAll(() => { test.skip(PHASE !== 'seed', 'seed phase only') });

    test('the installed RPM is 4.6.0', async () => {
        const nvr = await rpmNvr();
        expect(nvr).toMatch(OLD_NVR);
        writeState({ seedNvr: nvr, seedScans: await S.snapshotScans(frame) });
    });

    test('a CIS L1 scan saved to Scan History', async () => {
        const before = readState().seedScans;
        await S.runScan(frame, { profileId: S.PROFILE_L1 });
        const scan = (await S.snapshotScans(frame)).filter(ts => !before.includes(ts));
        expect(scan).toHaveLength(1);
        writeState({ scan: scan[0] });
        await frame.locator('[data-ct-results]').getByRole('button', { name: 'Close', exact: true })
                .click();
        await expect(historyRow(scan[0])).toHaveCount(1);
    });

    test('an editor-made CIS tailoring with a rule change and a variable change', async () => {
        await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
        await S.pick(frame, '#ct-tailor-content-select', S.DS);
        await expect(frame.locator('#ct-tailor-profile-select')).toBeEnabled({ timeout: 60000 });
        await S.pick(frame, '#ct-tailor-profile-select', PROFILE_CIS);
        await editor().getByRole('button', { name: 'Load Rules' })
                .click();
        await expect(bar()).toBeVisible({ timeout: 120000 });
        // 4.6.0 shows the benchmark default here (F6); recorded, not asserted.
        await showVariable('pam_minlen');
        const minlenShown = await valueField(MINLEN).getAttribute('data-ct-value');
        await showVariable('faillock_deny');
        const denyShown = await valueField(DENY).getAttribute('data-ct-value');
        const denyNew = await S.pickOther(frame, valueField(DENY));
        await toggleRule('Install AIDE');
        await bar().getByRole('textbox', { name: 'Policy name' })
                .fill(EDITOR_NAME);
        await bar().getByRole('button', { name: 'Save Policy' })
                .click();
        await expect(policyRow(EDITOR_NAME)).toHaveCount(1, { timeout: 30000 });
        const xml = await hostSpawn(frame, ['cat', await tailoringPath(EDITOR_SLUG)]);
        const [p] = await profilesOf(xml);
        expect(p.extends).toBe(PROFILE_CIS);
        expect(p.children.filter(c => c.tag === 'select')).toEqual([
            expect.objectContaining({ idref: `${S.RULE}package_aide_installed`, selected: 'false' }),
        ]);
        expect(p.children.filter(c => c.tag === 'set-value')).toEqual([expect.objectContaining({ idref: DENY })]);
        writeState({ minlenShownOn460: minlenShown, denyShownOn460: denyShown, denyNew, editorXmlOn460: xml });
    });

    test('an uploaded tailoring with refine-value, refine-rule, a description and two Profiles', async () => {
        await policiesCard().locator('input[type=file]')
                .setInputFiles({ name: `${UPLOAD_SLUG}.xml`, mimeType: 'text/xml', buffer: Buffer.from(UPLOAD_XML) });
        await expect(policyRow(UPLOAD_NAME)).toHaveCount(1, { timeout: 30000 });
        const stored = await hostSpawn(frame, ['cat', await tailoringPath(UPLOAD_SLUG)]);
        writeState({ uploadXmlOn460: stored });
    });

    test('md5sums of everything in ~/SCAP', async () => {
        const sums = await md5s();
        expect(Object.keys(sums).length).toBeGreaterThan(4);
        writeState({ md5OnSeed: sums });
        console.log(JSON.stringify(sums, null, 2));
    });
});

test.describe('verify (after dnf upgrade to the release candidate)', () => {
    test.beforeAll(() => { test.skip(PHASE !== 'verify', 'verify phase only') });

    test('the RC is installed, rpm -V is clean, and the upgrade changed no ~/SCAP file', async () => {
        expect(await rpmNvr()).toMatch(NEW_NVR);
        expect(sshApplyHost('rpm -V cockpit-scap; echo rc=$?').trim()).toBe('rc=0');
        const seeded = readState().md5OnSeed;
        const now = await md5s();
        expect(now).toEqual(seeded);
        writeState({ md5AfterUpgrade: now });
    });

    test('the 4.6.0 scan lists, opens, shows its report and downloads', async () => {
        const { scan } = readState();
        const row = historyRow(scan);
        await expect(row).toHaveCount(1, { timeout: 30000 });
        await row.getByRole('button', { name: 'View', exact: true }).click();
        const results = frame.locator('[data-ct-results]');
        await expect(results).toBeVisible({ timeout: 60000 });
        await expect(results.locator('.ct-results-profile')).toContainText('CIS');
        const [popup] = await Promise.all([
            page.context().waitForEvent('page'),
            results.locator('.ct-results-footer').getByRole('button', { name: 'View report' })
                    .click(),
        ]);
        await popup.waitForURL(/\/viewer\.html/, { timeout: 30000 });
        await expect(popup.locator('body')).toContainText('Compliance and Scoring', { timeout: 60000 });
        await popup.close();
        await results.getByRole('button', { name: 'Close', exact: true }).click();
        const pick = async item => S.expectDownload(page, async () => {
            await row.getByRole('button', { name: /^Download scan from/ }).click();
            await frame.getByRole('menuitem', { name: new RegExp('^' + item) }).click();
        }, { binary: true });
        const html = await pick('HTML report');
        expect(html.filename).toMatch(/-report\.html$/);
        expect(html.buffer.toString('utf8', 0, 4000)).toMatch(/<html|<!DOCTYPE/i);
        const xml = await pick('Results XML');
        expect(xml.filename).toMatch(/^scan-results-.*\.xml\.gz$/);
        expect(xml.buffer[0]).toBe(0x1f);
        const arf = await pick('ARF');
        expect(arf.filename).toMatch(/-arf\.xml\.gz$/);
        expect(arf.buffer[0]).toBe(0x1f);
    });

    test('the uploaded two-Profile policy lists 1 rule modified, not the 2 that 4.6.0 stored; nothing is rewritten', async () => {
        await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
        await expect(policyRow(UPLOAD_NAME).getByRole('gridcell')
                .nth(3)).toHaveText('1', { timeout: 30000 });
        await expect(policyRow(EDITOR_NAME).getByRole('gridcell')
                .nth(3)).toHaveText('1');
        const sidecar = JSON.parse(await hostSpawn(frame, ['cat', (await tailoringPath(UPLOAD_SLUG)).replace(/\.xml$/, '.json')]));
        expect(sidecar.rules_modified).toBe(2);
        expect(await md5s()).toEqual(readState().md5OnSeed);
    });

    test('the editor-made tailoring opens with its deltas; minlen shows the CIS value 14; Update keeps them', async () => {
        const { denyNew } = readState();
        await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
        await policyRow(EDITOR_NAME).getByRole('button', { name: 'Edit' })
                .click();
        await expect(bar()).toBeVisible({ timeout: 120000 });
        await expect(bar()).toContainText('1 rule, 1 variable modified');
        await showVariable('pam_minlen');
        await expect(valueField(MINLEN)).toHaveAttribute('data-ct-value', '14');
        await showVariable('faillock_deny');
        await expect(valueField(DENY)).toHaveAttribute('data-ct-value', denyNew);
        await toggleRule('Install sudo Package');
        await expect(bar()).toContainText('2 rules, 1 variable modified');
        await bar().getByRole('button', { name: 'Update' })
                .click();
        await expect(editor().getByRole('heading', { name: 'New Tailoring Policy' })).toBeVisible();
        const xml = await hostSpawn(frame, ['cat', await tailoringPath(EDITOR_SLUG)]);
        expect(xml).not.toContain('extends=""');
        const [p] = await profilesOf(xml);
        expect(p.extends).toBe(PROFILE_CIS);
        const selects = p.children.filter(c => c.tag === 'select').map(c => c.idref);
        expect(selects).toEqual([`${S.RULE}package_aide_installed`, `${S.RULE}package_sudo_installed`]);
        expect(p.children.filter(c => c.tag === 'set-value')).toEqual([expect.objectContaining({ idref: DENY, text: denyNew })]);
        writeState({ editorXmlAfterUpdate: xml });
    });

    test('the uploaded tailoring: Update keeps refine-value, refine-rule, description, the second Profile; no extends=""', async () => {
        await policyRow(UPLOAD_NAME).getByRole('button', { name: 'Edit' })
                .click();
        await expect(bar()).toBeVisible({ timeout: 120000 });
        await expect(bar()).toContainText('1 rule, 0 variables modified');
        await toggleRule('Install sudo Package');
        await expect(bar()).toContainText('2 rules, 0 variables modified');
        await bar().getByRole('button', { name: 'Update' })
                .click();
        await expect(editor().getByRole('heading', { name: 'New Tailoring Policy' })).toBeVisible();
        const path = await tailoringPath(UPLOAD_SLUG);
        const xml = await hostSpawn(frame, ['cat', path]);
        expect(xml).not.toContain('extends=""');
        expect(xml).toContain('<status>draft</status>');
        expect(xml).toContain('<version time="2026-10-20T00:00:00">7</version>');
        expect(xml).toContain('<description>Uploaded on 4.6.0 with extras</description>');
        const [mine, other] = await profilesOf(xml);
        expect(mine.id).toBe(UPLOAD_PROFILE);
        expect(mine.hasExtends).toBe(false);
        expect(mine.children).toEqual([
            expect.objectContaining({ tag: 'title', text: UPLOAD_NAME }),
            expect.objectContaining({ tag: 'description' }),
            expect.objectContaining({ tag: 'select', idref: `${S.RULE}package_aide_installed`, selected: 'true' }),
            expect.objectContaining({ tag: 'select', idref: `${S.RULE}package_sudo_installed`, selected: 'true' }),
            expect.objectContaining({ tag: 'refine-value', idref: MINLEN, selector: '12' }),
            expect.objectContaining({ tag: 'refine-rule', idref: `${S.RULE}package_aide_installed`, severity: 'high' }),
        ]);
        expect(other.extends).toBe(S.PROFILE_L1);
        expect(other.children.map(c => [c.tag, c.idref, c.selected])).toEqual([
            ['title', null, null], ['select', `${S.RULE}aide_build_database`, 'false'],
        ]);
        const info = await hostSpawn(frame, ['sh', '-c', `oscap info "${path}" >/dev/null 2>&1; echo rc=$?`]);
        expect(info.trim()).toBe('rc=0');
        // P1: the bytes outside the root are the uploaded file's.
        const old = readState().uploadXmlOn460;
        const outside = x => [x.slice(0, x.indexOf('<Tailoring ')), x.slice(x.lastIndexOf('</Tailoring>') + '</Tailoring>'.length)];
        expect(outside(xml)).toEqual(outside(old));
        expect(outside(old)).toEqual([UPLOAD_XML.slice(0, UPLOAD_XML.indexOf('<Tailoring ')), '\n']);
        const sidecar = JSON.parse(await hostSpawn(frame, ['cat', path.replace(/\.xml$/, '.json')]));
        expect(sidecar.rules_modified).toBe(2);
        await expect(policyRow(UPLOAD_NAME).getByRole('gridcell')
                .nth(3)).toHaveText('2');
        writeState({ uploadXmlAfterUpdate: xml });
    });

    for (const [name, slug] of [[EDITOR_NAME, EDITOR_SLUG], [UPLOAD_NAME, UPLOAD_SLUG]]) {
        test(`a scan with "${name}" runs and is saved`, async () => {
            await frame.getByRole('tab', { name: 'Host Scan' }).click();
            const before = await S.snapshotScans(frame);
            await S.runScan(frame, { tailoringPath: await tailoringPath(slug) });
            const results = frame.locator('[data-ct-results]');
            await expect(results.locator('.ct-results-profile')).toContainText(name);
            const scan = (await S.snapshotScans(frame)).filter(ts => !before.includes(ts));
            expect(scan).toHaveLength(1);
            const manifest = JSON.parse(await hostSpawn(frame, ['cat', `${home}/SCAP/scans/${scan[0]}/manifest.json`]));
            expect(manifest.tailoring_path).toBe(await tailoringPath(slug));
            writeState({ [`scanWith_${slug}`]: scan[0] });
            await results.getByRole('button', { name: 'Close', exact: true }).click();
        });
    }
});
