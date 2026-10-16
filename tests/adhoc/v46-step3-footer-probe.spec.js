// Ad-hoc probe: ::before/::after of the disabled setup footer buttons.
const { test } = require('@playwright/test');
const { openModuleInShell } = require('../helpers/cockpit');
test('footer probe', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const frame = await openModuleInShell(page);
    await frame.locator('#ct-scan-other-content').click();
    await frame.getByRole('menuitem', { name: /Enter a path/ }).click();
    await frame.locator('input#ct-scap-content').fill('/usr/shar');
    await frame.locator('input#ct-scap-content').press('Enter');
    await page.waitForTimeout(1500);
    console.log(JSON.stringify(await frame.evaluate(() => [...document.querySelectorAll('.ct-setup-footer button, .ct-setup-footer .pf-v6-c-menu-toggle')].map(el => {
        const o = { cls: el.className };
        for (const ps of ['', '::before', '::after']) {
            const cs = getComputedStyle(el, ps || null);
            o[ps || 'el'] = [cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor, cs.backgroundColor, cs.content].join(' | ');
        }
        return o;
    })), null, 1));
    await page.close();
});
