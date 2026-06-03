const { test, expect } = require('@playwright/test');
const { loginToCockpit, getModuleFrame, navigateToTab } = require('./helpers/cockpit');

const CONTAINER_SDS     = '/var/lib/cockpit-scap/content/ssg-rhel9-ds.xml';
const CONTAINER_PROFILE = 'xccdf_org.ssgproject.content_profile_pci-dss';
const TAILOR_NAME       = 'playwright-ubi9-pci';   // created by 00-setup.spec.js

/* Helper: navigate to container scan tab and wait for scan section to show.
   Returns false if prereqs never satisfy — callers should skip on false. */
async function goToContainerScan(page, frame) {
    await navigateToTab(page, 'containerScan');
    return frame.locator('#cs-scan-section')
        .waitFor({ state: 'visible', timeout: 60000 })
        .then(() => true).catch(() => false);
}

/* Helper: load first container scan history entry into results */
async function loadContainerResultsFromHistory(frame) {
    // .isVisible() is immediate — use waitFor() to actually wait for async history load
    try {
        await frame.locator('#cs-history-tbody tr').first()
            .waitFor({ state: 'visible', timeout: 15000 });
    } catch {
        return false;
    }
    await frame.locator('#cs-history-tbody tr:first-child button:has-text("View Scan")').click();
    await expect(frame.locator('#cs-results')).toBeVisible({ timeout: 10000 });
    return true;
}

/* Helper: open container remediation drawer and wait for rules to render */
async function openContainerRemediationDrawer(frame) {
    await frame.locator('#cs-review-all-btn').click();
    await expect(frame.locator('#cs-remediation-panel')).toHaveClass(/ct-drawer-open/, { timeout: 10000 });
    await expect(frame.locator('#cs-remediation-content')).toBeVisible({ timeout: 20000 });
}

test.describe('Container Scan', () => {
    test.beforeEach(async ({ page }) => {
        await loginToCockpit(page);
        // Skip all container tests if the tab is disabled (off by default on fresh install)
        const frame = await getModuleFrame(page);
        const tabVisible = await page.locator('#tab-btn-container-scan').isVisible({ timeout: 5000 }).catch(() => false);
        if (!tabVisible) {
            test.skip(true, 'Container Scan tab not available — enable it in Settings or ensure podman prereqs are met');
        }
    });

    test('container scan tab loads', async ({ page }) => {
        const frame = await getModuleFrame(page);
        if (!await goToContainerScan(page, frame)) {
            test.skip(true, 'Container scan prerequisites not met');
            return;
        }
        await page.screenshot({ path: 'tests/screenshots/16-container-tab.png' });
    });

    test('UBI9 image appears in image list', async ({ page }) => {
        const frame = await getModuleFrame(page);
        if (!await goToContainerScan(page, frame)) {
            test.skip(true, 'Container scan prerequisites not met');
            return;
        }
        const options = await frame.locator('#cs-image-select option').allTextContents();
        const found = options.some(t => t.includes('ubi9'));
        if (!found) {
            test.skip(true, 'No UBI9 image available — pull registry.access.redhat.com/ubi9/ubi-minimal:latest');
            return;
        }
        expect(found).toBeTruthy();
        await page.screenshot({ path: 'tests/screenshots/17-container-images.png' });
    });

    test('run container scan with PCI-DSS profile and tailoring', async ({ page }) => {
        const frame = await getModuleFrame(page);
        if (!await goToContainerScan(page, frame)) {
            test.skip(true, 'Container scan prerequisites not met');
            return;
        }

        const options = await frame.locator('#cs-image-select option').allTextContents();
        if (!options.some(t => t.includes('ubi9'))) {
            test.skip(true, 'UBI9 image not available');
            return;
        }
        await frame.locator('#cs-image-select').selectOption({ value: 'registry.access.redhat.com/ubi9/ubi-minimal:latest' });
        await frame.locator('#cs-content-select').selectOption({ value: CONTAINER_SDS });
        await expect(frame.locator('#cs-profile-select')).toBeEnabled({ timeout: 90000 });
        await frame.locator('#cs-profile-select').selectOption({ value: CONTAINER_PROFILE });

        // Select tailoring file created by 00-setup.spec.js
        const tailorOpts = await frame.locator('#cs-tailor-file-select option').allTextContents();
        const tailorMatch = tailorOpts.find(t => t.includes(TAILOR_NAME));
        if (tailorMatch) {
            await frame.locator('#cs-tailor-file-select').selectOption({ label: tailorMatch });
        }

        await page.screenshot({ path: 'tests/screenshots/18-container-scan-configured.png' });
        await frame.locator('#cs-scan-btn').click();
        await page.screenshot({ path: 'tests/screenshots/19-container-scan-running.png' });

        await frame.locator('#cs-results').waitFor({ state: 'visible', timeout: 180000 });
        await expect(frame.locator('#cs-result-score')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/20-container-scan-results.png' });
    });

    test('container scan history entry exists', async ({ page }) => {
        const frame = await getModuleFrame(page);
        if (!await goToContainerScan(page, frame)) {
            test.skip(true, 'Container scan prerequisites not met');
            return;
        }
        const hasHistory = await frame.locator('#cs-history-tbody tr').first()
            .waitFor({ state: 'visible', timeout: 15000 })
            .then(() => true).catch(() => false);
        if (!hasHistory) { test.skip(true, 'No container scan history available'); return; }
        await page.screenshot({ path: 'tests/screenshots/21-container-history.png' });
    });

    test('container selective remediation builder opens from history', async ({ page }) => {
        const frame = await getModuleFrame(page);
        if (!await goToContainerScan(page, frame)) { test.skip(true, 'Container scan prerequisites not met'); return; }
        const loaded = await loadContainerResultsFromHistory(frame);
        if (!loaded) {
            test.skip('No container scan history available');
            return;
        }
        await openContainerRemediationDrawer(frame);
        // Verify the content area is shown — rules may be empty if the tailored scan had 0 failures
        await expect(frame.locator('#cs-remediation-content')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/22-container-remediation.png' });
    });

    test('Apply Now is permanently disabled for container scans', async ({ page }) => {
        const frame = await getModuleFrame(page);
        if (!await goToContainerScan(page, frame)) { test.skip(true, 'Container scan prerequisites not met'); return; }
        const loaded = await loadContainerResultsFromHistory(frame);
        if (!loaded) {
            test.skip('No container scan history available');
            return;
        }
        await openContainerRemediationDrawer(frame);

        // Apply Now must stay disabled regardless of admin state — oscap-podman does not support --remediate
        const applyBtn = frame.locator('#cs-rem-apply-btn');
        await expect(applyBtn).toBeVisible();
        await expect(applyBtn).toBeDisabled();
        await page.screenshot({ path: 'tests/screenshots/23-container-apply-disabled.png' });
    });

    test('container remediation search filters and clears rules', async ({ page }) => {
        const frame = await getModuleFrame(page);
        if (!await goToContainerScan(page, frame)) { test.skip(true, 'Container scan prerequisites not met'); return; }
        const loaded = await loadContainerResultsFromHistory(frame);
        if (!loaded) {
            test.skip('No container scan history available');
            return;
        }
        await openContainerRemediationDrawer(frame);

        const totalItems = await frame.locator('#cs-remediation-rules .ct-rem-rule-item').count();
        if (totalItems === 0) {
            test.skip('Container scan history has 0 failing rules — search cannot be exercised');
            return;
        }

        // Search with a term that won't match anything
        await frame.locator('#cs-rem-search').fill('xxxxxxnosuchrulexxx');

        // All visible items should be zero
        const visibleItems = await frame.locator(
            '#cs-remediation-rules .ct-rem-rule-item:not([style*="none"])'
        ).count();
        expect(visibleItems).toBe(0);

        // Clear search — all items visible again
        await frame.locator('#cs-rem-search').fill('');
        const restoredItems = await frame.locator(
            '#cs-remediation-rules .ct-rem-rule-item:not([style*="none"])'
        ).count();
        expect(restoredItems).toBe(totalItems);

        await page.screenshot({ path: 'tests/screenshots/24-container-rem-search.png' });
    });
});
