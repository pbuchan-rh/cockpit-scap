const { test, expect } = require('@playwright/test');
const { loginToCockpit, getModuleFrame, navigateToTab, canDoPrivilegedWrite } = require('./helpers/cockpit');

test.describe('Settings', () => {
    test.beforeEach(async ({ page }) => {
        await loginToCockpit(page);
    });

    test('settings tab loads with retention inputs', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await navigateToTab(page, 'settings');
        await expect(frame.locator('#panel-settings')).toBeVisible();
        await expect(frame.locator('#ct-setting-host-retention')).toBeVisible();
        await expect(frame.locator('#ct-setting-container-retention')).toBeVisible();
        await expect(frame.locator('#ct-setting-container-enabled')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/settings-01-tab.png' });
    });

    test('retention inputs have values within valid range', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await navigateToTab(page, 'settings');
        const hostVal      = parseInt(await frame.locator('#ct-setting-host-retention').inputValue());
        const containerVal = parseInt(await frame.locator('#ct-setting-container-retention').inputValue());
        expect(hostVal).toBeGreaterThanOrEqual(1);
        expect(hostVal).toBeLessThanOrEqual(50);
        expect(containerVal).toBeGreaterThanOrEqual(1);
        expect(containerVal).toBeLessThanOrEqual(50);
    });

    test('disk usage is populated after settings load', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await navigateToTab(page, 'settings');
        // fetchDiskUsage() is async — poll until value is no longer the placeholder '—'
        await expect.poll(
            () => frame.locator('#ct-settings-disk-results').textContent(),
            { timeout: 10000, message: 'Disk usage never populated' }
        ).not.toBe('—');
        await page.screenshot({ path: 'tests/screenshots/settings-02-disk-usage.png' });
    });


    test('disabling Container Scan tab hides it, re-enabling restores it', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await navigateToTab(page, 'settings');

        const checkbox = frame.locator('#ct-setting-container-enabled');
        const saveBtn  = frame.locator('#ct-settings-save-btn');

        // Admin state propagates async — wait for the save button to be enabled before interacting
        await expect(saveBtn).toBeEnabled({ timeout: 20000 });

        // Settings write to /var/lib/cockpit-scap/ — skip if privileged bridge cannot write
        if (!await canDoPrivilegedWrite(page)) {
            test.skip(true, 'Skipped: privileged write probe failed — add Defaults!/usr/bin/cockpit-bridge !use_pty to /etc/sudoers.d/cockpit-bridge');
            return;
        }

        // Ensure Container Scan starts enabled
        if (!await checkbox.isChecked()) {
            await checkbox.check({ force: true });
            await saveBtn.click();
            await expect(frame.locator('#ct-settings-saved')).toBeVisible({ timeout: 8000 });
        }

        // Disable Container Scan
        await checkbox.uncheck({ force: true });
        await saveBtn.click();
        await expect(frame.locator('#ct-settings-saved')).toBeVisible({ timeout: 8000 });

        // Container Scan tab should not be visible
        await expect(frame.locator('#tab-btn-container-scan')).not.toBeVisible({ timeout: 3000 });
        await page.screenshot({ path: 'tests/screenshots/settings-05-container-disabled.png' });

        // Re-enable — cleanup
        await checkbox.check({ force: true });
        await saveBtn.click();
        await expect(frame.locator('#ct-settings-saved')).toBeVisible({ timeout: 5000 });
        await expect(frame.locator('#tab-btn-container-scan')).toBeVisible({ timeout: 3000 });
        await page.screenshot({ path: 'tests/screenshots/settings-06-container-restored.png' });
    });
});
