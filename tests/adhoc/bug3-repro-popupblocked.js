// Ad-hoc verification: simulate a real browser popup blocker (window.open
// returns null) and confirm the new error alert appears instead of a silent
// no-op — this is the alternate root cause for "spins and does nothing"
// found via code review of reportViewer.js, since the timing hypothesis
// didn't reproduce (see bug3-repro.js / bug3-repro-notailoring.js).
const { chromium } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    page.on('console', msg => console.log('  [console]', msg.text()));
    page.on('pageerror', err => console.log('  [pageerror]', err.message));
    await loginToCockpit(page);

    // Force window.open to behave like a blocked popup.
    await page.evaluate(() => { window.open = () => null; });

    await page.locator('#ct-scap-tailoring-select').waitFor({ timeout: 15000 });
    await page.selectOption('#ct-scap-tailoring-select', { label: 'STIG - Dev Server Exceptions' });
    await page.waitForTimeout(1000);

    const guideButton = page.locator('button:has-text("View Compliance Guide")');
    console.log('Button disabled before click:', await guideButton.isDisabled());

    const start = Date.now();
    await guideButton.click({ force: true });
    console.log('Clicked View Compliance Guide (window.open forced to return null)');

    for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(1000);
        const spinning = await guideButton.evaluate(el => !!el.querySelector('.pf-v6-c-spinner')).catch(() => 'err');
        console.log(`t=${Date.now() - start}ms spinning=${spinning}`);
    }
    console.log('Pages open (should be 1 if popup truly blocked):', page.context().pages().length);
    const allAlerts = await page.locator('.pf-v6-c-alert').allInnerTexts();
    console.log('All alerts on page:', JSON.stringify(allAlerts));
    const seen = allAlerts.some(t => t.toLowerCase().includes('blocked'));
    console.log(`Error alert shown: ${seen} at t=${Date.now() - start}ms`);

    await page.screenshot({ path: 'tests/adhoc/screenshots/bug3-popup-blocked.png' });
    await browser.close();
    process.exit(seen ? 0 : 1);
})();
