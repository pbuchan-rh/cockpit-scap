// Code-review fixes in the tailoring area (F5-F8), INSIDE the Cockpit shell
// (/scap-dev), both browser projects. No real scan; one single-rule
// `oscap xccdf eval` as the user. Everything created carries "v46-test" in
// its name and is removed afterwards.
//   F6: the editor shows the value the profile sets (refine-value), not the
//       benchmark default; choosing the default writes a set-value.
//   F5: editing an uploaded tailoring keeps what the editor does not edit.
//   F7: content and profile pickers lock once rules are loaded.
//   F8: re-uploading content under the same name re-reads its profiles.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

let page, frame, before, home;

const PROFILE_CIS = 'xccdf_org.ssgproject.content_profile_cis';
const VAL = 'xccdf_org.ssgproject.content_value_';
const MINLEN = VAL + 'var_password_pam_minlen';
const F6_NAME = 'v46-test review minlen';
const F6_PROFILE = 'xccdf_cockpit-scap_profile_v46-test-review-minlen';
const F5_NAME = 'v46-test review F5';
const UPLOAD_DS = 'v46-test-review-ds.xml';

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    home = await S.homeDir(frame);
    before = await S.snapshotScans(frame);
    await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
});

test.afterAll(async () => {
    if (frame) {
        await hostSpawn(frame, ['sh', '-c', 'rm -rf /tmp/v46-test-review-*']).catch(() => {});
        await S.cleanupCreated(frame, before);
    }
    await page?.close();
});

const editor = () => frame.locator('.ct-tailor-editor-card');
const bar = () => editor().locator('[data-ct-tailor-actionbar]');
const policiesCard = () => frame.locator('.pf-v6-c-card').filter({ has: frame.getByRole('heading', { name: 'Saved Tailoring Policies' }) });
const policyRow = name => policiesCard().locator('tbody tr')
        .filter({ has: frame.getByRole('gridcell', { name, exact: true }) });
const minlen = () => editor().locator(`[id="ct-tailor-value-${MINLEN}"]`);

async function catTailoring(slug) {
    return hostSpawn(frame, ['sh', '-c', `cat "${home}"/SCAP/tailoring/${slug}-*.xml`]);
}

async function loadNew(profile) {
    await S.pick(frame, '#ct-tailor-content-select', S.DS);
    await expect(frame.locator('#ct-tailor-profile-select')).toBeEnabled({ timeout: 60000 });
    await S.pick(frame, '#ct-tailor-profile-select', profile);
    await editor().getByRole('button', { name: 'Load Rules' })
            .click();
    await expect(bar()).toBeVisible({ timeout: 120000 });
}

async function showVariable(term) {
    const toggle = editor().locator('#ct-tailor-values-title-toggle');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await editor().locator('#ct-tailor-values-title-content')
            .getByRole('textbox', { name: 'Search variables' })
            .fill(term);
}

/* The <Profile> elements of a tailoring file, parsed in the browser. */
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

test('F6: CIS minlen shows the profile value 14; the benchmark default 15 saves as a set-value', async () => {
    await loadNew(PROFILE_CIS);
    await showVariable('pam_minlen');
    await expect(minlen()).toHaveAttribute('data-ct-value', '14');
    await expect(bar()).toContainText('No changes yet');
    await S.pick(frame, minlen(), '15');
    await expect(bar()).toContainText('0 rules, 1 variable modified');
    await expect(editor().locator('.ct-tailor-sum-val-change')).toHaveText(/^14\s*15$/);
    await bar().getByRole('textbox', { name: 'Policy name' })
            .fill(F6_NAME);
    await bar().getByRole('button', { name: 'Save Policy' })
            .click();
    await expect(policiesCard().locator('tbody tr')
            .filter({ hasText: F6_NAME })).toHaveCount(1);
    const [p] = await profilesOf(await catTailoring('v46-test-review-minlen'));
    expect(p.extends).toBe(PROFILE_CIS);
    expect(p.children.filter(c => c.tag === 'set-value')).toEqual([expect.objectContaining({ idref: MINLEN, text: '15' })]);
});

test('F6: editing the saved policy shows 15 as the change from 14', async () => {
    await policiesCard().locator('tbody tr')
            .filter({ hasText: F6_NAME })
            .getByRole('button', { name: 'Edit' })
            .click();
    await expect(bar()).toBeVisible({ timeout: 120000 });
    await showVariable('pam_minlen');
    await expect(minlen()).toHaveAttribute('data-ct-value', '15');
    await expect(bar()).toContainText('0 rules, 1 variable modified');
    // Back to the profile's value: no longer a change.
    await S.pick(frame, minlen(), '14');
    await expect(bar()).toContainText('No changes yet');
    await bar().getByRole('button', { name: 'Cancel' })
            .click();
    await frame.getByRole('dialog').getByRole('button', { name: 'Discard changes' })
            .click();
    await expect(editor().getByRole('heading', { name: 'New Tailoring Policy' })).toBeVisible();
});

test('F6 end to end: oscap evaluates the rule with minlen 15 from the saved tailoring', async () => {
    test.setTimeout(300000);
    const out = await hostSpawn(frame, ['sh', '-c', `
        d=$(mktemp -d /tmp/v46-test-review-XXXXXX)
        oscap xccdf eval --tailoring-file "$(ls "${home}"/SCAP/tailoring/v46-test-review-minlen-*.xml)" \\
            --profile ${F6_PROFILE} --rule ${S.RULE}accounts_password_pam_minlen \\
            --results "$d/results.xml" ${S.DS} >/dev/null 2>&1
        echo "rc=$?"
        grep -o '<set-value idref="${MINLEN}">[^<]*</set-value>' "$d/results.xml"
        grep -o 'idref="${S.RULE}accounts_password_pam_minlen"[^>]*>' "$d/results.xml" | head -1
        rm -rf "$d"`]);
    expect(out).toMatch(/rc=[02]\b/);
    expect(out).toContain(`<set-value idref="${MINLEN}">15</set-value>`);
    expect(out).toContain(`${S.RULE}accounts_password_pam_minlen`);
});

const F5_XML = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- v46-test: uploaded tailoring with elements the editor does not write -->',
    '<Tailoring xmlns="http://checklists.nist.gov/xccdf/1.2" id="xccdf_org.cockpit-scap.test_tailoring_v46-test">',
    `  <benchmark href="${S.DS}"/>`,
    '  <status>draft</status>',
    '  <version time="2026-10-20T00:00:00">7</version>',
    '  <Profile id="xccdf_org.cockpit-scap.test_profile_v46-test-review-f5">',
    `    <title>${F5_NAME}</title>`,
    '    <description>Uploaded with extras</description>',
    `    <select idref="${S.RULE}package_aide_installed" selected="true"/>`,
    `    <refine-value idref="${MINLEN}" selector="12"/>`,
    `    <refine-rule idref="${S.RULE}package_aide_installed" severity="high"/>`,
    '  </Profile>',
    `  <Profile id="xccdf_org.cockpit-scap.test_profile_v46-test-review-f5-other" extends="${S.PROFILE_L1}">`,
    '    <title>v46-test review F5 other</title>',
    `    <select idref="${S.RULE}aide_build_database" selected="false"/>`,
    '  </Profile>',
    '</Tailoring>',
    '',
].join('\n');

test('F5: Update on an uploaded tailoring changes only its selects and keeps everything else', async () => {
    await policiesCard().locator('input[type=file]')
            .setInputFiles({ name: 'v46-test-review-f5.xml', mimeType: 'text/xml', buffer: Buffer.from(F5_XML) });
    const row = policyRow(F5_NAME);
    await expect(row).toHaveCount(1, { timeout: 30000 });
    // Counts this profile's selects only.
    await expect(row.getByRole('gridcell').nth(3)).toHaveText('1');
    await row.getByRole('button', { name: 'Edit' })
            .click();
    await expect(bar()).toBeVisible({ timeout: 120000 });
    // Only this profile's select is loaded, not the other profile's.
    await expect(bar()).toContainText('1 rule, 0 variables modified');
    const search = editor().getByRole('textbox', { name: 'Search rules' });
    await search.fill('Install sudo Package');
    await editor().locator('.ct-tailor-tree input[type=checkbox]')
            .first()
            .click();
    await search.fill('');
    await expect(bar()).toContainText('2 rules, 0 variables modified');
    await bar().getByRole('button', { name: 'Update' })
            .click();
    await expect(editor().getByRole('heading', { name: 'New Tailoring Policy' })).toBeVisible();

    const xml = await catTailoring('v46-test-review-f5');
    expect(xml).not.toContain('extends=""');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!-- v46-test:')).toBe(true);
    expect(xml).toContain('<status>draft</status>');
    expect(xml).toContain('<version time="2026-10-20T00:00:00">7</version>');
    expect(xml).toContain('<description>Uploaded with extras</description>');
    const [mine, other] = await profilesOf(xml);
    expect(mine.hasExtends).toBe(false);
    expect(mine.children).toEqual([
        expect.objectContaining({ tag: 'title', text: F5_NAME }),
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
    // oscap still reads it.
    const info = await hostSpawn(frame, ['sh', '-c', `oscap info "$(ls "${home}"/SCAP/tailoring/v46-test-review-f5-*.xml)" >/dev/null 2>&1; echo rc=$?`]);
    expect(info.trim()).toBe('rc=0');
});

test('F5: Save as New from a profile without extends writes no extends=""', async () => {
    await policyRow(F5_NAME).getByRole('button', { name: 'Edit' })
            .click();
    await expect(bar()).toBeVisible({ timeout: 120000 });
    await bar().getByRole('textbox', { name: 'Policy name' })
            .fill('v46-test review F5 copy');
    await bar().getByRole('button', { name: 'Save as New' })
            .click();
    await expect(editor().getByRole('heading', { name: 'New Tailoring Policy' })).toBeVisible();
    const xml = await catTailoring('v46-test-review-f5-copy');
    expect(xml).not.toContain('extends=');
    expect(xml).toContain(`<select idref="${S.RULE}package_sudo_installed" selected="true"/>`);
});

test('F7: content and profile pickers lock after Load Rules until Cancel', async () => {
    await loadNew(S.PROFILE_L1);
    await expect(frame.locator('#ct-tailor-content-select')).toBeDisabled();
    await expect(frame.locator('#ct-tailor-profile-select')).toBeDisabled();
    await expect(editor().getByRole('button', { name: 'Load Rules' })).toBeDisabled();
    await frame.locator('#ct-tailor-other-content').click();
    await expect(frame.getByRole('menuitem', { name: /Upload content/ })).toBeDisabled();
    await page.keyboard.press('Escape');
    // An unsaved change: Cancel asks first, then unlocks.
    const search = editor().getByRole('textbox', { name: 'Search rules' });
    await search.fill('Install sudo Package');
    await editor().locator('.ct-tailor-tree input[type=checkbox]')
            .first()
            .click();
    await bar().getByRole('button', { name: 'Cancel' })
            .click();
    await frame.getByRole('dialog').getByRole('button', { name: 'Discard changes' })
            .click();
    await expect(bar()).toHaveCount(0);
    await expect(frame.locator('#ct-tailor-content-select')).toBeEnabled();
    await expect(editor().getByRole('button', { name: 'Load Rules' })).toBeEnabled({ timeout: 60000 });
});

const DS_FIXTURE = fs.readFileSync(`${__dirname}/fixtures/v46-test-review-ds.xml`, 'utf8');

/* Uploads the fixture datastream as UPLOAD_DS with one profile, through
 * the "Other content" menu `menuId`; confirms the replace when asked. */
async function uploadDs(menuId, profile) {
    const buffer = Buffer.from(DS_FIXTURE.replace(/PROFILE/g, profile).replace('TITLE', `v46-test profile ${profile}`));
    await frame.locator(menuId).click();
    const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        frame.getByRole('menuitem', { name: /Upload content/ }).click(),
    ]);
    await chooser.setFiles({ name: UPLOAD_DS, mimeType: 'text/xml', buffer });
    const replace = frame.getByRole('dialog').getByRole('button', { name: 'Replace' });
    if (await replace.waitFor({ timeout: 5000 }).then(() => true)
            .catch(() => false))
        await replace.click();
}

async function expectProfiles(selector, profile) {
    const want = [`v46-test profile ${profile}`];
    await expect.poll(async () => {
        await expect(frame.locator(selector)).toBeEnabled({ timeout: 60000 });
        return (await S.pickerOptions(frame, selector)).map(o => o.text);
    }, { timeout: 60000 }).toEqual(want);
}

test('F8: re-uploading content with the same name re-reads its profiles (editor)', async () => {
    await uploadDs('#ct-tailor-other-content', 'a');
    await expect(frame.locator('#ct-tailor-content-select')).toHaveAttribute('data-ct-value', `${home}/SCAP/content/${UPLOAD_DS}`, { timeout: 60000 });
    await expectProfiles('#ct-tailor-profile-select', 'a');
    await uploadDs('#ct-tailor-other-content', 'b');
    await expectProfiles('#ct-tailor-profile-select', 'b');
});

test('F8: re-uploading content with the same name re-reads its profiles (Host Scan)', async () => {
    await frame.getByRole('tab', { name: 'Host Scan' }).click();
    await uploadDs('#ct-scan-other-content', 'c');
    await expect(frame.locator('#ct-scap-content')).toHaveAttribute('data-ct-value', `${home}/SCAP/content/${UPLOAD_DS}`, { timeout: 60000 });
    await expectProfiles('#ct-scap-profile', 'c');
    await uploadDs('#ct-scan-other-content', 'd');
    await expectProfiles('#ct-scap-profile', 'd');
});
