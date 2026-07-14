// Verify Bug 2 also benefits old saved scans (predating this fix): bulk
// Download Bash Fix should now work from a saved-scan view since it's gated
// on sdsPath (always present) instead of tmpdir (never present for history).
const { chromium } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await loginToCockpit(page);

    await page.locator('table').first().waitFor({ timeout: 15000 });
    const row = page.locator('tr', { hasText: '2026-07-14 18:33:17' });
    await row.locator('button:has-text("View report"), a:has-text("View report")').first().click();
    await page.waitForTimeout(1000);

    const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await page.locator('button:has-text("Download Bash Fix")').click();
    const download = await downloadPromise;
    console.log(download ? `Download fired: ${download.suggestedFilename()}` : 'NO DOWNLOAD — bulk fix failed for old saved scan');

    await browser.close();
    process.exit(download ? 0 : 1);
})();
