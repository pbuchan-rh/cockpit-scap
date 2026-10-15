// Ad-hoc: is the editor's action bar sticky? Prints its top before and
// after scrolling the page's scroll container, and the scroll container.
const { test } = require('@playwright/test');
const { openModuleInShell } = require('../helpers/cockpit');
const S = require('../helpers/scap');

test('sticky probe', async ({ browser, browserName }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const frame = await openModuleInShell(page);
    await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
    await frame.locator('#ct-tailor-content-select').selectOption(S.DS);
    await frame.locator('#ct-tailor-profile-select').selectOption(S.PROFILE_L1);
    await frame.getByRole('button', { name: 'Load Rules' }).click();
    const bar = frame.locator('[data-ct-tailor-actionbar]');
    await bar.waitFor({ timeout: 120000 });
    const top = () => bar.evaluate(el => Math.round(el.getBoundingClientRect().top));
    console.log('before', await top());
    await frame.evaluate(() => { document.querySelector('.pf-v6-c-page__main').scrollTop = 1500 });
    await page.waitForTimeout(500);
    console.log('after programmatic scroll', await top(), await frame.evaluate(() => document.querySelector('.pf-v6-c-page__main').scrollTop));
    await page.mouse.move(800, 500);
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(800);
    console.log('after wheel', await top(), await frame.evaluate(() => document.querySelector('.pf-v6-c-page__main').scrollTop));
    await page.screenshot({ path: `tests/test-results/v46-phase4/sticky-probe-${browserName}.png` });
});
