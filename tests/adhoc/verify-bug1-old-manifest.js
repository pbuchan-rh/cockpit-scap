// Verify Bug 1's backward-compat path: an old-format saved scan (no
// rule_meta/base_profile_id/tailoring_path keys) should still open from
// history without throwing, degrading to no CCE/badges/Fix links (same as
// before this fix) rather than crashing.
const { chromium } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));
    await loginToCockpit(page);

    await page.locator('table').first().waitFor({ timeout: 15000 });
    // Click "View report" on the oldest scan (CIS profile, no tailoring, no rule_meta)
    const row = page.locator('tr', { hasText: '2026-07-14 18:33:17' });
    await row.locator('button:has-text("View report"), a:has-text("View report")').first().click();

    await page.waitForTimeout(3000);
    console.log('Page errors during old-manifest view:', JSON.stringify(pageErrors));

    const failingRulesCard = page.locator('text=Failing Rules');
    const cardVisible = await failingRulesCard.first().isVisible().catch(() => false);
    console.log('Failing Rules card visible:', cardVisible);

    // With no rule_meta, no CCE code elements and no "Fix" toggle should render
    const cceCount = await page.locator('.ct-rule-cce').count();
    const fixLinkCount = await page.locator('button:has-text("Fix")').count();
    console.log(`CCE tags rendered: ${cceCount} (expect 0 for old manifest)`);
    console.log(`Fix links rendered: ${fixLinkCount} (expect 0 for old manifest, no rule_meta.automated)`);

    await page.screenshot({ path: 'tests/adhoc/screenshots/bug1-old-manifest.png', fullPage: true });
    await browser.close();
    process.exit(pageErrors.length === 0 ? 0 : 1);
})();
