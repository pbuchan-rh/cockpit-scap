// Verify bulk fix download is scoped to only the *selected* rules (not the
// whole profile) — deselect all, pick 2 specific rules, download, and check
// the resulting script has exactly 2 "BEGIN fix" blocks.
const { chromium } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ ignoreHTTPSErrors: true, acceptDownloads: true });
    await loginToCockpit(page);

    await page.locator('table').first().waitFor({ timeout: 15000 });
    const row = page.locator('tr', { hasText: '2026-07-14 20:44' });
    await row.locator('button:has-text("View report"), a:has-text("View report")').first().click();
    await page.waitForTimeout(1500);

    await page.locator('button:has-text("Deselect All")').click();
    await page.locator('.pf-v6-c-expandable-section__toggle').first().click();
    await page.waitForTimeout(500);

    const checkboxes = page.locator('.ct-rule-row input[type="checkbox"]');
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();
    console.log('Selected 2 rules for bulk download');

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.locator('button:has-text("Download Bash Fix")').click();
    const download = await downloadPromise;
    const path = await download.path();
    const content = fs.readFileSync(path, 'utf8');
    const beginFixCount = (content.match(/BEGIN fix/g) || []).length;
    console.log(`Bulk-download fix script has ${beginFixCount} "BEGIN fix" blocks (expect 2, selected 2 rules)`);

    await browser.close();
    process.exit(beginFixCount === 2 ? 0 : 1);
})();
