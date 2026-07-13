// Adhoc verification for the disk-usage-indicators feature
// (feat/disk-usage-indicators). Confirms the "Total disk used by ..."
// line renders on both Scan History and Policy Tailoring tables, with a
// real (non-placeholder) size, and that the number updates after a Delete
// in each table — without a full page reload.
const { test, expect } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const SHOTS = 'tests/adhoc/screenshots/';

test('disk usage indicators: render + update after delete', async ({ page }) => {
    test.setTimeout(120000);
    page.on('pageerror', err => console.log('[pageerror]', err.message));

    await loginToCockpit(page);
    await page.setViewportSize({ width: 1280, height: 1200 });

    // --- Scan History tab (default) ---
    const historyTitle = page.locator('.pf-v6-c-title', { hasText: 'Scan History' });
    await historyTitle.waitFor({ timeout: 15000 });

    // PatternFly Tabs keeps both tab panels mounted (hidden via CSS, not
    // unmounted), so both '.ct-disk-usage-total' paragraphs exist in the DOM
    // at once — scope by wording (unique per tab) rather than by class alone.
    // This also survives the table unmounting into EmptyState after the last
    // row is deleted (a table-sibling xpath would not).
    const historyTotal = page.locator('p.ct-disk-usage-total', { hasText: 'Total disk used by scan history' });
    await expect(historyTotal).toBeVisible({ timeout: 15000 });
    const historyTextBefore = await historyTotal.textContent();
    console.log('Scan history total (before delete):', historyTextBefore);
    expect(historyTextBefore).toMatch(/Total disk used by scan history: \S+/);
    expect(historyTextBefore).not.toContain('—');
    await page.screenshot({ path: SHOTS + 'disk-usage-01-scan-history.png', fullPage: true });

    // --- Policy Tailoring tab ---
    await page.locator('button[role="tab"]', { hasText: 'Policy Tailoring' }).click();
    const tailoringTitle = page.locator('.pf-v6-c-title', { hasText: 'Saved Tailoring Policies' });
    await tailoringTitle.waitFor({ timeout: 15000 });

    const tailoringTotal = page.locator('p.ct-disk-usage-total', { hasText: 'Total disk used by tailoring policies' });
    await expect(tailoringTotal).toBeVisible({ timeout: 15000 });
    const tailoringTextBefore = await tailoringTotal.textContent();
    console.log('Tailoring total (before delete):', tailoringTextBefore);
    expect(tailoringTextBefore).toMatch(/Total disk used by tailoring policies: \S+/);
    expect(tailoringTextBefore).not.toContain('—');
    await page.screenshot({ path: SHOTS + 'disk-usage-02-tailoring.png', fullPage: true });

    // --- Delete the tailoring policy, confirm total updates ---
    const tailoringRow = page.locator('table[aria-label="Saved tailoring policies"] tbody tr').first();
    await tailoringRow.locator('button', { hasText: 'Delete' }).click();
    const tailoringDeleteModal = page.locator('.pf-v6-c-modal-box', { hasText: 'Delete Policy' });
    await expect(tailoringDeleteModal).toBeVisible({ timeout: 5000 });
    await tailoringDeleteModal.locator('button', { hasText: 'Delete' }).click();
    await expect(tailoringDeleteModal).toBeHidden({ timeout: 10000 });

    await expect(async () => {
        const t = await tailoringTotal.textContent();
        expect(t).not.toBe(tailoringTextBefore);
    }).toPass({ timeout: 15000 });
    const tailoringTextAfter = await tailoringTotal.textContent();
    console.log('Tailoring total (after delete):', tailoringTextAfter);
    await page.screenshot({ path: SHOTS + 'disk-usage-03-tailoring-after-delete.png', fullPage: true });

    // --- Delete the scan, confirm total updates ---
    await page.locator('button[role="tab"]', { hasText: 'Host Scan' }).click();
    await historyTitle.waitFor({ timeout: 15000 });
    const historyRow = page.locator('table[aria-label="Scan history"] tbody tr').first();
    await historyRow.locator('button', { hasText: 'Delete' }).click();
    const historyDeleteModal = page.locator('.pf-v6-c-modal-box', { hasText: 'Delete Scan' });
    await expect(historyDeleteModal).toBeVisible({ timeout: 5000 });
    await historyDeleteModal.locator('button', { hasText: 'Delete' }).click();
    await expect(historyDeleteModal).toBeHidden({ timeout: 10000 });

    await expect(async () => {
        const t = await historyTotal.textContent();
        expect(t).not.toBe(historyTextBefore);
    }).toPass({ timeout: 15000 });
    const historyTextAfter = await historyTotal.textContent();
    console.log('Scan history total (after delete):', historyTextAfter);
    await page.screenshot({ path: SHOTS + 'disk-usage-04-scan-history-after-delete.png', fullPage: true });

    console.log('All disk usage indicator checks passed.');
});
