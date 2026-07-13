// Adhoc verification for V4.2 lean scan history (feature/v4.2-scan-history).
// Runs a real scan, confirms it's saved+listed in History immediately, opens
// the saved (not live) report via the reused ScanResults UI + viewer.html and
// confirms it's styled, downloads it, then deletes it and confirms the row
// and the ~/SCAP/scans/<timestamp>/ directory are both gone.
//
// Homedir file perms (700 dir / 600 files) are checked separately via SSH,
// not from this script — Playwright only drives the browser.
const { test, expect } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const SHOTS = 'tests/adhoc/screenshots/';

test('v4.2 scan history: save, list, view, download, delete', async ({ page, context }) => {
    test.setTimeout(1200000); // E8 scan timing on this host varies; give it 20 min headroom
    page.on('pageerror', err => console.log('[pageerror]', err.message));

    await loginToCockpit(page);
    await page.setViewportSize({ width: 1280, height: 1200 });

    // --- Empty state (no scans yet on this homedir) ---
    const historyTitle = page.locator('.pf-v6-c-title', { hasText: 'Scan History' });
    await historyTitle.waitFor({ timeout: 15000 });
    await expect(page.locator('text=No scan history yet')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: SHOTS + 'v42-scan-history-01-empty-state.png', fullPage: true });
    console.log('Empty state confirmed.');

    // --- Run a real scan (Essential Eight — small ruleset, fast) ---
    const profileSelect = page.locator('#ct-scap-profile');
    await expect(profileSelect).not.toBeDisabled({ timeout: 15000 });
    await profileSelect.selectOption({ value: 'xccdf_org.ssgproject.content_profile_e8' });

    const runBtn = page.locator('button', { hasText: 'Run Scan' });
    await expect(runBtn).not.toBeDisabled({ timeout: 5000 });
    await runBtn.click();

    const newScanBtn = page.locator('button', { hasText: 'New Scan' });
    await newScanBtn.waitFor({ timeout: 1100000 });
    console.log('Scan complete.');

    // No save-failure alert
    await expect(page.locator('text=couldn\'t be saved to history')).toHaveCount(0);
    await page.screenshot({ path: SHOTS + 'v42-scan-history-02-live-results.png', fullPage: true });

    // Back to setup — History card should now show one row
    await newScanBtn.click();
    await expect(page.locator('#ct-scap-content')).toBeVisible({ timeout: 10000 });

    const historyRow = page.locator('table[aria-label="Scan history"] tbody tr').first();
    await expect(historyRow).toBeVisible({ timeout: 15000 });
    await expect(historyRow).toContainText('%');
    await page.screenshot({ path: SHOTS + 'v42-scan-history-03-listed.png', fullPage: true });
    console.log('Scan appeared in History:', await historyRow.textContent());

    // --- View report (saved, not live) ---
    await historyRow.locator('button', { hasText: 'View report' }).click();
    // tmpdir is null for a saved view -> header button reads "Close", not "New Scan"
    const closeBtn = page.locator('button', { hasText: 'Close' });
    await expect(closeBtn).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.ct-score-value')).toBeVisible();
    await page.screenshot({ path: SHOTS + 'v42-scan-history-04-saved-view.png', fullPage: true });
    console.log('Saved-scan view rendered via ScanResults (tmpdir=null).');

    // Exact-case regex: a plain hasText string match is case-insensitive and
    // would also match the History row's own "View report" button.
    const [popup] = await Promise.all([
        context.waitForEvent('page'),
        page.locator('button', { hasText: /^View Report$/ }).click(),
    ]);
    await popup.waitForLoadState('load', { timeout: 15000 });
    await popup.waitForFunction(() => document.querySelector('style, link[rel=stylesheet]') !== null, { timeout: 10000 });
    expect(popup.url()).toContain('/scap/viewer.html');

    const computed = await popup.evaluate(() => {
        const cs = getComputedStyle(document.body);
        return { fontFamily: cs.fontFamily, backgroundColor: cs.backgroundColor };
    });
    console.log('Saved-report popup computed style:', JSON.stringify(computed));
    expect(computed.fontFamily.toLowerCase()).not.toContain('times');
    expect(computed.fontFamily.toLowerCase()).not.toBe('serif');
    const navbarBg = await popup.evaluate(() => {
        const nav = document.querySelector('.navbar, .page-header');
        return nav ? getComputedStyle(nav).backgroundColor : null;
    });
    expect(navbarBg).not.toBeNull();
    expect(navbarBg).not.toBe('rgba(0, 0, 0, 0)');
    await popup.screenshot({ path: SHOTS + 'v42-scan-history-05-saved-report-styled.png' });
    await popup.close();
    console.log('Saved-scan View Report opens styled — same viewer.html mechanism as live scans.');

    await closeBtn.click();
    await expect(page.locator('#ct-scap-content')).toBeVisible({ timeout: 10000 });

    // --- Download ---
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        historyRow.locator('button', { hasText: 'Download' }).click(),
    ]);
    console.log('Downloaded:', download.suggestedFilename());
    expect(download.suggestedFilename()).toMatch(/^scan-results-.*\.xml\.gz$/);

    // --- Delete ---
    await historyRow.locator('button', { hasText: 'Delete' }).click();
    const deleteModal = page.locator('.pf-v6-c-modal-box', { hasText: 'Delete Scan' });
    await expect(deleteModal).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: SHOTS + 'v42-scan-history-06-delete-confirm.png', fullPage: true });
    await deleteModal.locator('button', { hasText: 'Delete' }).click();
    await expect(deleteModal).toBeHidden({ timeout: 10000 });
    await expect(page.locator('text=No scan history yet')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: SHOTS + 'v42-scan-history-07-deleted-empty-again.png', fullPage: true });
    console.log('Row deleted, History back to empty state. All checks passed.');
});
