// Verification for fix/card-title-divider:
// Old main's .pf-v6-c-card__title had a border-bottom separating the title
// from the card body; the rewrite dropped it. Confirm the restored divider
// (src/app.scss) renders on multiple cards.
const { test, expect } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const SHOTS = 'tests/adhoc/screenshots/';

test('card title divider present under headings', async ({ page }) => {
    page.on('pageerror', err => console.log('[pageerror]', err.message));
    await loginToCockpit(page);
    await page.setViewportSize({ width: 1280, height: 1400 });

    // --- Host Scan setup card ---
    const scanCard = page.locator('.pf-v6-c-card', { hasText: 'SCAP Security Scan' }).first();
    await scanCard.waitFor({ timeout: 15000 });
    const scanTitle = scanCard.locator('.pf-v6-c-card__title').first();
    await scanTitle.waitFor({ timeout: 10000 });
    const scanBorder = await scanTitle.evaluate(el => getComputedStyle(el).borderBottom);
    console.log('Host Scan card title border-bottom:', scanBorder);
    expect(scanBorder).not.toMatch(/^0px/);
    await scanCard.screenshot({ path: SHOTS + 'card-title-divider-scan-setup.png' });

    // --- Scan History card ---
    const historyCard = page.locator('.pf-v6-c-card', { hasText: 'Scan History' }).first();
    await historyCard.waitFor({ timeout: 15000 });
    const historyTitle = historyCard.locator('.pf-v6-c-card__title').first();
    await historyTitle.waitFor({ timeout: 10000 });
    const historyBorder = await historyTitle.evaluate(el => getComputedStyle(el).borderBottom);
    console.log('Scan History card title border-bottom:', historyBorder);
    expect(historyBorder).not.toMatch(/^0px/);
    await historyCard.screenshot({ path: SHOTS + 'card-title-divider-scan-history.png' });

    await page.screenshot({ path: SHOTS + 'card-title-divider-fullpage.png', fullPage: true });
});
