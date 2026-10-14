// V4.6 CHECKPOINT: both dev copies load inside the Cockpit shell next to
// the RPM's /scap, with the right sidebar label and text weight, and the
// RPM page itself still loads.
const { test, expect } = require('@playwright/test');
const { openModuleInShell } = require('./helpers/cockpit');

const COPIES = [
    { path: '/scap-dev', label: 'SCAP Security (dev)', heavy: false },
    { path: '/scap-dev-heavy', label: 'SCAP Security (dev, v3 weight)', heavy: true },
];

for (const c of COPIES) {
    test(`${c.path} loads in the shell with label "${c.label}"`, async ({ page }) => {
        const frame = await openModuleInShell(page, c.path);
        await expect(page.locator('#host-apps').getByRole('link', { name: c.label, exact: true })).toBeVisible();
        await expect(frame.getByRole('button', { name: 'Run Scan' })).toBeVisible();
        const m = await frame.evaluate(() => ({
            cls: document.documentElement.className,
            size: getComputedStyle(document.body).fontSize,
            btn: getComputedStyle(document.querySelector('.pf-v6-c-button')).fontWeight,
        }));
        if (c.heavy) {
            expect(m.cls).toContain('ct-weight-v3');
            expect(m.size).toBe('16px');
            expect(Number(m.btn)).toBeGreaterThanOrEqual(700);
        } else {
            expect(m.cls).not.toContain('ct-weight-v3');
            expect(m.size).toBe('14px');
        }
    });
}

test('the RPM page /scap still loads next to them', async ({ page }) => {
    const frame = await openModuleInShell(page, '/scap');
    await expect(page.locator('#host-apps').getByRole('link', { name: 'SCAP Security', exact: true })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Run Scan' })).toBeVisible();
});
