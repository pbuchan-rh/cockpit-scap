// Ad-hoc repro: full RHEL10 STIG profile (1059 rules), no tailoring file —
// the largest-possible case, to rule out tailoring-file overhead specifically.
const { chromium } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await loginToCockpit(page);

    await page.locator('#ct-scap-profile').waitFor({ timeout: 15000 });
    await page.selectOption('#ct-scap-profile', { label: 'Red Hat STIG for Red Hat Enterprise Linux 10' });
    console.log('Selected profile: Red Hat STIG for Red Hat Enterprise Linux 10 (no tailoring)');

    const newPagePopup = page.waitForEvent('popup', { timeout: 90000 }).catch(() => null);
    const start = Date.now();
    await page.locator('button:has-text("View Compliance Guide")').click();
    console.log('Clicked View Compliance Guide at t=0');

    const newPage = await newPagePopup;
    console.log(`Popup opened at t=${Date.now() - start}ms`);

    let resolved = false;
    if (newPage) {
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
    if (!resolved) console.log(`NOT RESOLVED after ${Date.now() - start}ms — treating as hung`);

    await browser.close();
    process.exit(resolved ? 0 : 1);
})();
