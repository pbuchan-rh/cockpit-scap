const { test, expect } = require('@playwright/test');
const { loginToCockpit, getModuleFrame, navigateToTab, canDoPrivilegedWrite } = require('./helpers/cockpit');

const RHEL9_SDS     = '/var/lib/cockpit-scap/content/ssg-rhel9-ds.xml';
const RHEL9_PROFILE = 'xccdf_org.ssgproject.content_profile_pci-dss';
const RHEL10_SDS    = '/usr/share/xml/scap/ssg/content/ssg-rhel10-ds.xml';
const RHEL10_PROFILE = 'xccdf_org.ssgproject.content_profile_pci-dss';

async function createTailoring(frame, page, sds, profile, name) {
    await frame.locator('#ct-tailor-content-select').selectOption({ value: sds });
    await expect(frame.locator('#ct-tailor-profile-select')).toBeEnabled({ timeout: 90000 });
    await frame.locator('#ct-tailor-profile-select').selectOption({ value: profile });
    await frame.locator('#ct-tailor-name-input').fill(name);
    await frame.locator('#ct-tailor-load-btn').click();
    await expect(frame.locator('#ct-tailor-editor')).toBeVisible({ timeout: 30000 });
    await frame.locator('#ct-tailor-expand-all').click();
    await frame.locator('#ct-tailor-editor input[type="checkbox"]').first().uncheck({ force: true });
    await frame.locator('#ct-tailor-save-btn').click();
    await expect(frame.locator('#ct-tailor-editor')).toBeHidden({ timeout: 45000 });
}

test.describe('Setup', () => {
    test('create UBI9 PCI-DSS tailoring file', async ({ page }) => {
        await loginToCockpit(page);
        const frame = await getModuleFrame(page);
        await navigateToTab(page, 'tailoring');

        if (!await canDoPrivilegedWrite(page)) {
            test.skip(true, 'Skipped: privileged write probe failed — add Defaults!/usr/bin/cockpit-bridge !use_pty to /etc/sudoers.d/cockpit-bridge');
            return;
        }

        await page.screenshot({ path: 'tests/screenshots/00-setup-before.png' });
        await createTailoring(frame, page, RHEL9_SDS, RHEL9_PROFILE, 'playwright-ubi9-pci');
        await page.screenshot({ path: 'tests/screenshots/00-setup-ubi9-saved.png' });

        await createTailoring(frame, page, RHEL10_SDS, RHEL10_PROFILE, 'playwright-rhel10-pci');
        await page.screenshot({ path: 'tests/screenshots/00-setup-rhel10-saved.png' });
    });
});
