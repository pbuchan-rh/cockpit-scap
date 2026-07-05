// Adhoc verification of admin-gating: a non-admin (limited access) user
// should see the setup form but Run Scan must stay disabled.
const { test, expect } = require('@playwright/test');
const { COCKPIT_URL } = require('../helpers/cockpit.js');
require('dotenv').config({ path: __dirname + '/../.env' });

const COCKPIT_USER = process.env.COCKPIT_USER || 'pbuchan';
const COCKPIT_PASS = process.env.COCKPIT_PASS || '';
const MODULE_PATH = '/cockpit/@localhost/scap/index.html';

test('non-admin cannot run a scan', async ({ page }) => {
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

    // Deliberately do NOT elevate admin — navigate straight to the module limited-access.
    await page.goto(COCKPIT_URL + MODULE_PATH);
    await page.waitForLoadState('domcontentloaded');

    const card = page.locator('.pf-v6-c-card').first();
    await card.waitFor({ timeout: 15000 });
    await page.screenshot({ path: `tests/adhoc/screenshots/07-nonadmin-setup.png`, fullPage: true });

    // Form is visible (content/profile selects render) ...
    const contentSelect = page.locator('#ct-scap-content');
    await contentSelect.waitFor({ timeout: 10000 });

    // ... but Run Scan is disabled since admin hasn't been granted.
    const runBtn = page.locator('button', { hasText: 'Run Scan' });
    await expect(runBtn).toBeVisible();
    await expect(runBtn).toBeDisabled();
    console.log('Confirmed: Run Scan is disabled without admin access.');
});
