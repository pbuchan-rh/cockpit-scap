// UAT batch 1, U3: typing a content path by hand is gone (Peter: no dead
// code left behind); content comes from the detected list or an upload.
// INSIDE the Cockpit shell (/scap-dev), both browser projects. Read only.
const { test, expect } = require('@playwright/test');
const { openModuleInShell } = require('./helpers/cockpit');

test.describe.configure({ mode: 'serial' });

let page, frame;
const SHOTS = 'tests/test-results/uat1';

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    await expect(frame.locator('#ct-scap-content')).toBeVisible({ timeout: 30000 });
});
test.afterAll(async () => { await page?.close() });

const menuItems = async () => (await frame.getByRole('menuitem').allInnerTexts()).map(t => t.split('\n')[0].trim());

for (const [tab, toggleId, contentId] of [
    ['Host Scan', '#ct-scan-other-content', '#ct-scap-content'],
    ['Policy Tailoring', '#ct-tailor-other-content', '#ct-tailor-content-select'],
]) {
    test(`${tab}: "Other content" offers Upload and Manage only; no path field`, async ({ browserName }) => {
        await frame.getByRole('tab', { name: tab }).click();
        const group = frame.locator('.pf-v6-c-form__group').filter({ has: frame.locator(contentId) });
        // (The hidden file input of Upload content is fine.)
        await expect(group.locator('input:not([type="file"])')).toHaveCount(0);
        await expect(frame.locator(`input${contentId}`)).toHaveCount(0);

        const toggle = frame.locator(toggleId);
        await toggle.click();
        expect(await menuItems()).toEqual(['Upload content…', 'Manage content']);
        for (const gone of ['Enter a path…', 'Use detected content'])
            await expect(frame.getByRole('menuitem', { name: gone })).toHaveCount(0);
        const slug = tab === 'Host Scan' ? 'scan' : 'tailor';
        await page.screenshot({ path: `${SHOTS}/u3-${slug}-other-content-${browserName}.png` });
        await page.keyboard.press('Escape');

        await frame.locator(contentId).click();
        await expect(frame.locator('.pf-v6-c-menu [role="listbox"]').first()).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/u3-${slug}-content-picker-${browserName}.png` });
        await page.keyboard.press('Escape');
    });
}
