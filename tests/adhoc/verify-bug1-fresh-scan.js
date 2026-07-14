// End-to-end verification of Bug 1 + Bug 2: run a real live scan against the
// STIG "Dev Server Exceptions" tailoring, let it save to history, then close
// and reopen it from Scan History — confirming CCE tags, Automated/Manual
// badges, and per-rule Fix links now render (Bug 1), and that per-rule Fix
// generation actually works from that saved view (Bug 2).
const { chromium } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await loginToCockpit(page);

    await page.locator('#ct-scap-tailoring-select').waitFor({ timeout: 15000 });
    await page.selectOption('#ct-scap-tailoring-select', { label: 'STIG - Dev Server Exceptions' });
    console.log('Selected STIG - Dev Server Exceptions tailoring, starting scan...');

    const start = Date.now();
    await page.locator('button:has-text("Run Scan")').click();

    // Full STIG eval measured ~4m30s via CLI; give it 10 minutes headroom.
    await page.locator('text=Scan Complete').waitFor({ timeout: 600000 });
    console.log(`Scan completed at t=${Math.round((Date.now() - start) / 1000)}s`);

    await page.screenshot({ path: 'tests/adhoc/screenshots/bug1-fresh-live-results.png', fullPage: true });

    // Close the live results view, then reopen the same scan from history.
    await page.locator('button:has-text("Close"), button:has-text("New Scan")').click();
    await page.waitForTimeout(1500);

    await page.locator('table').first().waitFor({ timeout: 15000 });
    const rows = page.locator('tbody tr');
    const firstRowText = await rows.first().innerText();
    console.log('Opening most recent scan history row:', firstRowText.split('\n')[0]);
    await rows.first().locator('button:has-text("View report"), a:has-text("View report")').first().click();
    await page.waitForTimeout(2000);

    const cceCount = await page.locator('.ct-rule-cce').count();
    const badgeCount = await page.locator('.pf-v6-c-label:has-text("Automated"), .pf-v6-c-label:has-text("Manual")').count();
    const fixButtonCount = await page.locator('button:has-text("Fix")').count();
    console.log(`CCE tags rendered: ${cceCount} (expect > 0)`);
    console.log(`Automated/Manual badges rendered: ${badgeCount} (expect > 0)`);
    console.log(`Per-rule Fix toggle buttons rendered: ${fixButtonCount} (expect > 0, includes bulk buttons too)`);

    await page.screenshot({ path: 'tests/adhoc/screenshots/bug1-saved-scan-detail.png', fullPage: true });

    // Expand the first group and try a per-rule Fix toggle + download.
    const firstGroupToggle = page.locator('.pf-v6-c-expandable-section__toggle').first();
    await firstGroupToggle.click();
    await page.waitForTimeout(500);

    const fixLink = page.locator('.ct-rule-row button:has-text("Fix")').first();
    const hasFixLink = await fixLink.isVisible().catch(() => false);
    console.log('First-group per-rule Fix link visible:', hasFixLink);
    if (hasFixLink) {
        await fixLink.click();
        await page.waitForTimeout(3000);
        const preText = await page.locator('.ct-rule-rem-pre').first().innerText().catch(() => null);
        console.log('Fix preview rendered, length:', preText ? preText.length : 'none');
        await page.screenshot({ path: 'tests/adhoc/screenshots/bug2-saved-scan-rule-fix.png', fullPage: true });
    }

    await browser.close();
    process.exit(0);
})();
