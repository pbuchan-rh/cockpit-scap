// Ad-hoc repro script for Bug 3: "View Compliance Guide" / "Download Remediation"
// button hangs on Scan Setup when a STIG-based tailoring policy is selected.
// Not a real spec — no assertions, just console.log + screenshots to settle
// whether this is "slow but completes" vs "genuinely hung".
const { chromium } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await loginToCockpit(page);

    // Select the STIG tailoring policy in the Tailoring policy dropdown
    await page.locator('#ct-scap-tailoring-select').waitFor({ timeout: 15000 });
    await page.selectOption('#ct-scap-tailoring-select', { label: 'STIG - Dev Server Exceptions' });
    console.log('Selected tailoring policy: STIG - Dev Server Exceptions');

    await page.screenshot({ path: 'tests/adhoc/screenshots/bug3-before-click.png' });

    const newPagePopup = page.waitForEvent('popup', { timeout: 90000 }).catch(() => null);

    const start = Date.now();
    await page.locator('button:has-text("View Compliance Guide")').click();
    console.log('Clicked View Compliance Guide at t=0');

    const newPage = await newPagePopup;
    console.log(`Popup opened at t=${Date.now() - start}ms (about:blank synchronous open, per CSP/report-viewer pattern)`);

    let resolved = false;
    if (newPage) {
        // Poll the popup's own content length until it stops being about:blank
        // and stabilizes (real navigation to the blob URL with the guide HTML).
        for (let i = 0; i < 90; i++) {
            await page.waitForTimeout(1000);
            const info = await newPage.evaluate(() => ({
                url: location.href.slice(0, 40),
                len: document.documentElement.outerHTML.length,
            })).catch(() => null);
            if (info && info.url !== 'about:blank' && info.len > 1000) {
                resolved = true;
                console.log(`Guide content loaded at t=${Date.now() - start}ms — url=${info.url} contentLength=${info.len}`);
                break;
            }
            if (i % 5 === 0) console.log(`...still waiting at t=${Date.now() - start}ms (url=${info?.url}, len=${info?.len})`);
        }
    }

    // Also confirm the setup-screen button itself cleared its loading state.
    const buttonStillLoading = await page.locator('button:has-text("View Compliance Guide")')
            .evaluate(el => el.classList.contains('pf-m-in-progress'))
            .catch(() => 'unknown');
    console.log(`Button still shows loading spinner: ${buttonStillLoading}`);

    if (!resolved) {
        console.log(`NOT RESOLVED after ${Date.now() - start}ms — treating as hung`);
    }

    await page.screenshot({ path: 'tests/adhoc/screenshots/bug3-after-wait.png' });
    await browser.close();
    process.exit(resolved ? 0 : 1);
})();
