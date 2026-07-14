const { test } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

test('inspect Manage uploaded content link text/codepoints', async ({ page }) => {
    await loginToCockpit(page);
    await page.locator('#ct-scap-content').waitFor({ timeout: 15000 });
    const link = page.locator('button', { hasText: 'Manage uploaded content' });
    const text = await link.textContent();
    console.log('Raw textContent:', JSON.stringify(text));
    console.log('Char codes:', [...text].map(c => c.codePointAt(0).toString(16)));
    const box = await link.boundingBox();
    console.log('Bounding box:', JSON.stringify(box));
    await page.screenshot({ path: 'tests/adhoc/screenshots/dogfood-2026-07-14/zz-arrow-check.png', clip: { x: Math.max(0, box.x - 20), y: Math.max(0, box.y - 10), width: box.width + 40, height: box.height + 20 } });
});
