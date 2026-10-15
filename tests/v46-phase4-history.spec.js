// V4.6 Phase 4, spec F: the Scan History table, INSIDE the Cockpit shell
// (/scap-dev), both browser projects. One real CIS L1 scan plus two older
// copies of it (this spec's own, fabricated scores) for the score delta.
const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

let page, frame, before, tmpBefore, home, mine;
// Newer than the real scan, so the real scan is their "previous".
const NEWER = '2099-01-01T00-00-00';        // same profile, score + 10 (may exceed 100; display only)
const OTHER = '2099-01-02T00-00-00';        // "tailored": must not compare

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    home = await S.homeDir(frame);
    before = await S.snapshotScans(frame);
    tmpBefore = await S.snapshotTmp(frame);
    await S.runScan(frame, { profileId: S.PROFILE_L1 });
    mine = (await S.snapshotScans(frame)).filter(ts => !before.includes(ts))[0];
    const src = `${home}/SCAP/scans/${mine}`;
    for (const [ts, patch] of [[NEWER, { delta: 10 }], [OTHER, { delta: -30, tailoring: 'v46-test other policy' }]]) {
        const dst = `${home}/SCAP/scans/${ts}`;
        await hostSpawn(frame, ['cp', '-a', src, dst]);
        await frame.evaluate(async ({ dst, ts, patch }) => {
            const f = window.cockpit.file(`${dst}/manifest.json`);
            const m = JSON.parse(await f.read());
            m.timestamp = ts;
            m.score = Math.round((m.score + patch.delta) * 100) / 100;
            if (patch.tailoring) {
                m.tailoring_file = patch.tailoring;
                m.tailoring_path = `/nonexistent/${patch.tailoring}.xml`;
                m.profile_title = patch.tailoring;
            }
            await f.replace(JSON.stringify(m, null, 2));
        }, { dst, ts, patch });
    }
    await frame.locator('[data-ct-results]').getByRole('button', { name: 'Close', exact: true })
            .click();
    await page.reload();
    frame = await (await page.locator('iframe[name^="cockpit1:localhost/scap-dev"]').elementHandle()).contentFrame();
    await table().locator('tbody tr').first()
            .waitFor({ timeout: 30000 });
});

test.afterAll(async () => {
    if (frame) await S.cleanupCreated(frame, before, tmpBefore);
    await page?.close();
});

const table = () => frame.getByRole('grid', { name: 'Scan history' });
const row = ts => table().locator('tbody tr')
        .filter({ hasText: ts.slice(0, 10) + ' ' + ts.slice(11).replace(/-/g, ':') });

test('columns, header band, plain numbers, labeled Actions', async () => {
    const heads = await table().locator('thead th').allInnerTexts();
    expect(heads.map(h => h.trim())).toEqual(['Date', 'Profile', 'Score', 'Passed', 'Failed', 'Actions']);
    const colors = await table().evaluate(t => ({
        th: getComputedStyle(t.querySelector('thead th')).backgroundColor,
        td: getComputedStyle(t.querySelector('tbody td')).backgroundColor,
        card: getComputedStyle(t.closest('.pf-v6-c-card')).backgroundColor,
    }));
    expect(colors.th).not.toBe(colors.card);
    expect(colors.th).not.toBe('rgba(0, 0, 0, 0)');
    await expect(table().locator('.pf-v6-c-label')).toHaveCount(0);
    const r = row(mine);
    const cells = r.locator('td');
    await expect(cells.nth(3)).toHaveText(/^\d+$/);
    await expect(cells.nth(4)).toHaveText(/^\d+$/);
    // Rows are full-width ruled.
    const border = await r.evaluate(tr => getComputedStyle(tr).borderBlockEndWidth);
    expect(parseFloat(border)).toBeGreaterThan(0);
});

test('profile with tailoring subline; score delta only vs same profile and tailoring', async () => {
    await expect(row(OTHER).locator('.ct-cell-subline')).toHaveCount(0); // name == title: no duplicate
    await expect(row(mine).locator('.ct-cell-subline')).toHaveCount(0);
    await expect(row(NEWER).locator('.ct-score-delta')).toHaveText('▲ 10');
    await expect(row(NEWER).locator('.ct-score-delta')).toHaveClass(/ct-score-delta-up/);
    await expect(row(OTHER).locator('.ct-score-delta')).toHaveCount(0);
});

test('View scrolls to and focuses the results', async () => {
    await row(mine).scrollIntoViewIfNeeded();
    await row(mine).getByRole('button', { name: 'View', exact: true }).click();
    const results = frame.locator('[data-ct-results]');
    await expect(results).toBeVisible({ timeout: 60000 });
    await expect.poll(() => frame.evaluate(() => document.activeElement?.classList.contains('ct-results-profile'))).toBe(true);
    await expect.poll(() => results.evaluate(el => Math.round(el.getBoundingClientRect().top)), { timeout: 5000 })
            .toBeLessThan(200);
    await results.getByRole('button', { name: 'Close', exact: true }).click();
});

test('Download menu: HTML report, results XML, ARF arrive', async () => {
    const r = row(mine);
    const pick = async item => S.expectDownload(page, async () => {
        await r.getByRole('button', { name: /^Download scan from/ }).click();
        await frame.getByRole('menuitem', { name: new RegExp('^' + item) }).click();
    }, { binary: true });
    const html = await pick('HTML report');
    expect(html.filename).toMatch(/-report\.html$/);
    expect(html.buffer.toString('utf8', 0, 4000)).toMatch(/<html|<!DOCTYPE/i);
    const xml = await pick('Results XML');
    expect(xml.filename).toMatch(/^scan-results-.*\.xml\.gz$/);
    expect(xml.buffer[0]).toBe(0x1f);
    const arf = await pick('ARF');
    expect(arf.filename).toMatch(/-arf\.xml\.gz$/);
    expect(arf.buffer[0]).toBe(0x1f);
});

test('Delete sits in a kebab and confirms', async () => {
    const r = row(OTHER);
    await expect(r.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await r.getByRole('button', { name: /^More actions for the scan from/ }).click();
    await frame.getByRole('menuitem', { name: 'Delete' }).click();
    const modal = frame.getByRole('dialog');
    await expect(modal).toContainText('Delete the scan from 2099-01-02');
    await modal.getByRole('button', { name: 'Delete' }).click();
    await expect(row(OTHER)).toHaveCount(0);
    expect((await S.snapshotScans(frame)).includes(OTHER)).toBe(false);
});

test('footer: N items · size', async () => {
    const footer = frame.locator('.ct-history-card .ct-list-footer');
    await expect(footer).toHaveText(/^\d+ items? · \d+(\.\d)? (B|KB|MB|GB)$/);
    await expect.poll(async () => {
        const n = await frame.locator('.ct-history-card tbody tr').count();
        return n > 0 && (await footer.innerText()).startsWith(`${n} item`);
    }).toBe(true);
});

test('phone width: still a 3-column table', async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    await expect.poll(() => table().locator('thead th:visible').count()).toBe(3);
    const heads = (await table().locator('thead th:visible').allInnerTexts()).map(h => h.trim());
    expect(heads).toEqual(['Date', 'Score', 'Actions']);
    // Not PF's stacked label/value grid.
    await expect(table()).not.toHaveClass(/pf-m-grid/);
    const overflow = await frame.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1440, height: 900 });
});
