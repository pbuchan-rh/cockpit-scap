// Ad-hoc probe: uncaught page errors (with stacks) on the module, both tabs.
const { test } = require('@playwright/test');
const { openModuleInShell } = require('../helpers/cockpit');
test('pageerror probe', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', err => console.log('PAGEERROR', JSON.stringify({ name: err.name, message: err.message, stack: err.stack })));
    page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()) });
    const frame = await openModuleInShell(page);
    await page.waitForTimeout(4000);
    await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
    await page.waitForTimeout(3000);
    await page.close();
});
