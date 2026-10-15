// V4.6 CHECKPOINT: the dev copy loads inside the Cockpit shell next to the
// RPM's /scap, with its sidebar label, PF default text weight and the
// native white page container with outlined cards; the RPM page itself
// still loads.
const { test, expect } = require('@playwright/test');
const { openModuleInShell } = require('./helpers/cockpit');

const COPIES = [
    { path: '/scap-dev', label: 'SCAP Security (dev)' },
];

for (const c of COPIES) {
    test(`${c.path} loads in the shell with label "${c.label}"`, async ({ page }) => {
        const frame = await openModuleInShell(page, c.path);
        await expect(page.locator('#host-apps').getByRole('link', { name: c.label, exact: true })).toBeVisible();
        await expect(frame.getByRole('button', { name: 'Run Scan' })).toBeVisible();
        const m = await frame.evaluate(() => ({
            size: getComputedStyle(document.body).fontSize,
            container: getComputedStyle(document.querySelector('.pf-v6-c-page__main-container')).backgroundColor,
            card: getComputedStyle(document.querySelector('.pf-v6-c-card'), '::before').borderTopColor,
        }));
        expect(m.size).toBe('14px');
        expect(m.container).not.toBe('rgba(0, 0, 0, 0)');
        expect(m.card).not.toBe('rgba(0, 0, 0, 0)');
    });
}

test('the RPM page /scap still loads next to them', async ({ page }) => {
    const frame = await openModuleInShell(page, '/scap');
    await expect(page.locator('#host-apps').getByRole('link', { name: 'SCAP Security', exact: true })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Run Scan' })).toBeVisible();
});
