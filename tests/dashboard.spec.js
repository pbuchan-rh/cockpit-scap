const { test, expect } = require('@playwright/test');
const { loginToCockpit, getModuleFrame, navigateToTab } = require('./helpers/cockpit');

async function goToDashboard(page, frame) {
    await navigateToTab(page, 'dashboard');
    await frame.locator('#db-content .db-score-block, #db-content .db-empty-body')
        .first().waitFor({ state: 'visible', timeout: 30000 });
}

test.describe('Dashboard', () => {
    test.beforeEach(async ({ page }) => {
        await loginToCockpit(page);
    });

    test('dashboard tab loads', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await goToDashboard(page, frame);
        await expect(frame.locator('#panel-dashboard')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/25-dashboard.png' });
    });

    test('quick scan button navigates to correct scan tab', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await goToDashboard(page, frame);
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
        await goToDashboard(page, frame);
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
        await goToDashboard(page, frame);
        const hostCard = frame.locator('#db-content .db-host-card');
        if (!await hostCard.isVisible().catch(() => false)) {
            test.skip('No host scan history — hero card not rendered');
            return;
        }
        await expect(hostCard.locator('.db-score-block')).toBeVisible();
        const hasRisk = await hostCard.locator('.db-risk-block').isVisible().catch(() => false);
        if (hasRisk) await expect(hostCard.locator('.db-risk-block')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/28-dashboard-hero-card.png' });
    });

    test('score trend chart renders when multiple scans exist', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await goToDashboard(page, frame);
        const hostCard = frame.locator('#db-content .db-host-card');
        if (!await hostCard.isVisible().catch(() => false)) {
            test.skip('No host scan history');
            return;
        }
        // Chart section only renders when >= 2 same-profile scans exist
        const chartSection = hostCard.locator('.db-chart-section');
        const hasChart = await chartSection.isVisible().catch(() => false);
        if (hasChart) {
            await expect(chartSection.locator('svg.db-chart-svg')).toBeVisible();
            // SVG should have at least one polyline (trend line)
            const lineCount = await chartSection.locator('svg polyline, svg line').count();
            expect(lineCount).toBeGreaterThan(0);
        }
        await page.screenshot({ path: 'tests/screenshots/28b-score-chart.png' });
    });

    test('critical findings loads and shows HIGH rules or clean state', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await goToDashboard(page, frame);
        const criticalEl = frame.locator('#db-host-critical');
        if (!await criticalEl.isVisible().catch(() => false)) {
            test.skip('No host card rendered — no scan history');
            return;
        }
        await expect(criticalEl).not.toContainText('Loading critical findings', { timeout: 30000 });
        const text = await criticalEl.textContent();
        const valid = text.includes('HIGH') || text.includes('No HIGH severity failures') || text.includes('No critical');
        expect(valid).toBeTruthy();
        await page.screenshot({ path: 'tests/screenshots/29-dashboard-critical-loaded.png' });
    });

    test('rule detail drawer opens when clicking HIGH rule and closes with Esc', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await goToDashboard(page, frame);
        const criticalEl = frame.locator('#db-host-critical');
        if (!await criticalEl.isVisible().catch(() => false)) {
            test.skip('No host card rendered');
            return;
        }
        await expect(criticalEl).not.toContainText('Loading', { timeout: 30000 });
        const highRule = criticalEl.locator('.db-critical-rule').first();
        if (!await highRule.isVisible().catch(() => false)) {
            test.skip('No HIGH rule findings to click');
            return;
        }
        await highRule.click();
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
