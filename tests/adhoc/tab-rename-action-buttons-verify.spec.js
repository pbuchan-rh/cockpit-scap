// Verification for fix/tab-rename-action-buttons:
// 1. Tab titles renamed: "Scan" -> "Host Scan", "Tailoring" -> "Policy Tailoring"
// 2. Actions column buttons in ScanHistory + TailoringList render horizontally,
//    not stacked vertically (was a Td isActionCell width:1% + text-node line-break
//    bug, fixed via .pf-v6-c-table .ct-actions-cell { white-space: nowrap } in app.scss)
const { test, expect } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const SHOTS = 'tests/adhoc/screenshots/';

test('tab renames + horizontal action buttons', async ({ page }) => {
    page.on('pageerror', err => console.log('[pageerror]', err.message));
    await loginToCockpit(page);
    await page.setViewportSize({ width: 1280, height: 1200 });

    // --- Tab titles ---
    const scanTab = page.locator('button[role="tab"]', { hasText: 'Host Scan' });
    const tailoringTab = page.locator('button[role="tab"]', { hasText: 'Policy Tailoring' });
    await expect(scanTab).toBeVisible({ timeout: 15000 });
    await expect(tailoringTab).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: SHOTS + 'tab-rename-host-scan-tab.png', fullPage: true });
    console.log('Tab titles confirmed: "Host Scan" and "Policy Tailoring" both visible.');

    // --- Scan History: horizontal action buttons ---
    const historyTable = page.locator('table[aria-label="Scan history"]');
    await historyTable.waitFor({ timeout: 15000 });
    const historyRow = historyTable.locator('tbody tr').first();
    const historyButtons = historyRow.locator('td').last()
            .locator('button');
    const historyRects = await historyButtons.evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON()));
    console.log('ScanHistory action button rects:', JSON.stringify(historyRects));
    const historyYs = historyRects.map(r => Math.round(r.top));
    expect(new Set(historyYs).size).toBe(1); // all on the same line
    await page.locator('.pf-v6-c-card', { hasText: 'Scan History' }).screenshot({ path: SHOTS + 'action-buttons-scan-history-horizontal.png' });
    const historyBox = await historyRow.locator('td').last()
            .boundingBox();
    await page.screenshot({
        path: SHOTS + 'action-buttons-scan-history-zoom.png',
        clip: { x: historyBox.x - 10, y: historyBox.y - 10, width: historyBox.width + 20, height: historyBox.height + 20 },
    });

    // --- Tailoring: horizontal action buttons ---
    await tailoringTab.click();
    const tailoringTable = page.locator('table[aria-label="Saved tailoring policies"]');
    await tailoringTable.waitFor({ timeout: 15000 });
    const tailoringRow = tailoringTable.locator('tbody tr').first();
    const tailoringButtons = tailoringRow.locator('td').last()
            .locator('button');
    const tailoringRects = await tailoringButtons.evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON()));
    console.log('TailoringList action button rects:', JSON.stringify(tailoringRects));
    const tailoringYs = tailoringRects.map(r => Math.round(r.top));
    expect(new Set(tailoringYs).size).toBe(1); // all on the same line
    await page.locator('.pf-v6-c-card', { hasText: 'Saved Tailoring Policies' }).screenshot({ path: SHOTS + 'action-buttons-tailoring-horizontal.png' });

    console.log('Both Actions columns confirmed horizontal (single Y row).');
});
