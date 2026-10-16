// Ad-hoc probe (V4.6 step 3): S2 manual content path, before/after the fix.
// Types bad paths, screenshots the form, dumps the footer buttons' computed
// styles. No assertions; read-only on the host.
const { test } = require('@playwright/test');
const { openModuleInShell } = require('../helpers/cockpit');

const OUT = require('path').join(__dirname, '../test-results/v46-step3') + '/';

test('s2 probe', async ({ browser }, info) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const frame = await openModuleInShell(page);
    const tag = (process.env.PROBE_TAG || 'probe') + '-' + info.project.name;
    await frame.locator('#ct-scan-other-content').click();
    await frame.getByRole('menuitem', { name: /Enter a path/ }).click();
    const input = frame.locator('#ct-scap-content');
    for (const p of ['/usr/shar', '/usr/share', '/etc/hosts']) {
        await input.fill(p);
        await input.press('Enter');
        await page.waitForTimeout(2500);
        await page.screenshot({ path: OUT + `${tag}${p.replace(/\//g, '_')}.png` });
        const card = frame.locator('.pf-v6-c-card').first();
        console.log(p, '=>', JSON.stringify(await card.innerText()));
    }
    const styles = await frame.evaluate(() => {
        return [...document.querySelectorAll('.pf-v6-c-card__footer button')].map(b => {
            const cs = getComputedStyle(b);
            return { text: b.innerText, cls: b.className, disabled: b.disabled, aria: b.getAttribute('aria-disabled'), opacity: cs.opacity, color: cs.color, bg: cs.backgroundColor };
        });
    });
    console.log(JSON.stringify(styles, null, 1));
    await page.close();
});
