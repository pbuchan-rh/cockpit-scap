// UAT batch 1, U2: every picker in the module is a PF6 Select (MenuToggle +
// SelectList), not a native <select> whose open list the browser draws.
// INSIDE the Cockpit shell (/scap-dev), both browser projects, light and
// dark. Read only: it opens pickers and changes selections in the forms,
// never saves or scans. Uses the host's own content and tailoring.
const { test, expect } = require('@playwright/test');
const { openModuleInShell } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

let context, page, frame;
const SHOTS = 'tests/test-results/uat1';

for (const scheme of ['light', 'dark']) {
    test.describe(scheme, () => {
        test.beforeAll(async ({ browser }) => {
            context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, ignoreHTTPSErrors: true });
            page = await context.newPage();
            frame = await openModuleInShell(page);
            await expect(frame.locator('#ct-scap-content')).toBeVisible({ timeout: 30000 });
            await expect(frame.getByRole('progressbar', { name: 'Loading profiles' })).toHaveCount(0, { timeout: 60000 });
        });
        test.afterAll(async () => { await context?.close() });

        const menu = () => frame.locator('.pf-v6-c-menu').filter({ has: frame.locator('[role="listbox"]') });

        /* Opens the picker, checks the PF menu, screenshots it, closes it. */
        async function openAndCheck(toggle, shot, browserName) {
            await toggle.click();
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
            await expect(menu()).toBeVisible();
            // The selected option carries PF's checkmark.
            const value = await toggle.getAttribute('data-ct-value');
            if (value) {
                const sel = menu().locator(`li[data-ct-value="${value}"] button`);
                await expect(sel).toHaveAttribute('aria-selected', 'true');
                await expect(sel.locator('.pf-v6-c-menu__item-select-icon')).toBeVisible();
            }
            // PF typography (Red Hat Text), not the system font of a native list.
            const fonts = await menu().locator('.pf-v6-c-menu__item-text')
                    .first()
                    .evaluate(e => getComputedStyle(e).fontFamily);
            expect(fonts).toMatch(/RedHatText|Red Hat Text/i);
            // Same width as its toggle, right under it.
            const [t, m] = [await toggle.boundingBox(), await menu().boundingBox()];
            expect(Math.abs(t.width - m.width)).toBeLessThanOrEqual(2);
            expect(Math.abs(t.x - m.x)).toBeLessThanOrEqual(2);
            expect(m.y).toBeGreaterThanOrEqual(t.y + t.height - 2);
            await page.screenshot({ path: `${SHOTS}/u2-${shot}-${scheme}-${browserName}.png` });
            await page.keyboard.press('Escape');
            await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        }

        test('no native <select> anywhere; Host Scan pickers are PF Selects', async ({ browserName }) => {
            await expect(frame.locator('select')).toHaveCount(0);
            for (const id of ['#ct-scap-content', '#ct-scap-profile', '#ct-scap-tailoring-select']) {
                const toggle = frame.locator(id);
                await expect(toggle).toHaveClass(/pf-v6-c-menu-toggle/);
                await expect(toggle).toHaveClass(/pf-m-full-width/);
            }
            await expect(frame.locator('#ct-scap-content')).toHaveAttribute('aria-label', /^Content file: /);

            // Content: "Installed" (as on the SCAP Content card) and "Uploaded" groups.
            await openAndCheck(frame.locator('#ct-scap-content'), 'scan-content', browserName);
            await frame.locator('#ct-scap-content').click();
            const groups = await menu().locator('.pf-v6-c-menu__group-title')
                    .allInnerTexts();
            expect(groups[0]).toBe('Installed');
            expect(groups.every(g => ['Installed', 'Uploaded'].includes(g))).toBe(true);
            expect(groups).not.toContain('Detected');
            await page.keyboard.press('Escape');

            // Same width and place as the column's other fields.
            const col = await frame.locator('.ct-scan-form').boundingBox();
            for (const id of ['#ct-scap-content', '#ct-scap-profile', '#ct-scap-tailoring-select']) {
                const b = await frame.locator(id).boundingBox();
                expect(Math.abs(b.x - col.x)).toBeLessThanOrEqual(1);
                expect(Math.abs(b.width - col.width)).toBeLessThanOrEqual(1);
            }

            await S.pick(frame, '#ct-scap-content', S.DS);
            await expect(frame.locator('#ct-scap-profile')).toBeEnabled({ timeout: 60000 });
            await openAndCheck(frame.locator('#ct-scap-profile'), 'scan-profile', browserName);
            await openAndCheck(frame.locator('#ct-scap-tailoring-select'), 'scan-tailoring', browserName);
        });

        test('keyboard: Enter opens, arrows move, Enter picks, focus returns to the toggle', async () => {
            const toggle = frame.locator('#ct-scap-profile');
            await toggle.focus();
            await page.keyboard.press('Enter');
            await expect(menu()).toBeVisible();
            const items = menu().locator('li[data-ct-value] button');
            await expect(items.first()).toBeFocused();
            await page.keyboard.press('ArrowDown');
            await expect(items.nth(1)).toBeFocused();
            const want = await menu().locator('li[data-ct-value]')
                    .nth(1)
                    .getAttribute('data-ct-value');
            await page.keyboard.press('Enter');
            await expect(menu()).toHaveCount(0);
            await expect(toggle).toBeFocused();
            await expect(toggle).toHaveAttribute('data-ct-value', want);
        });

        test('placeholder and disabled states', async () => {
            // A tailoring policy for the content disables Profile (it names its own base profile).
            const policies = (await S.pickerOptions(frame, '#ct-scap-tailoring-select')).filter(o => o.value);
            test.skip(policies.length === 0, 'needs a saved tailoring policy for RHEL 10 content');
            await S.pick(frame, '#ct-scap-tailoring-select', policies[0].value);
            await expect(frame.locator('#ct-scap-profile')).toBeDisabled();
            await S.pick(frame, '#ct-scap-tailoring-select', '');
            await expect(frame.locator('#ct-scap-tailoring-select')).toHaveText('(No tailoring — use full profile)');
            await expect(frame.locator('#ct-scap-profile')).toBeEnabled();
            // Content with no saved scan: profile placeholder, muted.
            const rhel8 = (await S.pickerOptions(frame, '#ct-scap-content')).find(o => o.text === 'Red Hat Enterprise Linux 8');
            if (rhel8) {
                await S.pick(frame, '#ct-scap-content', rhel8.value);
                const profile = frame.locator('#ct-scap-profile');
                await expect(profile).toBeEnabled({ timeout: 60000 });
                if (await profile.getAttribute('data-ct-value') === '') {
                    await expect(profile).toHaveText('Select a profile…');
                    await expect(profile).toHaveClass(/pf-m-placeholder/);
                }
                await S.pick(frame, '#ct-scap-content', S.DS);
                await expect(profile).toBeEnabled({ timeout: 60000 });
            }
        });

        test('Policy Tailoring: content, base profile and variable pickers are PF Selects too', async ({ browserName }) => {
            await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
            await expect(frame.locator('select')).toHaveCount(0);
            const content = frame.locator('#ct-tailor-content-select');
            await expect(content).toHaveClass(/pf-v6-c-menu-toggle/);
            await openAndCheck(content, 'tailor-content', browserName);
            await S.pick(frame, '#ct-tailor-content-select', S.DS);
            await expect(frame.locator('#ct-tailor-profile-select')).toBeEnabled({ timeout: 60000 });
            await openAndCheck(frame.locator('#ct-tailor-profile-select'), 'tailor-profile', browserName);
            await S.pick(frame, '#ct-tailor-profile-select', S.PROFILE_L1);
            await frame.getByRole('button', { name: 'Load Rules' }).click();
            const vars = frame.locator('#ct-tailor-values-title-toggle');
            await vars.waitFor({ timeout: 120000 });
            if (await vars.getAttribute('aria-expanded') !== 'true') await vars.click();
            await expect(frame.locator('select')).toHaveCount(0);
            const varToggle = frame.locator('.ct-tailor-values-grid .ct-select-toggle').first();
            await varToggle.scrollIntoViewIfNeeded();
            await openAndCheck(varToggle, 'tailor-variable', browserName);
            // Leave the editor without saving.
            await frame.getByRole('tab', { name: 'Host Scan' }).click();
        });
    });
}
