// Verifies the Tooltip additions to View Compliance Guide / Download
// Remediation (first Tooltip usage anywhere in this app — grep confirms
// zero prior usage). Special attention to the Download Remediation
// split-button: its MenuToggle ref is already owned by <Dropdown>, so the
// tooltip there uses Tooltip's `triggerRef` prop (native DOM listeners)
// instead of the usual child-wrapping (which would collide with that ref)
// — this file checks that choice didn't regress the split-button's click/
// keyboard/outside-click behavior already verified in the V4.4 build.
const { test, expect } = require('@playwright/test');
const { COCKPIT_URL } = require('../helpers/cockpit.js');
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
    await page.goto(COCKPIT_URL + MODULE_PATH);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#ct-scap-content').waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
}

test.describe.configure({ mode: 'serial' });

test('View Compliance Guide tooltip shows correct text on hover', async ({ page }) => {
    await loginNoAdmin(page);
    const guideBtn = page.locator('button', { hasText: 'View Compliance Guide' });
    await guideBtn.hover();
    const tooltip = page.locator('.pf-v6-c-tooltip__content');
    await expect(tooltip).toBeVisible({ timeout: 5000 });
    await expect(tooltip).toHaveText('Generate and view the full oscap security guide for the selected profile');
    console.log('Confirmed: View Compliance Guide tooltip text correct.');
    await page.screenshot({ path: 'tests/adhoc/screenshots/v43-tooltip-guide.png' });
});

test('Download Remediation toggle tooltip shows correct text on hover (primary action)', async ({ page }) => {
    await loginNoAdmin(page);
    const primaryAction = page.locator('#ct-download-remediation-primary');
    await primaryAction.hover();
    const tooltip = page.locator('.pf-v6-c-tooltip__content');
    await expect(tooltip).toBeVisible({ timeout: 5000 });
    await expect(tooltip).toHaveText('Generate and download a remediation script for all rules in the selected profile — no scan required');
    console.log('Confirmed: Download Remediation toggle tooltip text correct (hover on primary action).');
    await page.screenshot({ path: 'tests/adhoc/screenshots/v43-tooltip-remediation-toggle.png' });
});

test('Download Remediation toggle tooltip also shows on the caret half', async ({ page }) => {
    await loginNoAdmin(page);
    const caretToggle = page.locator('button[aria-label="Select remediation format"]');
    await caretToggle.hover();
    const tooltip = page.locator('.pf-v6-c-tooltip__content');
    await expect(tooltip).toBeVisible({ timeout: 5000 });
    await expect(tooltip).toHaveText('Generate and download a remediation script for all rules in the selected profile — no scan required');
    console.log('Confirmed: same tooltip covers the caret half of the split button (triggerRef spans the whole MenuToggle DOM node).');
});

test('Bash/Ansible/Puppet dropdown items show correct tooltip text', async ({ page }) => {
    await loginNoAdmin(page);
    const caretToggle = page.locator('button[aria-label="Select remediation format"]');
    await caretToggle.click();

    const cases = [
        { label: 'Bash', text: 'Shell script for direct execution on RHEL/Fedora systems' },
        { label: 'Ansible', text: 'Ansible playbook for automated configuration management' },
        { label: 'Puppet', text: 'Puppet manifest for Puppet-managed infrastructure' },
    ];
    for (const { label, text } of cases) {
        const item = page.locator('.pf-v6-c-menu__item', { hasText: label });
        await item.hover();
        const tooltip = page.locator('.pf-v6-c-tooltip__content');
        await expect(tooltip).toBeVisible({ timeout: 5000 });
        await expect(tooltip).toHaveText(text);
        console.log(`Confirmed: ${label} dropdown item tooltip text correct.`);
    }
    await page.screenshot({ path: 'tests/adhoc/screenshots/v43-tooltip-dropdown-items.png' });
});

test('regression: split-button primary click still directly downloads bash (no menu open)', async ({ page }) => {
    await loginNoAdmin(page);
    const primaryAction = page.locator('#ct-download-remediation-primary');

    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        primaryAction.click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^profile-remediation-.*\.sh$/);
    console.log('Confirmed: clicking the primary action (tooltip-wrapped via triggerRef) still directly triggers a bash download, not the menu.');

    // Confirm the dropdown menu did NOT open as a side effect of the click.
    const bashItem = page.locator('.pf-v6-c-menu__item', { hasText: 'Bash' });
    await expect(bashItem).toBeHidden();
});

test('regression: caret still opens dropdown, Escape and outside-click still close it', async ({ page }) => {
    await loginNoAdmin(page);
    const caretToggle = page.locator('button[aria-label="Select remediation format"]');
    const bashItem = page.locator('.pf-v6-c-menu__item', { hasText: 'Bash' });

    await caretToggle.click();
    await expect(bashItem).toBeVisible();
    console.log('Confirmed: caret click still opens the dropdown menu with the tooltip attached.');

    await page.keyboard.press('Escape');
    await expect(bashItem).toBeHidden();
    console.log('Confirmed: Escape still closes the dropdown.');

    await caretToggle.click();
    await expect(bashItem).toBeVisible();
    await page.locator('h2', { hasText: 'SCAP Security Scan' }).click();
    await expect(bashItem).toBeHidden();
    console.log('Confirmed: outside click still closes the dropdown.');
});

test('regression: selecting a format from the open dropdown still downloads the right file', async ({ page }) => {
    await loginNoAdmin(page);
    const caretToggle = page.locator('button[aria-label="Select remediation format"]');
    await caretToggle.click();
    const ansibleItem = page.locator('.pf-v6-c-menu__item', { hasText: 'Ansible' });
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        ansibleItem.click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^profile-remediation-.*\.yml$/);
    console.log('Confirmed: selecting Ansible from the tooltip-wrapped dropdown item still downloads the ansible file.');
});

test('dark mode: tooltips render correctly', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await loginNoAdmin(page);
    const guideBtn = page.locator('button', { hasText: 'View Compliance Guide' });
    await guideBtn.hover();
    const tooltip = page.locator('.pf-v6-c-tooltip__content');
    await expect(tooltip).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'tests/adhoc/screenshots/v43-tooltip-guide-darkmode.png' });
    console.log('Captured dark-mode tooltip screenshot.');
});
