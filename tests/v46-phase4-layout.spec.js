// V4.6 Phase 4, G3: layouts the Phase 1-3 report could not check, INSIDE
// the Cockpit shell (/scap-dev), both browser projects: phone width
// (375 px) and 1280x800 @125 % (a 1024x640 CSS viewport). For setup,
// running view, results, Remediation Builder drawer, history and policy
// editor: no horizontal page overflow, the screen's key controls fit the
// width (and Cancel is above the fold while running), plus a screenshot
// per screen in tests/test-results/v46-phase4/ for a visual pass.
const { test, expect } = require('@playwright/test');
const { openModuleInShell } = require('./helpers/cockpit');
const S = require('./helpers/scap');

const VIEWPORTS = [
    { name: 'phone-375', viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 },
    { name: '1280x800@125', viewport: { width: 1024, height: 640 }, deviceScaleFactor: 1.25 },
];

for (const vp of VIEWPORTS) {
    test.describe(vp.name, () => {
        test.describe.configure({ mode: 'serial' });
        let page, frame, before, tmpBefore;

        test.beforeAll(async ({ browser }) => {
            // Log in and unlock admin at desktop width (the shell's narrow
            // header hides its admin switch in a menu), then resize.
            page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: vp.deviceScaleFactor });
            frame = await openModuleInShell(page);
            await page.setViewportSize(vp.viewport);
            before = await S.snapshotScans(frame);
            tmpBefore = await S.snapshotTmp(frame);
        });

        test.afterAll(async () => {
            if (frame) await S.cleanupCreated(frame, before, tmpBefore);
            await page?.close();
        });

        // Horizontal overflow of the module document, and controls whose
        // right edge is past the frame's width.
        async function check(screen, browserName, controls = []) {
            await page.screenshot({ path: `tests/test-results/v46-phase4/layout-${vp.name}-${screen}-${browserName}.png` });
            const overflow = await frame.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            expect(overflow, `${screen}: page scrolls sideways`).toBeLessThanOrEqual(1);
            const width = await frame.evaluate(() => document.documentElement.clientWidth);
            for (const c of controls) {
                const box = await c.evaluate(el => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width } });
                expect(box.w, `${screen}: control has no width`).toBeGreaterThan(0);
                expect(box.r, `${screen}: control past the right edge`).toBeLessThanOrEqual(width + 1);
                expect(box.l).toBeGreaterThanOrEqual(-1);
            }
        }

        test('setup', async ({ browserName }) => {
            await S.pickContentAndProfile(frame, S.PROFILE_L1);
            await expect(frame.getByRole('button', { name: 'Run Scan' })).toBeEnabled();
            await check('setup', browserName, [
                frame.locator('#ct-scap-content'), frame.locator('#ct-scap-profile'), frame.locator('#ct-scan-other-content'),
                frame.getByRole('button', { name: 'Run Scan' }), frame.getByRole('button', { name: 'View Compliance Guide' }),
            ]);
        });

        test('running view', async ({ browserName }) => {
            await frame.getByRole('button', { name: 'Run Scan' }).click();
            const running = frame.locator('[data-ct-running]');
            await expect(running).toBeVisible();
            const cancel = running.getByRole('button', { name: 'Cancel' });
            const box = await cancel.boundingBox();
            expect(box.y + box.height, 'Cancel above the fold').toBeLessThanOrEqual(vp.viewport.height);
            await expect.poll(() => frame.locator('.ct-rule-feed-row').count(), { timeout: 60000 }).toBeGreaterThan(10);
            await check('running', browserName, [cancel, running.locator('.ct-rule-feed'), running.locator('.ct-live-tiles'),
                running.locator('.ct-scan-progress-bar')]);
            await frame.locator('[data-ct-results]').waitFor({ timeout: 300000 });
        });

        test('results', async ({ browserName }) => {
            const results = frame.locator('[data-ct-results]');
            await results.evaluate(el => el.scrollIntoView({ block: 'start' }));
            await check('results', browserName, [
                results.locator('.ct-score-tile'), results.locator('.ct-builder-panel'),
                results.getByRole('textbox', { name: 'Search rules' }),
                results.locator('.ct-failing-group-high .ct-rule-row').first(),
            ]);
            await results.locator('.ct-results-footer').scrollIntoViewIfNeeded();
            await check('results-footer', browserName, [
                results.locator('.ct-results-footer').getByRole('button', { name: 'View report' }),
                results.locator('.ct-results-footer').getByRole('button', { name: 'Close', exact: true }),
            ]);
        });

        test('Builder drawer', async ({ browserName }) => {
            const drawer = await S.openBuilder(frame, 'critical');
            const width = await frame.evaluate(() => document.documentElement.clientWidth);
            const dbox = await drawer.boundingBox();
            expect(dbox.width).toBeLessThanOrEqual(width + 1);
            await check('builder', browserName, [
                drawer.getByRole('button', { name: 'Close Remediation Builder' }),
                drawer.getByRole('button', { name: 'Download Bash script' }),
                drawer.getByRole('button', { name: 'Download Ansible playbook' }),
            ]);
            await S.closeBuilder(frame);
        });

        test('history', async ({ browserName }) => {
            const card = frame.locator('.ct-history-card');
            await card.scrollIntoViewIfNeeded();
            const row = card.locator('tbody tr').first();
            // Below 992 px Download and Delete live in the row's kebab.
            const wide = await frame.evaluate(() => document.documentElement.clientWidth >= 992);
            const kebab = row.getByRole('button', { name: /^More actions/ });
            await check('history', browserName, [
                row.getByRole('button', { name: 'View', exact: true }), ...(wide ? [] : [kebab]),
            ]);
            if (wide) {
                // View · Download · Delete as links, no kebab.
                await expect(kebab).toBeHidden();
                await check('history-links', browserName, [
                    row.getByRole('button', { name: /^Download scan from/ }),
                    row.getByRole('button', { name: /^Delete scan from/ }),
                ]);
                return;
            }
            await expect(row.getByRole('button', { name: /^Download scan from/ })).toBeHidden();
            await expect(row.getByRole('button', { name: /^Delete scan from/ })).toBeHidden();
            await kebab.click();
            const items = (await frame.getByRole('menuitem').filter({ visible: true }).allInnerTexts()).map(t => t.trim());
            expect(items).toEqual(['Download HTML report', 'Download results XML', 'Download ARF', 'Delete']);
            await page.waitForTimeout(500); // PF menu fade-in, for the screenshot
            await check('history-kebab', browserName, [frame.getByRole('menuitem', { name: 'Delete' })]);
            await page.keyboard.press('Escape');
        });

        test('policy editor', async ({ browserName }) => {
            await frame.locator('[data-ct-results]').getByRole('button', { name: 'Close', exact: true }).click();
            await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
            await S.pick(frame, '#ct-tailor-content-select', S.DS);
            await expect(frame.locator('#ct-tailor-profile-select')).toBeEnabled({ timeout: 60000 });
            await S.pick(frame, '#ct-tailor-profile-select', S.PROFILE_L1);
            await frame.getByRole('button', { name: 'Load Rules' }).click();
            const bar = frame.locator('[data-ct-tailor-actionbar]');
            await expect(bar).toBeVisible({ timeout: 120000 });
            await bar.scrollIntoViewIfNeeded();
            await check('editor', browserName, [
                bar.getByRole('textbox', { name: 'Policy name' }), bar.getByRole('button', { name: 'Save Policy' }),
                bar.getByRole('button', { name: 'Cancel' }), frame.getByRole('textbox', { name: 'Search rules' }),
            ]);
            // Variables starts closed (polish E1): open it, then scroll to it.
            await frame.locator('#ct-tailor-values-title-toggle').click();
            await frame.locator('#ct-tailor-values-title').evaluate(el => el.scrollIntoView({ block: 'start' }));
            await check('editor-variables', browserName, [bar.getByRole('button', { name: 'Cancel' }), frame.locator('#ct-tailor-values-title-content').getByRole('textbox', { name: 'Search variables' })]);
            await bar.getByRole('button', { name: 'Cancel' }).click();
        });
    });
}
