const { test, expect } = require('@playwright/test');
const { loginToCockpit, getModuleFrame, navigateToTab } = require('./helpers/cockpit');

test.describe('Content Library', () => {
    test.beforeEach(async ({ page }) => {
        await loginToCockpit(page);
    });

    test('content library sections appear in settings tab', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await navigateToTab(page, 'settings');
        await expect(frame.locator('#panel-settings')).toBeVisible({ timeout: 10000 });
        await expect(frame.locator('#panel-settings h3:has-text("System Content")')).toBeVisible();
        await expect(frame.locator('#panel-settings h3:has-text("Uploaded Content")')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/26-content-library.png' });
    });

    test('system content list is populated', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await navigateToTab(page, 'settings');
        const list = frame.locator('#ct-system-content-list');
        await expect(list).toBeVisible({ timeout: 10000 });
        await expect(list.locator('tr, li, .ct-content-item').first()).toBeVisible({ timeout: 10000 });
        await page.screenshot({ path: 'tests/screenshots/27-system-content.png' });
    });

    test('validate button runs for uploaded content', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await navigateToTab(page, 'settings');
        const validateBtn = frame.locator('#panel-settings button:has-text("Validate")').first();
        if (!await validateBtn.isVisible().catch(() => false)) {
            test.skip('No uploaded content to validate');
            return;
        }
        await validateBtn.click();
        await expect(frame.locator('#panel-settings').locator('text=/valid|invalid/i')).toBeVisible({ timeout: 120000 });
        await page.screenshot({ path: 'tests/screenshots/28-validate-result.png' });
    });

    test('upload and delete buttons are admin-gated', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await navigateToTab(page, 'settings');
        const gatedBtns = frame.locator('#panel-settings button.ct-requires-admin');
        const count = await gatedBtns.count();
        expect(count).toBeGreaterThan(0);
        await page.screenshot({ path: 'tests/screenshots/29-admin-gate.png' });
    });
});
