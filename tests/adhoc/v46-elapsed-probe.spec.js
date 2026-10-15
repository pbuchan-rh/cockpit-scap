// Ad-hoc: does the running view's "Elapsed" clock advance? Starts a scan,
// samples the progress title and elapsed text every 2 s, then cancels.
const { test } = require('@playwright/test');
const { openModuleInShell } = require('../helpers/cockpit');
const S = require('../helpers/scap');

test('elapsed probe', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const frame = await openModuleInShell(page);
    const before = await S.snapshotScans(frame);
    const tmpBefore = await S.snapshotTmp(frame);
    await frame.locator('#ct-scap-profile').selectOption(S.PROFILE_L1);
    await frame.getByRole('button', { name: 'Run Scan' }).click();
    const t0 = Date.now();
    for (let i = 0; i < 8; i++) {
        const eta = await frame.locator('.ct-scan-eta').innerText()
                .catch(() => '-');
        const rows = await frame.locator('.ct-rule-feed-row').count();
        console.log(`t+${Math.round((Date.now() - t0) / 1000)}s rows=${rows} eta="${eta}"`);
        await page.waitForTimeout(2000);
    }
    await frame.getByRole('button', { name: 'Cancel' }).click();
    await frame.getByRole('button', { name: 'Run Scan' }).waitFor();
    await S.cleanupCreated(frame, before, tmpBefore);
});
