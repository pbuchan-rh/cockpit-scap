// Adhoc verification for V4.4: View Compliance Guide + Download Remediation
// split-button. Most of this file deliberately does NOT elevate admin — the
// whole point of these two buttons is that they work without it. One test
// elevates admin only to re-confirm Run Scan's existing gating still holds.
const { test, expect } = require('@playwright/test');
const { COCKPIT_URL, loginToCockpit } = require('../helpers/cockpit.js');
require('dotenv').config({ path: __dirname + '/../.env' });

const COCKPIT_USER = process.env.COCKPIT_USER || 'pbuchan';
const COCKPIT_PASS = process.env.COCKPIT_PASS || '';
const MODULE_PATH = '/cockpit/@localhost/scap/index.html';

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
    // Deliberately do NOT elevate admin.
    await page.goto(COCKPIT_URL + MODULE_PATH);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.pf-v6-c-card').first().waitFor({ timeout: 15000 });
    await page.locator('#ct-scap-content').waitFor({ timeout: 10000 });
    // Let the profile list settle so canGenerate flips true.
    await page.waitForTimeout(1500);
}

test('non-admin: Run Scan disabled, View Guide + Download Remediation enabled', async ({ page }) => {
    await loginNoAdmin(page);

    const runBtn = page.locator('button', { hasText: 'Run Scan' });
    const guideBtn = page.locator('button', { hasText: 'View Compliance Guide' });
    const dlToggle = page.locator('#ct-download-remediation-primary');

    await expect(runBtn).toBeDisabled();
    await expect(guideBtn).toBeEnabled();
    await expect(dlToggle).toBeEnabled();
    console.log('Confirmed: Run Scan disabled, View Compliance Guide + Download Remediation enabled, all without admin.');

    await page.screenshot({ path: 'tests/adhoc/screenshots/v44-nonadmin-buttons.png', fullPage: true });
});

test('non-admin: View Compliance Guide opens fully-styled guide HTML', async ({ page, context }) => {
    await loginNoAdmin(page);

    const guideBtn = page.locator('button', { hasText: 'View Compliance Guide' });
    const [popup] = await Promise.all([
        context.waitForEvent('page'),
        guideBtn.click(),
    ]);
    // Popup opens on about:blank immediately (popup-blocker workaround), then
    // navigates to viewer.html only once oscap generate guide finishes over
    // the cockpit.spawn round trip and the HTML is written to IndexedDB —
    // wait for that navigation explicitly rather than a fixed sleep.
    await popup.waitForURL(/viewer\.html/, { timeout: 30000 });
    await popup.waitForLoadState('load', { timeout: 20000 });
    await expect(popup.locator('body')).not.toBeEmpty({ timeout: 15000 });

    const bodyText = await popup.locator('body').innerText();
    console.log('Guide popup title:', await popup.title());
    console.log('Guide popup body text length:', bodyText.length);
    expect(bodyText.length).toBeGreaterThan(500);

    const styleInfo = await popup.evaluate(() => {
        const styleTags = document.querySelectorAll('style').length;
        const el = document.querySelector('h1, h2, table, .rule-title') || document.body;
        const cs = getComputedStyle(el);
        return { styleTags, fontFamily: cs.fontFamily, bgColor: getComputedStyle(document.body).backgroundColor };
    });
    console.log('Guide popup style info:', JSON.stringify(styleInfo));
    expect(styleInfo.styleTags).toBeGreaterThan(0);

    await popup.screenshot({ path: 'tests/adhoc/screenshots/v44-guide-popup.png', fullPage: false });
});

test('non-admin: Download Remediation split-button downloads bash/ansible/puppet', async ({ page }) => {
    await loginNoAdmin(page);

    const dlToggle = page.locator('#ct-download-remediation-primary');

    // Primary split-button click defaults to bash.
    const [bashDownload] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        dlToggle.click(),
    ]);
    console.log('Bash download filename:', bashDownload.suggestedFilename());
    expect(bashDownload.suggestedFilename()).toMatch(/^profile-remediation-.*\.sh$/);
    const bashPath = await bashDownload.path();
    expect(bashPath).toBeTruthy();
    const bashSize = require('fs').statSync(bashPath).size;
    console.log('Bash download size:', bashSize);
    expect(bashSize).toBeGreaterThan(0);

    // Caret opens the dropdown with all three formats.
    const caretToggle = page.locator('button[aria-label="Select remediation format"]');
    await caretToggle.click();
    const bashItem = page.locator('.pf-v6-c-menu__item', { hasText: 'Bash' });
    const ansibleItem = page.locator('.pf-v6-c-menu__item', { hasText: 'Ansible' });
    const puppetItem = page.locator('.pf-v6-c-menu__item', { hasText: 'Puppet' });
    await expect(bashItem).toBeVisible();
    await expect(ansibleItem).toBeVisible();
    await expect(puppetItem).toBeVisible();
    console.log('Confirmed: dropdown shows Bash/Ansible/Puppet options.');

    const [ansibleDownload] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        ansibleItem.click(),
    ]);
    console.log('Ansible download filename:', ansibleDownload.suggestedFilename());
    expect(ansibleDownload.suggestedFilename()).toMatch(/^profile-remediation-.*\.yml$/);
    const ansiblePath = await ansibleDownload.path();
    expect(require('fs').statSync(ansiblePath).size).toBeGreaterThan(0);

    await caretToggle.click();
    const [puppetDownload] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        puppetItem.click(),
    ]);
    console.log('Puppet download filename:', puppetDownload.suggestedFilename());
    expect(puppetDownload.suggestedFilename()).toMatch(/^profile-remediation-.*\.pp$/);
    const puppetPath = await puppetDownload.path();
    expect(require('fs').statSync(puppetPath).size).toBeGreaterThan(0);
});

test('non-admin: dropdown closes on Escape and on outside click', async ({ page }) => {
    await loginNoAdmin(page);

    const caretToggle = page.locator('button[aria-label="Select remediation format"]');
    const bashItem = page.locator('.pf-v6-c-menu__item', { hasText: 'Bash' });

    // Escape
    await caretToggle.click();
    await expect(bashItem).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bashItem).toBeHidden();
    console.log('Confirmed: Escape closes the remediation dropdown.');

    // Outside click
    await caretToggle.click();
    await expect(bashItem).toBeVisible();
    await page.locator('h2', { hasText: 'SCAP Security Scan' }).click();
    await expect(bashItem).toBeHidden();
    console.log('Confirmed: outside click closes the remediation dropdown.');
});

test('non-admin: dark mode renders the new buttons correctly', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await loginNoAdmin(page);
    await page.screenshot({ path: 'tests/adhoc/screenshots/v44-nonadmin-darkmode.png', fullPage: true });
    console.log('Captured dark-mode screenshot of Scan Setup with new buttons.');
});

test('admin: Run Scan is still enabled once elevated', async ({ page }) => {
    await loginToCockpit(page);
    await page.locator('#ct-scap-content').waitFor({ timeout: 10000 });
    await page.waitForTimeout(1500);
    const runBtn = page.locator('button', { hasText: 'Run Scan' });
    await expect(runBtn).toBeEnabled();
    console.log('Confirmed: Run Scan re-enabled after admin elevation (existing gating unaffected).');
});
