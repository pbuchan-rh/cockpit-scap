// 4.6.2, both browser projects.
//   Profiles: Host Scan and Policy Tailoring list the profiles (and show a
//       profile's description) from one light pass over the datastream,
//       cached per file version, instead of `oscap info` plus a full
//       extractProfile() per description. Same ids, titles and order.
//   CRLF: Update on a tailoring written with CRLF keeps CRLF inside the
//       root element too; LF files come out as before.
// The "unit" tests run src/lib code in a blank page (helpers/lib-bundle.js),
// no host. The others run INSIDE the Cockpit shell (/scap-dev); no scan.
// Everything they create carries "v46-test" in its name (or is a scan dir
// not in the snapshot) and is removed.
const { test, expect } = require('@playwright/test');
const { openModuleInShell, shellFrame, hostSpawn } = require('./helpers/cockpit');
const { loadLib } = require('./helpers/lib-bundle');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

const NS = 'http://checklists.nist.gov/xccdf/1.2';
const PROFILE = 'xccdf_org.cockpit-scap.test_profile_v46-test-462';

const rootXml = (nl, title = 'v46-test 462') => [
    `<Tailoring xmlns="${NS}" id="xccdf_org.cockpit-scap.test_tailoring_v46-test">`,
    `  <benchmark href="${S.DS}"/>`,
    '  <version time="2026-11-04T00:00:00">1</version>',
    `  <Profile id="${PROFILE}" extends="${S.PROFILE_L1}">`,
    `    <title>${title}</title>`,
    `    <select idref="${S.RULE}package_aide_installed" selected="true"/>`,
    '    <set-value idref="xccdf_org.ssgproject.content_value_var_password_pam_minlen">16</set-value>',
    '  </Profile>',
    '</Tailoring>',
].join(nl);

/* rootXml after the edit the tests make (aide off, a sudo select added:
 * selected in the unit tests; off in the shell, where clicking its
 * checkbox deselects it from CIS L1). */
const editedRootXml = (nl, title, sudo = 'true') => rootXml(nl, title)
        .replace(`package_aide_installed" selected="true"/>`,
                 `package_aide_installed" selected="false"/>${nl}    <select idref="${S.RULE}package_sudo_installed" selected="${sudo}"/>`);

const EDIT = { [`${S.RULE}package_aide_installed`]: false, [`${S.RULE}package_sudo_installed`]: true };
const VALUES = { 'xccdf_org.ssgproject.content_value_var_password_pam_minlen': '16' };

/* `oscap info` profile list, parsed the way getProfiles() parses it. */
function oscapInfoProfiles(text) {
    const out = [];
    let title = null;
    for (const line of text.split('\n')) {
        const s = line.trim();
        if (s.startsWith('Title:')) title = s.slice(6).trim();
        else if (s.startsWith('Id:') && title) { out.push({ value: s.slice(3).trim(), text: title }); title = null }
    }
    return out;
}

test.describe('unit', () => {
    let page;
    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        await loadLib(page, 'tailoring.js');
    });
    test.afterAll(async () => { await page?.close() });

    const update = xml => page.evaluate(([xml, profile, rules, values]) =>
        window.lib.updateTailoringXml(xml, profile, 'v46-test 462', rules, values), [xml, PROFILE, EDIT, VALUES]);

    test('CRLF: an Update keeps CRLF inside the root element too', async () => {
        const prefix = '<?xml version="1.0" encoding="UTF-8"?>\r\n<!-- v46-test -->\r\n';
        const suffix = '\r\n';
        const out = await update(prefix + rootXml('\r\n') + suffix);
        expect(JSON.stringify(out)).toBe(JSON.stringify(prefix + editedRootXml('\r\n') + suffix));
        // not one bare LF left
        expect(out.replace(/\r\n/g, '')).not.toContain('\n');
    });

    test('CRLF: an Update that changes nothing returns a CRLF file unchanged', async () => {
        const xml = '<?xml version="1.0"?>\r\n' + rootXml('\r\n') + '\r\n';
        const out = await page.evaluate(([xml, profile, rules, values]) =>
            window.lib.updateTailoringXml(xml, profile, 'v46-test 462', rules, values),
                                        [xml, PROFILE, { [`${S.RULE}package_aide_installed`]: true }, VALUES]);
        expect(JSON.stringify(out)).toBe(JSON.stringify(xml));
    });

    test('LF: an LF file comes out exactly as in 4.6.1, also with CRLF outside the root', async () => {
        for (const [prefix, suffix] of [['<?xml version="1.0"?>\n', '\n'], ['', ''], ['<?xml version="1.0"?>\r\n', '\r\n']]) {
            const out = await update(prefix + rootXml('\n') + suffix);
            expect(JSON.stringify(out)).toBe(JSON.stringify(prefix + editedRootXml('\n') + suffix));
        }
    });

    test('CRLF: usesCrlf follows most of the line breaks', async () => {
        const r = await page.evaluate(() => ['a\r\nb\r\nc', 'a\nb\nc', 'a\r\nb\nc', 'a\r\nb\r\nc\nd', 'abc', 'a\rb']
                .map(t => window.lib.usesCrlf(t)));
        expect(r).toEqual([true, false, true, true, false, false]);
    });

    test('Profiles: getProfileSummaries parses a file version once and does not cache failures', async () => {
        await loadLib(page, 'oscap.js');
        const r = await page.evaluate(async () => {
            const runs = [];
            let stamp = '1 100 7';
            let fail = false;
            const deps = {
                stat: async () => { if (stamp === null) throw new Error('no stat'); return stamp },
                run: async path => {
                    runs.push(path);
                    await new Promise(resolve => setTimeout(resolve, 20));
                    if (fail) throw new Error('broken');
                    return [{ id: 'p', title: 'P', description: 'd' }];
                },
            };
            const get = path => window.lib.getProfileSummaries(path, deps);
            const out = {};
            // two pickers asking at once: one parse
            const [a, b] = await Promise.all([get('/a.xml'), get('/a.xml')]);
            out.same = a === b;
            await get('/a.xml');
            out.afterThree = runs.length;
            await get('/b.xml');
            out.otherFile = runs.length;
            stamp = '1 200 7'; // file replaced (new mtime)
            await get('/a.xml');
            out.afterChange = runs.length;
            stamp = '2 300 8';
            fail = true;
            out.failed = await get('/a.xml').then(() => 'resolved', e => e.message);
            fail = false;
            await get('/a.xml');
            out.afterRetry = runs.length;
            stamp = null; // no key: not cached
            await get('/c.xml');
            await get('/c.xml');
            out.uncached = runs.length;
            return out;
        });
        expect(r).toEqual({ same: true, afterThree: 1, otherFile: 2, afterChange: 3, failed: 'broken', afterRetry: 5, uncached: 7 });
    });
});

test.describe('in the shell', () => {
    let page, frame, before, home, oscapList, pyExtract;

    test.beforeAll(async ({ browser }) => {
        // PY_EXTRACT_PROFILE, read before the shell page opens (a second
        // page opened later takes the keyboard focus in Firefox).
        const blank = await browser.newPage();
        await loadLib(blank, 'tailoring.js');
        pyExtract = await blank.evaluate(() => window.lib.PY_EXTRACT_PROFILE);
        await blank.close();
        page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        frame = await openModuleInShell(page);
        home = await S.homeDir(frame);
        before = await S.snapshotScans(frame);
        oscapList = oscapInfoProfiles(await hostSpawn(frame, ['oscap', 'info', S.DS]));
        expect(oscapList.length).toBeGreaterThan(5);
    });

    test.afterAll(async () => {
        if (frame) await S.cleanupCreated(frame, before);
        await page?.close();
    });

    const descCol = () => frame.locator('.ct-profile-desc-col').first();

    test('Profiles: Host Scan lists exactly what oscap info lists, in its order', async () => {
        await S.pick(frame, '#ct-scap-content', S.DS);
        expect(await S.pickerOptions(frame, '#ct-scap-profile')).toEqual(oscapList);
    });

    test('Profiles: the description shown is the profile\'s own, as extractProfile gives it', async () => {
        for (const id of [S.PROFILE_L1, oscapList[0].value]) {
            const want = JSON.parse(await hostSpawn(frame, ['python3', '-c', pyExtract, id, S.DS])).profile.description;
            expect(want.length).toBeGreaterThan(20);
            await S.pick(frame, '#ct-scap-profile', id);
            await expect(descCol().locator('p')
                    .nth(1)).toHaveText(want);
        }
    });

    test('Profiles: Policy Tailoring lists the same profiles', async () => {
        await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
        await S.pick(frame, '#ct-tailor-content-select', S.DS);
        await expect(frame.locator('#ct-tailor-profile-select')).toBeEnabled({ timeout: 60000 });
        expect(await S.pickerOptions(frame, '#ct-tailor-profile-select')).toEqual(oscapList);
        await frame.getByRole('tab', { name: 'Host Scan' }).click();
    });

    async function writeScan(ts, profileId, title) {
        const dir = `${home}/SCAP/scans/${ts}`;
        await hostSpawn(frame, ['mkdir', '-p', dir]);
        await frame.evaluate(async ({ dir, manifest }) => {
            await window.cockpit.file(`${dir}/manifest.json`).replace(JSON.stringify(manifest, null, 2));
        }, { dir, manifest: { timestamp: ts, sds_file: S.DS, profile_id: profileId, profile_title: title, base_profile_id: profileId, score: 50, counts: { pass: 1, fail: 1 }, rule_meta: {} } });
    }

    async function reopen() {
        await page.reload();
        frame = await shellFrame(page);
        await expect(frame.locator('#ct-scap-content')).toBeVisible({ timeout: 30000 });
    }

    test('Preselect: the newest scan\'s profile is selected and Run Scan comes on', async () => {
        const l1 = oscapList.find(p => p.value === S.PROFILE_L1);
        await writeScan('2099-01-05T00-00-00', S.PROFILE_L1, l1.text);
        await reopen();
        const picker = frame.locator('#ct-scap-profile');
        await expect(picker).toHaveAttribute('data-ct-value', S.PROFILE_L1, { timeout: 60000 });
        await expect(picker).toContainText(l1.text);
        await expect(frame.getByRole('button', { name: 'Run Scan' })).toBeEnabled({ timeout: 60000 });
        await expect(picker).toBeEnabled();
        await expect(descCol().locator('p')
                .nth(1)).not.toHaveClass(/ct-profile-desc-placeholder/);
    });

    test('Preselect: a last profile the content does not have is cleared and Run Scan stays off', async () => {
        await writeScan('2099-01-06T00-00-00', 'xccdf_org.ssgproject.content_profile_v46-test-gone', 'v46-test gone');
        await reopen();
        const picker = frame.locator('#ct-scap-profile');
        await expect(picker).toBeEnabled({ timeout: 60000 });
        await expect(picker).toHaveAttribute('data-ct-value', '');
        await expect(frame.getByRole('button', { name: 'Run Scan' })).toBeDisabled();
        await expect(descCol()).toContainText('Select a profile to see its description.');
    });

    test('Preselect: a root-owned newest scan (L10) is read as superuser', async () => {
        const ts = '2099-01-07T00-00-00';
        const dir = `${home}/SCAP/scans/${ts}`;
        const l1 = oscapList.find(p => p.value === S.PROFILE_L1);
        await writeScan(ts, S.PROFILE_L1, l1.text);
        try {
            await hostSpawn(frame, ['chown', '-R', 'root:root', dir], { superuser: true });
            await reopen();
            await expect(frame.locator('#ct-scap-profile')).toHaveAttribute('data-ct-value', S.PROFILE_L1, { timeout: 60000 });
            await expect(frame.getByRole('button', { name: 'Run Scan' })).toBeEnabled({ timeout: 60000 });
        } finally {
            await hostSpawn(frame, ['rm', '-rf', '--', dir], { superuser: true });
        }
    });

    test('CRLF: Update on an uploaded CRLF file keeps CRLF throughout', async () => {
        await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
        const name = 'v46-test 462 crlf';
        const prefix = '<?xml version="1.0" encoding="UTF-8"?>\r\n<!-- v46-test: crlf -->\r\n';
        const xml = prefix + rootXml('\r\n', name) + '\r\n';
        const card = frame.locator('.pf-v6-c-card').filter({ has: frame.getByRole('heading', { name: 'Saved Tailoring Policies' }) });
        await card.locator('input[type=file]').setInputFiles({ name: 'v46-test-462-crlf.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
        const row = card.locator('tbody tr').filter({ has: frame.getByRole('gridcell', { name, exact: true }) });
        await expect(row).toHaveCount(1, { timeout: 30000 });
        const glob = `"${home}"/SCAP/tailoring/v46-test-462-crlf-*.xml`;
        const bytes = async () => Buffer.from((await hostSpawn(frame, ['sh', '-c', `base64 -w0 ${glob}`])).trim(), 'base64').toString();
        expect(JSON.stringify(await bytes())).toBe(JSON.stringify(xml));

        const editor = frame.locator('.ct-tailor-editor-card');
        const bar = editor.locator('[data-ct-tailor-actionbar]');
        await row.getByRole('button', { name: 'Edit' }).click();
        await expect(bar).toContainText('1 rule, 1 variable modified', { timeout: 120000 });
        const search = editor.getByRole('textbox', { name: 'Search rules' });
        await search.fill('Install sudo Package');
        await editor.locator('.ct-tailor-tree input[type=checkbox]').first()
                .click();
        await search.fill('Install AIDE');
        await editor.locator('.ct-tailor-tree input[type=checkbox]').first()
                .click();
        await search.fill('');
        await expect(bar).toContainText('2 rules, 1 variable modified');
        await bar.getByRole('button', { name: 'Update' }).click();
        await expect(editor.getByRole('heading', { name: 'New Tailoring Policy' })).toBeVisible();

        const out = await bytes();
        expect(JSON.stringify(out)).toBe(JSON.stringify(prefix + editedRootXml('\r\n', name, 'false') + '\r\n'));
        const info = await hostSpawn(frame, ['sh', '-c', `oscap info "$(ls ${glob})" >/dev/null 2>&1; echo rc=$?`]);
        expect(info.trim()).toBe('rc=0');
    });
});
