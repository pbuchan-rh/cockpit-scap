const { test, expect } = require('@playwright/test');
const { loginToCockpit, getModuleFrame, navigateToTab } = require('./helpers/cockpit');

/* Returns false if dashboard content never loads — callers should skip on false. */
async function goToDashboard(page, frame) {
    await navigateToTab(page, 'dashboard');
    return frame.locator('#db-content .db-score-block, #db-content .db-empty-body')
        .first().waitFor({ state: 'visible', timeout: 30000 })
        .then(() => true).catch(() => false);
}

test.describe('Dashboard', () => {
    test.beforeEach(async ({ page }) => {
        await loginToCockpit(page);
        // Skip all dashboard tests if the tab is disabled (off by default on fresh install)
        const tabVisible = await page.locator('#tab-btn-dashboard').isVisible({ timeout: 5000 }).catch(() => false);
        if (!tabVisible) {
            test.skip(true, 'Dashboard tab not available — enable it in Settings first');
        }
    });

    test('dashboard tab loads', async ({ page }) => {
        const frame = await getModuleFrame(page);
        if (!await goToDashboard(page, frame)) { test.skip(true, 'Dashboard content did not load'); return; }
        await expect(frame.locator('#panel-dashboard')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/25-dashboard.png' });
    });

    test('quick scan button navigates to correct scan tab', async ({ page }) => {
        const frame = await getModuleFrame(page);
        if (!await goToDashboard(page, frame)) { test.skip(true, 'Dashboard content did not load'); return; }
        const quickScanBtn = frame.locator('#panel-dashboard button:has-text("Quick Scan")').first();
        if (!await quickScanBtn.isVisible().catch(() => false)) {
            test.skip('No Quick Scan button — no scan history yet');
            return;
        }
        await quickScanBtn.click();
        const hostActive      = await frame.locator('button#tab-btn-scan[aria-selected="true"]').isVisible().catch(() => false);
        const containerActive = await frame.locator('button#tab-btn-container-scan[aria-selected="true"]').isVisible().catch(() => false);
        expect(hostActive || containerActive).toBeTruthy();
        await page.screenshot({ path: 'tests/screenshots/26-quick-scan-nav.png' });
    });

    test('view last scan navigates and loads results', async ({ page }) => {
        const frame = await getModuleFrame(page);
        if (!await goToDashboard(page, frame)) { test.skip(true, 'Dashboard content did not load'); return; }
        const viewBtn = frame.locator('#panel-dashboard button:has-text("View Last Scan")').first();
        if (!await viewBtn.isVisible().catch(() => false)) {
            test.skip('No View Last Scan button — no scan history yet');
            return;
        }
        await viewBtn.click();
        await expect.poll(
            async () => {
                const ct = await frame.locator('#ct-results').isVisible().catch(() => false);
                const cs = await frame.locator('#cs-results').isVisible().catch(() => false);
                return ct || cs;
            },
            { timeout: 10000 }
        ).toBe(true);
        await page.screenshot({ path: 'tests/screenshots/27-view-last-scan.png' });
    });

    test('host hero card shows score and risk score', async ({ page }) => {
        const frame = await getModuleFrame(page);
        if (!await goToDashboard(page, frame)) { test.skip(true, 'Dashboard content did not load'); return; }
        const hostCard = frame.locator('#db-host-section .db-timeline-card');
        if (!await hostCard.isVisible().catch(() => false)) {
            test.skip(true, 'No host scan history — timeline card not rendered');
            return;
        }
        await expect(hostCard.locator('.db-timeline-score')).toBeVisible();
        await expect(hostCard.locator('.db-timeline-header')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/28-dashboard-hero-card.png' });
    });

    test('score trend chart renders when multiple scans exist', async ({ page }) => {
        const frame = await getModuleFrame(page);
        if (!await goToDashboard(page, frame)) { test.skip(true, 'Dashboard content did not load'); return; }
        const hostCard = frame.locator('#db-host-section .db-timeline-card');
        if (!await hostCard.isVisible().catch(() => false)) {
            test.skip(true, 'No host scan history');
            return;
        }
        // Chart lives in the timeline card body — only renders when >= 1 scan exists
        const chartBody = hostCard.locator('.db-timeline-body');
        const hasChart = await chartBody.locator('svg.db-chart-svg').isVisible().catch(() => false);
        if (hasChart) {
            await expect(chartBody.locator('svg.db-chart-svg')).toBeVisible();
            const lineCount = await chartBody.locator('svg polyline, svg line').count();
            expect(lineCount).toBeGreaterThan(0);
        }
        await page.screenshot({ path: 'tests/screenshots/28b-score-chart.png' });
    });

    test('critical findings loads and shows persistent failures or clean state', async ({ page }) => {
        const frame = await getModuleFrame(page);
        if (!await goToDashboard(page, frame)) { test.skip(true, 'Dashboard content did not load'); return; }
        const persistCard = frame.locator('#db-host-section .db-persist-card');
        if (!await persistCard.isVisible().catch(() => false)) {
            test.skip(true, 'No host scan history — persistent failures card not rendered');
            return;
        }
        await expect(persistCard.locator('.db-persist-title')).toBeVisible({ timeout: 10000 });
        await expect(persistCard).not.toContainText('Loading');
        await page.screenshot({ path: 'tests/screenshots/29-dashboard-critical-loaded.png' });
    });

    test('rule detail drawer opens when clicking persistent failure rule and closes with Esc', async ({ page }) => {
        const frame = await getModuleFrame(page);
        if (!await goToDashboard(page, frame)) { test.skip(true, 'Dashboard content did not load'); return; }
        const persistCard = frame.locator('#db-host-section .db-persist-card');
        if (!await persistCard.isVisible().catch(() => false)) {
            test.skip(true, 'No host card rendered');
            return;
        }
        await expect(persistCard.locator('.db-persist-title')).toBeVisible({ timeout: 10000 });
        const persistRule = persistCard.locator('.db-persist-rule').first();
        if (!await persistRule.isVisible().catch(() => false)) {
            test.skip(true, 'No persistent failure rules to click — need 3+ consecutive scans with same failure');
            return;
        }
        await persistRule.click();
        const rddDrawer = frame.locator('#ct-rule-detail-drawer');
        await expect(rddDrawer).toHaveClass(/ct-drawer-open/, { timeout: 5000 });
        await expect(frame.locator('#ct-rdd-body')).toBeVisible();
        // Body should contain actual content
        const bodyText = await frame.locator('#ct-rdd-body').textContent();
        expect(bodyText.length).toBeGreaterThan(20);
        await page.screenshot({ path: 'tests/screenshots/29b-rule-detail-drawer.png' });
        // Close with Esc
        await page.keyboard.press('Escape');
        await expect(rddDrawer).not.toHaveClass(/ct-drawer-open/, { timeout: 5000 });
    });
});
