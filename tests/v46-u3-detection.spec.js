// UAT batch 1, U3: installed content is found anywhere under
// /usr/share/xml/scap (any *-ds.xml, any depth), not only in
// scap-security-guide's ssg/content; a file reached twice is listed once.
// Puts a copy of the RHEL 10 datastream and a symlink to it under
// /usr/share/xml/scap/v46-test/ with sudo, so it runs ONLY on the
// disposable scap-apply10 (never touch /usr on scap-test10); afterAll
// removes the directory again.
const { requireApplyHost, sshApplyHost } = require('./helpers/apply-host');
requireApplyHost();

const { test, expect } = require('@playwright/test');
const { openModuleInShell } = require('./helpers/cockpit');
const S = require('./helpers/scap');

// Not serial: on a build without the wider detection the card check
// must still run (setup and teardown are idempotent per worker).

const DIR = '/usr/share/xml/scap/v46-test';
const COPY = `${DIR}/nested/deeper/v46-test-copy-ds.xml`;
const LINK = `${DIR}/v46-test-link-ds.xml`;
let page, frame;

test.beforeAll(async ({ browser }) => {
    sshApplyHost(`sudo -n mkdir -p ${DIR}/nested/deeper && sudo -n cp ${S.DS} ${COPY} && sudo -n ln -sf ${S.DS} ${LINK}`);
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    await expect(frame.locator('#ct-scap-content')).toBeVisible({ timeout: 30000 });
});

test.afterAll(async () => {
    sshApplyHost(`sudo -n rm -rf ${DIR}`);
    await page?.close();
});

test('pickers list a datastream outside ssg/content, under Installed, by file name; a symlink is not a second entry', async () => {
    for (const [tab, id] of [['Host Scan', '#ct-scap-content'], ['Policy Tailoring', '#ct-tailor-content-select']]) {
        await frame.getByRole('tab', { name: tab }).click();
        const options = await S.pickerOptions(frame, id);
        expect(options.filter(o => o.value === COPY).map(o => o.text)).toEqual(['v46-test-copy-ds.xml']);
        // The RHEL 10 datastream once (its own path), not again via the link.
        expect(options.filter(o => o.text === 'Red Hat Enterprise Linux 10').map(o => o.value)).toEqual([S.DS]);
        expect(options.some(o => o.value === LINK)).toBe(false);
        // Under "Installed".
        await frame.locator(id).click();
        const installed = frame.locator('.pf-v6-c-menu__group').filter({ hasText: 'Installed' });
        await expect(installed.locator(`li[data-ct-value="${COPY}"]`)).toHaveCount(1);
        await page.keyboard.press('Escape');
    }
});

test('the copy scans like any content: its profiles load', async () => {
    await frame.getByRole('tab', { name: 'Host Scan' }).click();
    await S.pick(frame, '#ct-scap-content', COPY);
    await expect(frame.locator('#ct-scap-profile')).toBeEnabled({ timeout: 60000 });
    const profiles = await S.pickerOptions(frame, '#ct-scap-profile');
    expect(profiles.some(p => p.value === S.PROFILE_L1)).toBe(true);
    await S.pick(frame, '#ct-scap-content', S.DS);
});

test('the SCAP Content card lists it as Installed, without Delete', async () => {
    await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
    const card = frame.locator('#ct-scap-content-card');
    const row = card.locator('tbody tr').filter({ hasText: 'v46-test-copy-ds.xml' });
    await expect(row).toHaveCount(1, { timeout: 30000 });
    await expect(row.locator('td').nth(1)).toHaveText('Installed');
    await expect(row.getByRole('button', { name: /Delete/ })).toHaveCount(0);
    await expect(card.locator('tbody tr').filter({ hasText: 'ssg-rhel10-ds.xml' })).toHaveCount(1);
});
