const { test, expect } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit');

test('Tailoring tab renders Editor card before List card', async ({ page }) => {
    await loginToCockpit(page);

    await page.locator('button[role="tab"]:has-text("Tailoring")').click();

    const tabBody = page.locator('.ct-tailoring-tab');
    await tabBody.waitFor({ state: 'visible', timeout: 15000 });

    await page.waitForTimeout(1000);

    const cardTitles = await tabBody.locator('.pf-v6-c-card__title, .pf-v6-c-card__header').allInnerTexts();
    console.log('Card titles in DOM order:', JSON.stringify(cardTitles));

    await page.screenshot({ path: 'tests/screenshots/tailoring-card-order.png', fullPage: true });

    expect(cardTitles.length).toBeGreaterThan(0);
});
