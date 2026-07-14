// Ad-hoc repro script for Bug 3's "Download Remediation" half — same STIG
// tailoring, but the split-button primary action (bash fix) instead of the
// compliance guide. No assertions, just timing + screenshots.
const { chromium } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await loginToCockpit(page);

    await page.locator('#ct-scap-tailoring-select').waitFor({ timeout: 15000 });
    await page.selectOption('#ct-scap-tailoring-select', { label: 'STIG - Dev Server Exceptions' });
    console.log('Selected tailoring policy: STIG - Dev Server Exceptions');

    const downloadPromise = page.waitForEvent('download', { timeout: 90000 }).catch(() => null);

    const start = Date.now();
    await page.locator('#ct-download-remediation-primary').click();
    console.log('Clicked Download Remediation (bash) at t=0');

    const download = await downloadPromise;
    if (download) {
        console.log(`Download fired at t=${Date.now() - start}ms — suggestedFilename=${download.suggestedFilename()}`);
    } else {
        console.log(`NO DOWNLOAD after ${Date.now() - start}ms — treating as hung/failed`);
    }

    const stillLoading = await page.locator('#ct-download-remediation-primary')
            .evaluate(el => el.classList.contains('pf-m-in-progress') || !!el.querySelector('.pf-v6-c-spinner'))
            .catch(() => 'unknown');
    console.log(`Button still shows loading spinner: ${stillLoading}`);

    await page.screenshot({ path: 'tests/adhoc/screenshots/bug3-fix-after.png' });
    await browser.close();
    process.exit(download ? 0 : 1);
})();
