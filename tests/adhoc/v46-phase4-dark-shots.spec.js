// Ad-hoc: screenshots of the Phase 4 surfaces in OS dark mode (running
// view, history, SCAP Content, editor) for a visual pass. No assertions
// beyond reaching each screen; the scan is cancelled.
const { test } = require('@playwright/test');
const { openModuleInShell } = require('../helpers/cockpit');
const S = require('../helpers/scap');

test('dark mode shots', async ({ browser, browserName }) => {
    test.setTimeout(300000);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const frame = await openModuleInShell(page);
    const before = await S.snapshotScans(frame);
    const tmpBefore = await S.snapshotTmp(frame);
    const shot = name => page.screenshot({ path: `tests/test-results/v46-phase4/dark-${name}-${browserName}.png` });
    await frame.locator('.ct-history-card').scrollIntoViewIfNeeded();
    await shot('history');
    await frame.locator('#ct-scap-profile').selectOption(S.PROFILE_L1);
    await frame.getByRole('button', { name: 'Run Scan' }).click();
    await frame.locator('.ct-rule-feed-row').nth(20)
            .waitFor({ timeout: 60000 });
    await frame.locator('[data-ct-running]').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await shot('running');
    await frame.getByRole('button', { name: 'Cancel' }).click();
    await frame.getByRole('button', { name: 'Run Scan' }).waitFor();
    await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
    await frame.locator('#ct-scap-content-card').scrollIntoViewIfNeeded();
    await shot('content');
    await frame.locator('#ct-tailor-content-select').selectOption(S.DS);
    await frame.locator('#ct-tailor-profile-select').selectOption(S.PROFILE_L1);
    await frame.getByRole('button', { name: 'Load Rules' }).click();
    await frame.locator('#ct-tailor-values-title').waitFor({ timeout: 120000 });
    await frame.locator('#ct-tailor-rules-title').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await shot('editor');
    await S.cleanupCreated(frame, before, tmpBefore);
});
