// Ad hoc (V4.6 polish): run one CIS L1 scan to iterate layout against, and
// record its timestamp; remove it with SCAP_DEV_SCAN_CLEAN=1.
const fs = require('fs');
const { test } = require('@playwright/test');
const { openModuleInShell, hostSpawn } = require('../helpers/cockpit');
const S = require('../helpers/scap');

const REC = process.env.SCAP_DEV_SCAN_FILE;

test('dev scan', async ({ browser }) => {
    test.setTimeout(400000);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const frame = await openModuleInShell(page);
    const home = await S.homeDir(frame);
    if (process.env.SCAP_DEV_SCAN_CLEAN) {
        const ts = fs.readFileSync(REC, 'utf8').trim();
        if (/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d$/.test(ts)) await hostSpawn(frame, ['rm', '-rf', `${home}/SCAP/scans/${ts}`]);
    } else {
        const before = await S.snapshotScans(frame);
        await S.runScan(frame, { profileId: S.PROFILE_L1 });
        fs.writeFileSync(REC, (await S.snapshotScans(frame)).filter(ts => !before.includes(ts))[0] + '\n');
        // Close the results so the app removes the scan's /tmp/cockpit-scap-* dir.
        await frame.locator('[data-ct-results]').getByRole('button', { name: 'Close', exact: true })
                .click();
    }
    await page.close();
});
