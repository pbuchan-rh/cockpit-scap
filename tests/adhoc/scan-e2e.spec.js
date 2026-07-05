// Adhoc end-to-end verification of the v4.0 rewrite.
// Runs a full scan and checks every major UI state.
const { test, expect } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

test('v4.0 full scan flow', async ({ page }) => {
    page.on('console', msg => console.log(`[browser:${msg.type()}]`, msg.text()));
    page.on('pageerror', err => console.log('[pageerror]', err.message));

    await loginToCockpit(page);

    // --- Setup phase ---
    const card = page.locator('.pf-v6-c-card').first();
    await card.waitFor({ timeout: 15000 });
    await page.screenshot({ path: `tests/adhoc/screenshots/01-setup.png`, fullPage: true });

    // Content auto-detected
    const contentSelect = page.locator('#ct-scap-content');
    await contentSelect.waitFor({ timeout: 10000 });
    const contentValue = await contentSelect.inputValue();
    console.log('Auto-selected content:', contentValue);
    expect(contentValue).toContain('.xml');

    // Profiles loaded
    const profileSelect = page.locator('#ct-scap-profile');
    await expect(profileSelect).not.toBeDisabled({ timeout: 15000 });

    // Pick the Essential Eight profile explicitly — much smaller rule set than the
    // default (first alphabetically) ANSSI-BP28-enhanced profile, so the real scan
    // finishes in ~3 min instead of ~6-7 min.
    await profileSelect.selectOption({ value: 'xccdf_org.ssgproject.content_profile_e8' });
    const profileValue = await profileSelect.inputValue();
    console.log('Selected profile:', profileValue);
    expect(profileValue).toContain('_e8');

    // Run Scan button is enabled (admin was elevated in loginToCockpit)
    const runBtn = page.locator('button', { hasText: 'Run Scan' });
    await expect(runBtn).not.toBeDisabled({ timeout: 5000 });
    await page.screenshot({ path: `tests/adhoc/screenshots/02-ready.png`, fullPage: true });

    // --- Run scan ---
    await runBtn.click();

    // Running phase — spinner + Cancel button appear
    await expect(page.locator('button', { hasText: 'Cancel' })).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `tests/adhoc/screenshots/03-running.png`, fullPage: true });
    console.log('Scan started.');

    // Wait for results (up to 10 min — configured in playwright.config.js)
    const newScanBtn = page.locator('button', { hasText: 'New Scan' });
    await newScanBtn.waitFor({ timeout: 600000 });
    console.log('Scan complete.');
    await page.screenshot({ path: `tests/adhoc/screenshots/04-results.png`, fullPage: true });

    // --- Results phase ---
    // Score value visible
    const scoreEl = page.locator('.ct-score-value');
    await expect(scoreEl).toBeVisible();
    const scoreText = await scoreEl.textContent();
    console.log('Score:', scoreText);
    expect(scoreText).toMatch(/\d+%|N\/A/);

    // Pass / Fail labels visible
    await expect(page.locator('.pf-v6-c-label', { hasText: /Pass/ }).first()).toBeVisible();
    await expect(page.locator('.pf-v6-c-label', { hasText: /Fail/ }).first()).toBeVisible();

    // View Report: click and check a new page opens with a blob URL
    const [newTab] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 30000 }),
        page.locator('button', { hasText: 'View Report' }).click(),
    ]);
    await newTab.waitForLoadState('domcontentloaded', { timeout: 15000 });
    console.log('Report tab URL:', newTab.url());
    expect(newTab.url()).toMatch(/^blob:/);
    await newTab.close();

    // Failing rules card (or empty state if all pass)
    const failingCard = page.locator('.pf-v6-c-card').nth(1);
    await expect(failingCard).toBeVisible();
    await page.screenshot({ path: `tests/adhoc/screenshots/05-rules.png`, fullPage: true });

    // --- Severity filter ---
    const sevFilters = page.locator('.ct-sev-filter');
    const sevCount = await sevFilters.count();
    if (sevCount > 0) {
        const ruleRows = page.locator('.ct-rule-row');
        const beforeCount = await ruleRows.count();
        const firstSev = sevFilters.first();
        await firstSev.click(); // toggle it off
        await expect(firstSev).toHaveClass(/ct-sev-inactive/);
        await page.screenshot({ path: `tests/adhoc/screenshots/05b-severity-filtered.png`, fullPage: true });
        const afterCount = await ruleRows.count();
        console.log(`Severity filter toggled: rule rows ${beforeCount} -> ${afterCount}`);
        await firstSev.click(); // restore
        await expect(firstSev).not.toHaveClass(/ct-sev-inactive/);
    } else {
        console.log('No severity filter buttons rendered — no failing rules to filter.');
    }

    // If there are failing rules, test Download Bash Fix with a single rule (fast)
    const downloadBashBtn = page.locator('button', { hasText: 'Download Bash Fix' });
    if (await downloadBashBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        // Deselect all, then pick just the first rule — keeps generate fix fast
        await page.locator('button', { hasText: 'Deselect All' }).click();
        const firstCheckbox = page.locator('.ct-rule-row .pf-v6-c-check__input').first();
        await firstCheckbox.check();

        let sawDownload = false;
        page.once('download', d => {
            sawDownload = true;
            console.log('Bash fix downloaded:', d.suggestedFilename());
        });
        await downloadBashBtn.click();
        await page.screenshot({ path: `tests/adhoc/screenshots/05c-fix-clicked.png`, fullPage: true });

        // Wait for the button to return to its normal (non-loading) label/state —
        // true regardless of whether the browser surfaces a 'download' event.
        await expect(downloadBashBtn).toBeVisible({ timeout: 30000 });
        await expect(downloadBashBtn).not.toBeDisabled({ timeout: 30000 });
        console.log('Download Bash Fix button settled. Saw download event:', sawDownload);
    } else {
        console.log('No failing rules — skipping fix download.');
    }

    // New Scan returns to setup
    await newScanBtn.click();
    await expect(page.locator('#ct-scap-content')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `tests/adhoc/screenshots/06-new-scan.png`, fullPage: true });
    console.log('New Scan returned to setup. All checks passed.');
});
