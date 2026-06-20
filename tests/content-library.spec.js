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
        // The content list populates asynchronously, so wait for a row rather than
        // taking an instant isVisible() snapshot — otherwise this skips on a slow load.
        const row = frame.locator('#ct-user-content-list tbody tr').first();
        const hasContent = await row.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
        if (!hasContent) {
            test.skip('No uploaded content to validate');
            return;
        }
        // Selected by position (first button in the row), not by text — the button's
        // text changes on click ("Validate" -> "✓ Valid"/"✗ Invalid"), and a text-based
        // locator would silently re-resolve to a different, unclicked row.
        const validateBtn = row.locator('button').first();
        await validateBtn.click();
        await expect(validateBtn).toHaveText(/✓ Valid|✗ Invalid/, { timeout: 120000 });
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
