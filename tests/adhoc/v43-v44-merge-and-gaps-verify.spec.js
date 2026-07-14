// Post-merge verification for feature/v4.3-content-upload merged with
// rewrite@c4eeab0 (V4.4 guide/remediation buttons). Covers:
//   1. Content upload (V4.3) and View Compliance Guide / Download
//      Remediation (V4.4) coexisting correctly on ScanSetup.
//   2. Four testing gaps left open from the original V4.3 build (session
//      5b0d808b): non-elevated upload/list/delete, dark mode, the
//      checksum-mismatch failure path in uploadContent(), and the "Manage
//      uploaded content" link switching tabs.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { COCKPIT_URL, loginToCockpit } = require('../helpers/cockpit.js');
require('dotenv').config({ path: __dirname + '/../.env' });

const COCKPIT_USER = process.env.COCKPIT_USER || 'pbuchan';
const COCKPIT_PASS = process.env.COCKPIT_PASS || '';
const MODULE_PATH = '/cockpit/@localhost/scap/index.html';

// Real SDS content (scp'd from rhel10cis:/usr/share/xml/scap/ssg/content/ssg-rhel10-ds.xml)
// so uploads actually pass `oscap ds sds-validate`, not just the checksum step.
// Lives in tests/adhoc/fixtures/ (gitignored, stable) — NOT a job tmp dir, which
// gets cleaned up once that job ends and would break test discovery for the
// whole suite (a module-scope readFileSync failure here throws during Playwright's
// collection phase, before any test even runs).
const VALID_SDS_PATH = path.join(__dirname, 'fixtures', 'valid-ssg-rhel10-ds.xml');
const VALID_SDS_BUFFER = fs.readFileSync(VALID_SDS_PATH);

async function loginNoAdmin(page) {
    await page.goto(COCKPIT_URL);
    await page.locator('#login-user-input').waitFor({ timeout: 10000 });
    await page.fill('#login-user-input', COCKPIT_USER);
    await page.fill('#login-password-input', COCKPIT_PASS);
    await page.click('#login-button');
    await page.waitForFunction(
        () => !document.getElementById('login-user-input'),
        { timeout: 15000 }
    );
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    // Deliberately do NOT elevate admin — content upload/list/delete is
    // supposed to work entirely off the homedir design, no superuser needed.
    await page.goto(COCKPIT_URL + MODULE_PATH);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.pf-v6-c-card').first().waitFor({ timeout: 15000 });
}

function uniqueName(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.xml`;
}

test.describe.configure({ mode: 'serial' });

test('merge sanity: upload via ScanSetup keeps guide/remediation buttons working', async ({ page, context }) => {
    await loginToCockpit(page);
    await page.locator('#ct-scap-content').waitFor({ timeout: 10000 });
    await page.waitForTimeout(1500);

    const uploadName = uniqueName('merge-sanity');
    await page.locator('.ct-scan-form input[type="file"]')
            .setInputFiles({ name: uploadName, mimeType: 'text/xml', buffer: VALID_SDS_BUFFER });

    // Upload runs a real oscap ds sds-validate on 22MB — poll for the new
    // option to land (and be auto-selected) rather than a fixed sleep.
    const contentSelect = page.locator('#ct-scap-content');
    await expect(async () => {
        const hasOption = await contentSelect.evaluate(
            (el, name) => [...el.options].some(o => o.value.endsWith(name)),
            uploadName
        );
        expect(hasOption).toBe(true);
    }).toPass({ timeout: 60000 });

    const selectedInfo = await contentSelect.evaluate((el, name) => {
        const opt = [...el.options].find(o => o.value.endsWith(name));
        return { isSelected: el.value === opt.value, optgroupLabel: opt.closest('optgroup')?.label };
    }, uploadName);
    console.log('Uploaded content selection info:', JSON.stringify(selectedInfo));
    expect(selectedInfo.isSelected).toBe(true);
    expect(selectedInfo.optgroupLabel).toBe('Uploaded');

    // V4.4 buttons must still be present and enabled with the uploaded content selected.
    await page.waitForTimeout(1500); // let profiles load for the newly-selected content
    const runBtn = page.locator('button', { hasText: 'Run Scan' });
    const guideBtn = page.locator('button', { hasText: 'View Compliance Guide' });
    const dlToggle = page.locator('#ct-download-remediation-primary');
    await expect(runBtn).toBeEnabled();
    await expect(guideBtn).toBeEnabled();
    await expect(dlToggle).toBeEnabled();
    console.log('Confirmed: Run Scan, View Compliance Guide, Download Remediation all enabled with uploaded content selected.');

    // Guide generation actually works against the uploaded (not just detected) content.
    const [popup] = await Promise.all([
        context.waitForEvent('page'),
        guideBtn.click(),
    ]);
    await popup.waitForURL(/viewer\.html/, { timeout: 60000 });
    await popup.waitForLoadState('load', { timeout: 20000 });
    const bodyText = await popup.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(500);
    console.log('Confirmed: View Compliance Guide works against uploaded content, body length', bodyText.length);
    await popup.close();

    await page.screenshot({ path: 'tests/adhoc/screenshots/v43v44-merge-sanity.png', fullPage: true });

    // Cleanup via the Content card (also incidentally exercises the
    // "Manage uploaded content" link's tab switch — see the dedicated gap-D
    // test below for the assertion-bearing version of that check).
    await page.locator('button', { hasText: 'Manage uploaded content' }).click();
    const row = page.locator('tr', { hasText: uploadName });
    await row.waitFor({ timeout: 10000 });
    await row.locator('button', { hasText: 'Delete' }).click();
    await page.locator('.pf-v6-c-modal-box button', { hasText: 'Delete' }).click();
    await expect(row).toBeHidden({ timeout: 10000 });
    console.log('Cleaned up merge-sanity upload:', uploadName);
});

test('gap D: "Manage uploaded content" link switches to the Policy Tailoring tab', async ({ page }) => {
    await loginToCockpit(page);
    await page.locator('#ct-scap-content').waitFor({ timeout: 10000 });

    await expect(page.locator('h2', { hasText: 'SCAP Security Scan' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Uploaded Content' })).toBeHidden();

    await page.locator('button', { hasText: 'Manage uploaded content' }).click();

    await expect(page.locator('h2', { hasText: 'Uploaded Content' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('h2', { hasText: 'Saved Tailoring Policies' })).toBeVisible();
    await expect(page.locator('button[role="tab"]', { hasText: 'Policy Tailoring' })).toHaveAttribute('aria-selected', 'true');
    console.log('Confirmed: "Manage uploaded content" switches activeTab to Policy Tailoring and shows the Content card.');
});

test('gap A: non-elevated user can upload/list/delete on the Content card', async ({ page }) => {
    await loginNoAdmin(page);

    // Direct module-URL navigation bypasses the Cockpit shell chrome (no
    // "Limited access" indicator lives on this page at all — see the
    // getModuleFrame() comment in helpers/cockpit.js), so confirm
    // non-elevation via app.jsx's own admin gating instead: the "Host Scan"
    // tab shows this alert only when adminAllowed is false.
    await expect(page.locator('.pf-v6-c-alert', { hasText: 'Administrative access required' })).toBeVisible({ timeout: 10000 });
    console.log('Confirmed: session is NOT admin-elevated (adminAllowed gate visible on Host Scan tab).');

    await page.locator('button[role="tab"]', { hasText: 'Policy Tailoring' }).click();
    await page.locator('h2', { hasText: 'Uploaded Content' }).waitFor({ timeout: 10000 });

    const uploadCardInput = page.locator('.pf-v6-c-card', { has: page.locator('h2', { hasText: 'Uploaded Content' }) })
            .locator('input[type="file"]');
    const uploadName = uniqueName('nonadmin');
    await uploadCardInput.setInputFiles({ name: uploadName, mimeType: 'text/xml', buffer: VALID_SDS_BUFFER });

    const row = page.locator('tr', { hasText: uploadName });
    await row.waitFor({ timeout: 60000 });
    console.log('Confirmed: non-admin upload succeeded and is listed:', uploadName);

    // List: size/date columns populated (not just the name).
    const sizeCell = row.locator('td').nth(1);
    await expect(sizeCell).not.toHaveText('', { timeout: 5000 });
    console.log('Non-admin list row size cell:', await sizeCell.innerText());

    await page.screenshot({ path: 'tests/adhoc/screenshots/v43-nonadmin-content-list.png', fullPage: true });

    // Delete
    await row.locator('button', { hasText: 'Delete' }).click();
    await page.locator('.pf-v6-c-modal-box button', { hasText: 'Delete' }).click();
    await expect(row).toBeHidden({ timeout: 10000 });
    console.log('Confirmed: non-admin delete succeeded, row removed:', uploadName);
});

test('gap B: dark mode renders ContentUploadCard and the Uploaded optgroup correctly', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await loginNoAdmin(page);
    await page.locator('button[role="tab"]', { hasText: 'Policy Tailoring' }).click();
    await page.locator('h2', { hasText: 'Uploaded Content' }).waitFor({ timeout: 10000 });

    const uploadCardInput = page.locator('.pf-v6-c-card', { has: page.locator('h2', { hasText: 'Uploaded Content' }) })
            .locator('input[type="file"]');
    const uploadName = uniqueName('darkmode');
    await uploadCardInput.setInputFiles({ name: uploadName, mimeType: 'text/xml', buffer: VALID_SDS_BUFFER });
    const row = page.locator('tr', { hasText: uploadName });
    await row.waitFor({ timeout: 60000 });

    // ContentUploadCard picks up the dark card background token.
    const uploadCard = page.locator('.pf-v6-c-card', { has: page.locator('h2', { hasText: 'Uploaded Content' }) });
    const cardBg = await uploadCard.evaluate(el => getComputedStyle(el).backgroundColor);
    console.log('ContentUploadCard dark background:', cardBg);
    expect(cardBg).toBe('rgb(41, 41, 41)'); // #292929, per CLAUDE.md's measured dark card token

    await uploadCard.screenshot({ path: 'tests/adhoc/screenshots/v43-darkmode-content-upload-card.png' });

    // The "Uploaded" optgroup exists in ContentSelect (native <select>
    // optgroup rendering is OS-chrome, not something Playwright can
    // screenshot meaningfully when open — assert its presence/label instead,
    // and screenshot the closed control for the dark FormSelect chrome).
    await page.locator('button[role="tab"]', { hasText: 'Host Scan' }).click();
    await page.locator('#ct-scap-content').waitFor({ timeout: 10000 });
    const hasUploadedGroup = await page.locator('#ct-scap-content optgroup[label="Uploaded"]').count();
    expect(hasUploadedGroup).toBeGreaterThan(0);
    console.log('Confirmed: "Uploaded" optgroup present in ContentSelect in dark mode.');
    await page.locator('.ct-form-col').first().screenshot({ path: 'tests/adhoc/screenshots/v43-darkmode-content-select.png' });

    // Cleanup
    await page.locator('button', { hasText: 'Manage uploaded content' }).click();
    const cleanupRow = page.locator('tr', { hasText: uploadName });
    await cleanupRow.waitFor({ timeout: 10000 });
    await cleanupRow.locator('button', { hasText: 'Delete' }).click();
    await page.locator('.pf-v6-c-modal-box button', { hasText: 'Delete' }).click();
    await expect(cleanupRow).toBeHidden({ timeout: 10000 });
});

test('gap C: checksum-mismatch failure path surfaces to the user', async ({ page }) => {
    // Corrupts the *expected* hash the browser computes client-side (not the
    // bytes actually written to the scratch file) — this exercises the real
    // uploadContent() code path end to end: real write, real `sha256sum` on
    // the real written file, real comparison, real throw, real catch-cleanup
    // rm -f of the scratch file, real rethrow, real UI error surfacing. It is
    // a faithful stand-in for "the in-flight write got corrupted": from
    // uploadContent()'s perspective the written bytes legitimately don't
    // match what was expected.
    await page.addInitScript(() => {
        const real = window.crypto.subtle.digest.bind(window.crypto.subtle);
        window.crypto.subtle.digest = async (algo, data) => {
            const buf = await real(algo, data);
            const bytes = new Uint8Array(buf.slice(0));
            bytes[0] ^= 0xFF;
            return bytes.buffer;
        };
    });

    await loginNoAdmin(page);
    await page.locator('button[role="tab"]', { hasText: 'Policy Tailoring' }).click();
    await page.locator('h2', { hasText: 'Uploaded Content' }).waitFor({ timeout: 10000 });

    const uploadCardInput = page.locator('.pf-v6-c-card', { has: page.locator('h2', { hasText: 'Uploaded Content' }) })
            .locator('input[type="file"]');
    const uploadName = uniqueName('checksum-mismatch');
    // Small junk content is fine — the checksum step runs before oscap
    // validation, so this never reaches sds-validate.
    const junkBuffer = Buffer.from('<xml>not real SCAP content, just needs to reach the checksum step</xml>');
    await uploadCardInput.setInputFiles({ name: uploadName, mimeType: 'text/xml', buffer: junkBuffer });

    const errorAlert = page.locator('.pf-v6-c-alert', { hasText: 'Upload failed' });
    await errorAlert.waitFor({ timeout: 20000 });
    const errorText = await errorAlert.innerText();
    console.log('Checksum-mismatch error surfaced to user:', errorText);
    expect(errorText).toContain('checksum mismatch');

    // The failed upload must not appear in the list.
    const row = page.locator('tr', { hasText: uploadName });
    await expect(row).toHaveCount(0);
    console.log('Confirmed: failed upload does not appear in the Content list.');

    await page.screenshot({ path: 'tests/adhoc/screenshots/v43-checksum-mismatch-error.png', fullPage: true });
});
