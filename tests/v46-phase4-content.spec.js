// V4.6 Phase 4: SCAP Content card (G1), "Other content ▾" menus (F4),
// tailoring upload matched by <benchmark href> (F2), list footers (F5),
// friendly content names. INSIDE the Cockpit shell (/scap-dev), both
// browser projects. Uploads only v46-test files and deletes them; never
// touches the user's own uploaded content beyond reading the list.
const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

let page, frame, before, home;
const UPLOAD_NAME = 'v46-test-upload-ds.xml';

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    home = await S.homeDir(frame);
    before = await S.snapshotScans(frame);
});

test.afterAll(async () => {
    if (frame) await S.cleanupCreated(frame, before);
    await page?.close();
});

const contentCard = () => frame.locator('#ct-scap-content-card');
const contentTable = () => frame.getByRole('grid', { name: 'SCAP content' });
const policiesCard = () => frame.locator('.pf-v6-c-card').filter({ has: frame.getByRole('heading', { name: 'Saved Tailoring Policies' }) });

function tailoringXml(title, href) {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Tailoring xmlns="http://checklists.nist.gov/xccdf/1.2" id="xccdf_cockpit-scap_tailoring_default">',
        ...(href ? [`  <benchmark href="${href}"/>`] : []),
        '  <version time="2026-10-15T00:00:00">1</version>',
        `  <Profile id="xccdf_cockpit-scap_profile_${title.replace(/\W+/g, '-')}" extends="${S.PROFILE_L1}">`,
        `    <title>${title}</title>`,
        `    <select idref="${S.RULE}package_aide_installed" selected="false"/>`,
        '  </Profile>',
        '</Tailoring>',
    ].join('\n');
}

async function uploadTailoring(title, href) {
    await policiesCard().locator('input[type=file]')
            .setInputFiles({ name: `${title}.xml`, mimeType: 'text/xml', buffer: Buffer.from(tailoringXml(title, href)) });
}

async function sidecarFor(title) {
    const out = await hostSpawn(frame, ['sh', '-c', `for f in "${home}"/SCAP/tailoring/*v46-test*.json; do cat "$f"; echo; done`]);
    const all = out.split(/\n(?=\{)/).map(s => { try { return JSON.parse(s) } catch { return null } })
            .filter(Boolean);
    return all.find(sc => sc.name === title);
}

test('friendly content names in the scan picker; one "Other content" menu, no link row', async () => {
    expect((await S.pickerOptions(frame, '#ct-scap-content')).filter(o => o.text === 'Red Hat Enterprise Linux 10')).toHaveLength(1);
    for (const old of ['Enter path manually', 'Upload…', 'Manage uploaded content →'])
        await expect(frame.getByRole('button', { name: old })).toHaveCount(0);
    const toggle = frame.locator('#ct-scan-other-content');
    await toggle.click();
    const items = (await frame.getByRole('menuitem').allInnerTexts()).map(t => t.split('\n')[0].trim());
    // No path entry any more (U3): detected content or an upload.
    expect(items).toEqual(['Upload content…', 'Manage content']);
    await page.keyboard.press('Escape');
});

test('Manage content opens the SCAP Content card on the Policy Tailoring tab', async () => {
    await frame.locator('#ct-scan-other-content').click();
    await frame.getByRole('menuitem', { name: 'Manage content' }).click();
    await expect(frame.getByRole('tab', { name: 'Policy Tailoring' })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => frame.evaluate(() => document.activeElement?.classList.contains('ct-scap-content-title'))).toBe(true);
    // Last card on the tab: it may not reach the top, but it is on screen.
    await expect(contentCard().getByRole('heading', { name: 'SCAP Content' })).toBeInViewport();
    // The editor's content picker has the same menu (no path entry there).
    await frame.locator('#ct-tailor-other-content').click();
    const items = (await frame.getByRole('menuitem').allInnerTexts()).map(t => t.split('\n')[0].trim());
    expect(items).toEqual(['Upload content…', 'Manage content']);
    await page.keyboard.press('Escape');
});

test('SCAP Content: one table, Installed SSG row with benchmark version, no Delete', async () => {
    await expect(contentCard().getByRole('heading', { name: 'SCAP Content' })).toBeVisible();
    const heads = (await contentTable().locator('thead th').allInnerTexts()).map(h => h.trim());
    expect(heads).toEqual(['Name', 'Source', 'Version', 'Size', 'Added', 'Actions']);
    const ssg = contentTable().locator('tbody tr').filter({ hasText: 'ssg-rhel10-ds.xml' });
    await expect(ssg).toHaveCount(1);
    await expect(ssg.locator('td').nth(0)).toContainText('Red Hat Enterprise Linux 10');
    // Source reads just "Installed" (Peter 10-15, C2): plain text, no
    // subline, no tooltip, no dotted underline.
    const source = ssg.locator('td').nth(1);
    await expect(source).toHaveText('Installed');
    await expect(contentTable()).not.toContainText('Included');
    await expect(source.locator('.ct-cell-subline')).toHaveCount(0);
    await expect(source.locator('[tabindex]')).toHaveCount(0);
    expect(await source.evaluate(td => getComputedStyle(td).textDecorationLine)).toBe('none');
    await source.hover();
    await page.waitForTimeout(800);
    await expect(frame.getByRole('tooltip')).toHaveCount(0);
    await page.mouse.move(0, 0);
    await expect(ssg.locator('td').nth(2)).toHaveText(/^0\.1\.\d+$/);
    await expect(ssg.locator('td').nth(3)).toHaveText(/^\d+(\.\d)? MB$/);
    await expect(ssg.getByRole('button')).toHaveCount(0);
    // Every uploaded row (the user's own included) offers Delete; we do not click it.
    const uploaded = contentTable().locator('tbody tr[data-ct-source="uploaded"]');
    for (let i = 0; i < await uploaded.count(); i++) {
        await expect(uploaded.nth(i).locator('td').nth(1)).toHaveText('Uploaded');
        await expect(uploaded.nth(i).getByRole('button', { name: /^Delete / })).toHaveCount(1);
    }
});

test('upload a v46-test datastream, it lists as Uploaded with its version, Delete removes it', async () => {
    test.setTimeout(300000);
    // cockpit.file() caps reads below this file's size; spawn does not.
    const text = await frame.evaluate(async ds => await window.cockpit.spawn(['cat', ds]), S.DS);
    const rowsBefore = await contentTable().locator('tbody tr').count();
    await contentCard().locator('input[type=file]')
            .setInputFiles({ name: UPLOAD_NAME, mimeType: 'text/xml', buffer: Buffer.from(text) });
    const row = contentTable().locator('tbody tr').filter({ hasText: UPLOAD_NAME });
    await expect(row).toHaveCount(1, { timeout: 180000 });
    await expect(row.locator('td').nth(0)).toContainText('v46-test-upload-ds');
    await expect(row.locator('td').nth(1)).toHaveText('Uploaded');
    await expect(row.locator('td').nth(2)).toHaveText(/^0\.1\.\d+$/);
    await expect(contentCard().locator('.ct-list-count')).toHaveText(new RegExp(`^${rowsBefore + 1} items · \\d+(\\.\\d)? MB$`));
    // ...and is offered by the content pickers.
    expect((await S.pickerOptions(frame, '#ct-tailor-content-select')).filter(o => o.text === 'v46-test-upload-ds')).toHaveLength(1);
    await row.getByRole('button', { name: `Delete ${UPLOAD_NAME}` }).click();
    const modal = frame.getByRole('dialog');
    await expect(modal).toContainText(UPLOAD_NAME);
    await modal.getByRole('button', { name: 'Delete' }).click();
    await expect(row).toHaveCount(0);
    const left = await hostSpawn(frame, ['sh', '-c', `ls "${home}/SCAP/content" | grep v46-test || true`]);
    expect(left.trim()).toBe('');
});

test('F2: tailoring upload — matching <benchmark href> saves without asking, no content dropdown in the header', async () => {
    await expect(policiesCard().locator('select')).toHaveCount(0);
    const title = 'v46-test F2 match';
    await uploadTailoring(title, S.DS);
    const row = policiesCard().locator('tbody tr').filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(frame.getByRole('dialog')).toHaveCount(0);
    await expect(row).toContainText('Red Hat Enterprise Linux 10');
    expect((await sidecarFor(title)).sds_path).toBe(S.DS);
});

test('F2: a file name from another host matches by name', async () => {
    const title = 'v46-test F2 other host';
    await uploadTailoring(title, '/some/other/host/path/ssg-rhel10-ds.xml');
    await expect(policiesCard().locator('tbody tr').filter({ hasText: title })).toHaveCount(1);
    await expect(frame.getByRole('dialog')).toHaveCount(0);
    expect((await sidecarFor(title)).sds_path).toBe(S.DS);
});

test('F2: no match asks in a small modal; Cancel saves nothing, choosing saves', async () => {
    const title = 'v46-test F2 no match';
    await uploadTailoring(title, '/opt/v46-test/unknown-ds.xml');
    let modal = frame.getByRole('dialog');
    await expect(modal).toContainText('Which content is this policy for?');
    await expect(modal).toContainText('/opt/v46-test/unknown-ds.xml');
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(policiesCard().locator('tbody tr').filter({ hasText: title })).toHaveCount(0);

    await uploadTailoring(title, '/opt/v46-test/unknown-ds.xml');
    modal = frame.getByRole('dialog');
    await expect(modal.getByRole('button', { name: 'Save policy' })).toBeDisabled();
    await S.pick(frame, modal.getByRole('button', { name: /^Content for the uploaded policy/ }), S.DS);
    await modal.getByRole('button', { name: 'Save policy' }).click();
    await expect(policiesCard().locator('tbody tr').filter({ hasText: title })).toHaveCount(1);
    expect((await sidecarFor(title)).sds_path).toBe(S.DS);

    // A file that names no content at all also asks.
    await uploadTailoring('v46-test F2 no href', null);
    modal = frame.getByRole('dialog');
    await expect(modal).toContainText('does not say which SCAP content');
    await modal.getByRole('button', { name: 'Cancel' }).click();
});

test('F5: every list ends in "N items · size"', async () => {
    const re = /^\d+ items? · \d+(\.\d)? (B|KB|MB|GB)$/;
    await expect(contentCard().locator('.ct-list-count')).toHaveText(re);
    await expect(policiesCard().locator('.ct-list-count')).toHaveText(re);
    const n = await policiesCard().locator('tbody tr').count();
    await expect(policiesCard().locator('.ct-list-count')).toHaveText(new RegExp(`^${n} item`));
    await frame.getByRole('tab', { name: 'Host Scan' }).click();
    await expect(frame.locator('.ct-history-card .ct-list-count')).toHaveText(re);
});
