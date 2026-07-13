// Investigation script (not a real spec) for the stacked-action-buttons bug.
// Inspects computed styles on the Actions <Td> and its <Button> children in
// both Scan History and Tailoring tables to find the root cause of vertical
// stacking instead of horizontal layout.
const { test } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const SHOTS = 'tests/adhoc/screenshots/';

async function inspect(page, tableSelector, label) {
    const td = page.locator(`${tableSelector} tbody tr`).first().locator('td').last();
    await td.waitFor({ timeout: 15000 });

    const info = await td.evaluate(el => {
        const cs = getComputedStyle(el);
        const buttons = Array.from(el.querySelectorAll('button'));
        return {
            td: {
                display: cs.display,
                width: cs.width,
                whiteSpace: cs.whiteSpace,
                className: el.className,
            },
            buttons: buttons.map(b => {
                const bcs = getComputedStyle(b);
                return {
                    text: b.textContent.trim(),
                    display: bcs.display,
                    rect: b.getBoundingClientRect().toJSON(),
                };
            }),
        };
    });
    console.log(`[${label}] Actions cell info:`, JSON.stringify(info, null, 2));
}

test('investigate stacked action buttons', async ({ page }) => {
    page.on('pageerror', err => console.log('[pageerror]', err.message));
    await loginToCockpit(page);
    await page.setViewportSize({ width: 1280, height: 1200 });

    // --- Scan History tab (default "Host Scan" tab shows history card) ---
    await page.locator('table[aria-label="Scan history"]').waitFor({ timeout: 15000 });
    await page.screenshot({ path: SHOTS + 'investigate-scan-history-before.png', fullPage: true });
    await inspect(page, 'table[aria-label="Scan history"]', 'ScanHistory');

    // --- Tailoring tab ---
    await page.locator('button[role="tab"]', { hasText: 'Policy Tailoring' }).click();
    await page.locator('table[aria-label="Saved tailoring policies"]').waitFor({ timeout: 15000 });
    await page.screenshot({ path: SHOTS + 'investigate-tailoring-before.png', fullPage: true });
    await inspect(page, 'table[aria-label="Saved tailoring policies"]', 'TailoringList');
});
