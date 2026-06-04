const { test, expect } = require('@playwright/test');
const { loginToCockpit, getModuleFrame, navigateToTab, canDoPrivilegedWrite } = require('./helpers/cockpit');

const HOST_SDS     = '/usr/share/xml/scap/ssg/content/ssg-rhel10-ds.xml';
const HOST_PROFILE = 'xccdf_org.ssgproject.content_profile_pci-dss';
const TAILOR_NAME  = 'playwright-rhel10-pci';

test.describe('Policy Tailoring', () => {
    test.beforeEach(async ({ page }) => {
        await loginToCockpit(page);
    });

    test('tailoring tab loads', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await navigateToTab(page, 'tailoring');
        await expect(frame.locator('#ct-tailor-content-select')).toBeVisible();
        await expect(frame.locator('#ct-tailor-profile-select')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/11-tailoring-tab.png' });
    });

    test('load profile into editor', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await navigateToTab(page, 'tailoring');
        await frame.locator('#ct-tailor-content-select').selectOption({ value: HOST_SDS });
        await expect(frame.locator('#ct-tailor-profile-select')).toBeEnabled({ timeout: 90000 });
        await frame.locator('#ct-tailor-profile-select').selectOption({ value: HOST_PROFILE });
        await frame.locator('#ct-tailor-name-input').fill(TAILOR_NAME);
        await frame.locator('#ct-tailor-load-btn').click();
        await expect(frame.locator('#ct-tailor-editor')).toBeVisible({ timeout: 30000 });
        await expect(frame.locator('#ct-tailor-expand-all')).toBeVisible({ timeout: 10000 });
        await page.screenshot({ path: 'tests/screenshots/12-tailoring-editor.png' });
    });

    test('disable a rule and save', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await navigateToTab(page, 'tailoring');
        await frame.locator('#ct-tailor-content-select').selectOption({ value: HOST_SDS });
        await expect(frame.locator('#ct-tailor-profile-select')).toBeEnabled({ timeout: 90000 });
        await frame.locator('#ct-tailor-profile-select').selectOption({ value: HOST_PROFILE });
        await frame.locator('#ct-tailor-name-input').fill(TAILOR_NAME + '-save');
        await frame.locator('#ct-tailor-load-btn').click();
        await expect(frame.locator('#ct-tailor-editor')).toBeVisible({ timeout: 30000 });

        // Tailoring save writes to /var/lib/cockpit-scap/ — skip if privileged bridge cannot write
        if (!await canDoPrivilegedWrite(page)) {
            test.skip(true, 'Skipped: privileged write probe failed — add Defaults!/usr/bin/cockpit-bridge !use_pty to /etc/sudoers.d/cockpit-bridge');
            return;
        }

        // Expand all rules so checkboxes are interactable, then uncheck first one
        await frame.locator('#ct-tailor-expand-all').click();
        await frame.locator('#ct-tailor-editor input[type="checkbox"]').first().uncheck({ force: true });
        await frame.locator('#ct-tailor-save-btn').click();
        await expect(frame.locator('#ct-tailor-editor')).toBeHidden({ timeout: 45000 });
        await page.screenshot({ path: 'tests/screenshots/13-tailoring-saved.png' });
    });

    test('saved tailoring file appears in host scan dropdown', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await navigateToTab(page, 'hostScan');
        await frame.locator('#ct-content-select').selectOption({ value: HOST_SDS });
        // detectTailoringFiles() is async — poll until our saved file appears
        await expect.poll(
            async () => {
                const opts = await frame.locator('#ct-tailor-file-select option').allTextContents();
                return opts.some(t => t.includes(TAILOR_NAME));
            },
            { timeout: 10000 }
        ).toBe(true);
        await page.screenshot({ path: 'tests/screenshots/14-tailoring-in-scan.png' });
    });

    test('cross-version content visible in tailoring selector', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await navigateToTab(page, 'tailoring');
        // Poll until detectContent() has populated the tailor select with all files
        await expect.poll(
            () => frame.locator('#ct-tailor-content-select option').count(),
            { timeout: 15000 }
        ).toBeGreaterThan(1);
        await page.screenshot({ path: 'tests/screenshots/15-tailoring-all-content.png' });
    });
});
