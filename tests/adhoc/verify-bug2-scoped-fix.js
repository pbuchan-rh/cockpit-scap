// Verify the corrected Bug 2 fix (generateScopedFix, ephemeral standalone
// tailoring profile) actually scopes to a single rule now — reopens the
// STIG scan already saved a few minutes ago (2026-07-14 20:44:49), expands
// a failing-rule group, opens the per-rule Fix preview, and checks its size
// is small (single-rule) rather than ~1.9MB (whole 1059-rule profile, the
// bug this replaces).
const { chromium } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await loginToCockpit(page);

    await page.locator('table').first().waitFor({ timeout: 15000 });
    const row = page.locator('tr', { hasText: '2026-07-14 20:44' });
    await row.locator('button:has-text("View report"), a:has-text("View report")').first().click();
    await page.waitForTimeout(1500);

    const firstGroupToggle = page.locator('.pf-v6-c-expandable-section__toggle').first();
    await firstGroupToggle.click();
    await page.waitForTimeout(500);

    const fixLink = page.locator('.ct-rule-row button:has-text("Fix")').first();
    const ruleTitle = await page.locator('.ct-rule-row').first().locator('.ct-rule-title').innerText();
    console.log('Testing per-rule Fix for:', ruleTitle);

    await fixLink.click();
    await page.waitForTimeout(4000);
    const preText = await page.locator('.ct-rule-rem-pre').first().innerText().catch(() => null);
    const beginFixCount = preText ? (preText.match(/BEGIN fix/g) || []).length : 0;
    console.log('Fix preview length:', preText ? preText.length : 'none');
    console.log('Number of "BEGIN fix" blocks in preview (expect 1, not ~1059):', beginFixCount);

    await page.screenshot({ path: 'tests/adhoc/screenshots/bug2-scoped-fix-preview.png', fullPage: true });

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await page.locator('button:has-text("Download .sh")').first().click();
    const download = await downloadPromise;
    console.log('Per-rule download fired:', download ? download.suggestedFilename() : 'NONE');

    await browser.close();
    process.exit(beginFixCount === 1 ? 0 : 1);
})();
