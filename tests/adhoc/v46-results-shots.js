// V4.6 Phase 3 ad-hoc visual check: runs one CIS L1 scan in /scap-dev
// (inside the shell), screenshots the results page and the Remediation
// Builder drawer in light and dark into tests/screenshots/v46-shots/
// (gitignored), then deletes the scan it made. No assertions.
// Usage: COCKPIT_URL=... COCKPIT_USER=... COCKPIT_PASS=... node tests/adhoc/v46-results-shots.js [chromium|firefox] [/scap-dev]
const path = require('path');
const fs = require('fs');
const { chromium, firefox } = require('@playwright/test');
const { openModuleInShell } = require('../helpers/cockpit');
const S = require('../helpers/scap');

(async () => {
    const which = process.argv[2] || 'chromium';
    const shellPath = process.argv[3] || '/scap-dev';
    const out = path.join(__dirname, '../screenshots/v46-shots');
    fs.mkdirSync(out, { recursive: true });
    const browser = await (which === 'firefox' ? firefox : chromium).launch();
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const frame = await openModuleInShell(page, shellPath);
    const before = await S.snapshotScans(frame);
    const tmpBefore = await S.snapshotTmp(frame);
    try {
        await S.runScan(frame, { profileId: S.PROFILE_L1 });
        await page.waitForTimeout(1000);
        const tag = `${shellPath.slice(1)}-${which}`;
        await frame.locator('[data-ct-results]').screenshot({ path: `${out}/results-${tag}.png` });
        const first = frame.locator('.ct-rule-item').first();
        await first.locator('.ct-rule-row').click();
        await first.getByRole('button', { name: 'Remediation script' }).click();
        await page.waitForTimeout(2500);
        await first.screenshot({ path: `${out}/rule-expanded-${tag}.png` });
        await frame.getByRole('button', { name: /^Critical & high/ }).click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${out}/drawer-${tag}.png` });
        await frame.locator('.ct-builder-drawer').screenshot({ path: `${out}/drawer-panel-${tag}.png` });
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `${out}/drawer-${tag}-dark.png` });
        await frame.getByRole('button', { name: 'Close Remediation Builder' }).click();
        await page.waitForTimeout(800);
        await frame.locator('[data-ct-results]').screenshot({ path: `${out}/results-${tag}-dark.png` });
        console.log('screenshots in', out);
    } finally {
        console.log('removed', await S.cleanupCreated(frame, before, tmpBefore));
        await browser.close();
    }
})().catch(e => { console.error(e); process.exit(1) });
