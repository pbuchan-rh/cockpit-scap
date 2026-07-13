// Verification for fix/action-button-polish:
// 1. Link buttons show no underline at rest, underline appears on hover.
// 2. Danger link buttons (Delete) keep red color + underline on hover.
// 3. Action-cell buttons (ScanHistory / TailoringList) are evenly spaced via
//    a flex gap instead of the old text-node-space hack, and stay on one row.
const { test, expect } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const SHOTS = 'tests/adhoc/screenshots/';

async function textDecorationAndColor(locator) {
    return locator.evaluate(el => {
        const cs = getComputedStyle(el);
        return { textDecorationLine: cs.textDecorationLine, color: cs.color };
    });
}

test('link button underline + action-cell spacing', async ({ page }) => {
    page.on('pageerror', err => console.log('[pageerror]', err.message));
    await loginToCockpit(page);
    await page.setViewportSize({ width: 1280, height: 1200 });

    const historyTable = page.locator('table[aria-label="Scan history"]');
    await historyTable.waitFor({ timeout: 15000 });
    const historyRow = historyTable.locator('tbody tr').first();
    const viewReportBtn = historyRow.locator('button', { hasText: 'View report' });
    const deleteBtn = historyRow.locator('button', { hasText: 'Delete' });

    // --- rest state: no underline ---
    const restState = await textDecorationAndColor(viewReportBtn);
    console.log('View report at rest:', JSON.stringify(restState));
    expect(restState.textDecorationLine).toBe('none');

    // --- hover state: underline appears ---
    await viewReportBtn.hover();
    await page.waitForTimeout(150);
    const hoverState = await textDecorationAndColor(viewReportBtn);
    console.log('View report on hover:', JSON.stringify(hoverState));
    expect(hoverState.textDecorationLine).toContain('underline');
    await page.screenshot({ path: SHOTS + 'link-button-hover-underline.png', clip: await viewReportBtn.boundingBox() });

    await page.mouse.move(5, 5);
    await page.waitForTimeout(150);
    const restAgain = await textDecorationAndColor(viewReportBtn);
    await page.screenshot({ path: SHOTS + 'link-button-rest-no-underline.png', clip: await viewReportBtn.boundingBox() });
    console.log('View report back at rest:', JSON.stringify(restAgain));
    expect(restAgain.textDecorationLine).toBe('none');

    // --- danger link: rest red, hover red + underline ---
    const deleteRest = await textDecorationAndColor(deleteBtn);
    console.log('Delete at rest:', JSON.stringify(deleteRest));
    await deleteBtn.hover();
    await page.waitForTimeout(150);
    const deleteHover = await textDecorationAndColor(deleteBtn);
    console.log('Delete on hover:', JSON.stringify(deleteHover));
    expect(deleteHover.textDecorationLine).toContain('underline');
    expect(deleteHover.color).toBe(deleteRest.color); // stays red/danger, doesn't flip blue
    await page.mouse.move(5, 5);

    // --- ScanHistory action-cell: horizontal, evenly gapped ---
    const historyButtons = historyRow.locator('td').last().locator('button');
    const historyRects = await historyButtons.evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON()));
    console.log('ScanHistory action button rects:', JSON.stringify(historyRects));
    const historyYs = historyRects.map(r => Math.round(r.top));
    expect(new Set(historyYs).size).toBe(1); // one row
    const historyGaps = [];
    for (let i = 1; i < historyRects.length; i++) {
        historyGaps.push(Math.round(historyRects[i].left - historyRects[i - 1].right));
    }
    console.log('ScanHistory action button gaps (px):', JSON.stringify(historyGaps));
    for (const g of historyGaps) {
        expect(g).toBeGreaterThan(4);
        expect(g).toBeLessThan(30);
    }
    const historyBox = await historyRow.locator('td').last().boundingBox();
    await page.screenshot({
        path: SHOTS + 'action-buttons-scan-history-spacing.png',
        clip: { x: historyBox.x - 10, y: historyBox.y - 10, width: historyBox.width + 20, height: historyBox.height + 20 },
    });

    // --- TailoringList action-cell: horizontal, evenly gapped ---
    const tailoringTab = page.locator('button[role="tab"]', { hasText: 'Policy Tailoring' });
    await tailoringTab.click();
    const tailoringTable = page.locator('table[aria-label="Saved tailoring policies"]');
    await tailoringTable.waitFor({ timeout: 15000 });
    const tailoringRow = tailoringTable.locator('tbody tr').first();
    const tailoringButtons = tailoringRow.locator('td').last().locator('button');
    const tailoringRects = await tailoringButtons.evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON()));
    console.log('TailoringList action button rects:', JSON.stringify(tailoringRects));
    const tailoringYs = tailoringRects.map(r => Math.round(r.top));
    expect(new Set(tailoringYs).size).toBe(1);
    const tailoringGaps = [];
    for (let i = 1; i < tailoringRects.length; i++) {
        tailoringGaps.push(Math.round(tailoringRects[i].left - tailoringRects[i - 1].right));
    }
    console.log('TailoringList action button gaps (px):', JSON.stringify(tailoringGaps));
    for (const g of tailoringGaps) {
        expect(g).toBeGreaterThan(4);
        expect(g).toBeLessThan(30);
    }
    const tailoringBox = await tailoringRow.locator('td').last().boundingBox();
    await page.screenshot({
        path: SHOTS + 'action-buttons-tailoring-spacing.png',
        clip: { x: tailoringBox.x - 10, y: tailoringBox.y - 10, width: tailoringBox.width + 20, height: tailoringBox.height + 20 },
    });

    console.log('Underline-on-hover and evenly-gapped action buttons confirmed.');
});
