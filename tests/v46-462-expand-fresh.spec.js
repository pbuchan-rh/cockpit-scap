// 4.6.2 round 2 (A): Expand all / Collapse all on a fresh scan's results.
// One REAL scan (CIS L1): run it on the throwaway host (scap-apply10) only.
// The saved-scan side is v46-462-expand-all (fixture, no scan).
const { test, expect } = require('@playwright/test');
const { openModuleInShell } = require('./helpers/cockpit');
const S = require('./helpers/scap');
const X = require('./helpers/expand-all');

test.describe.configure({ mode: 'serial' });

let page, frame, before, tmpBefore;

test.beforeAll(async ({ browser }) => {
    test.setTimeout(900000);
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    before = await S.snapshotScans(frame);
    tmpBefore = await S.snapshotTmp(frame);
    await S.runScan(frame, { profileId: S.PROFILE_L1 });
});

test.afterAll(async () => {
    if (frame) await S.cleanupCreated(frame, before, tmpBefore);
    await page?.close();
});

test('fresh scan: Expand all opens every failing group and row, Not applicable untouched', async () => {
    await X.expectDefault(frame);
    const t0 = Date.now();
    const { groups, rows } = await X.expandAllAndCheck(frame);
    console.log(`fresh scan: Expand all opened ${groups.length} groups, ${rows} rows; checked in ${Date.now() - t0} ms`);
});

test('fresh scan: a single row toggles after Expand all; Collapse all closes everything', async () => {
    await X.toggleOneRow(frame);
    await X.collapseAllAndCheck(frame);
    await expect(frame.locator('[data-ct-results] .ct-rule-row')).toHaveCount(0);
});
