// UAT batch 1, U1: a real scan saves scan_duration_s in its manifest.json
// again (v3 did; the rewrite had dropped it), INSIDE the Cockpit shell
// (/scap-dev). ONE real CIS L1 scan; its scan directory is removed again
// by cleanupCreated(). While it runs, the time left comes from the newest
// earlier L1 scan when the host has one (else from the rule rate).
const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn } = require('./helpers/cockpit');
const S = require('./helpers/scap');

let page, frame, before, tmpBefore, home;

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    home = await S.homeDir(frame);
    before = await S.snapshotScans(frame);
    tmpBefore = await S.snapshotTmp(frame);
});

test.afterAll(async () => {
    if (frame) await S.cleanupCreated(frame, before, tmpBefore);
    await page?.close();
});

test('a finished scan writes scan_duration_s (whole seconds, start to oscap exit)', async ({ browserName }) => {
    await S.pickContentAndProfile(frame, S.PROFILE_L1);
    const started = Date.now();
    await frame.getByRole('button', { name: 'Run Scan' }).click();
    // Soft: the manifest check below must still run if this fails.
    const remaining = frame.locator('[data-ct-running] .ct-scan-remaining');
    await expect.soft(remaining).toBeVisible({ timeout: 60000 });
    const source = await remaining.getAttribute('data-ct-eta-source', { timeout: 1000 }).catch(() => null);
    expect.soft(['prior', 'rate']).toContain(source);
    console.log(`time left source: ${source}, text: ${await remaining.innerText({ timeout: 1000 }).catch(() => '(none)')}`);
    await page.screenshot({ path: `tests/test-results/uat1/u1-real-scan-${source}-${browserName}.png` });
    await frame.locator('[data-ct-results]').waitFor({ timeout: 300000 });
    const wall = (Date.now() - started) / 1000;

    const mine = (await S.snapshotScans(frame)).filter(ts => !before.includes(ts));
    expect(mine).toHaveLength(1);
    const dir = `${home}/SCAP/scans/${mine[0]}`;
    // await inside: a cockpit.file().read() is a thenable, not a Promise.
    const manifest = JSON.parse(await frame.evaluate(async p => await window.cockpit.file(p).read(), `${dir}/manifest.json`));
    expect(Number.isInteger(manifest.scan_duration_s)).toBe(true);
    expect(manifest.scan_duration_s).toBeGreaterThan(0);
    expect(manifest.scan_duration_s).toBeLessThanOrEqual(Math.ceil(wall));
    // oscap's own TestResult start/end, plus the module's spawn overhead.
    const tag = await hostSpawn(frame, ['sh', '-c', 'gzip -dc "$1" | grep -m1 -oE "<TestResult [^>]*>"', 'sh', `${dir}/results.xml.gz`]);
    const own = (new Date(tag.match(/end-time="([^"]+)"/)[1]) - new Date(tag.match(/start-time="([^"]+)"/)[1])) / 1000;
    console.log(`scan_duration_s ${manifest.scan_duration_s}, TestResult ${own} s, wall ${wall.toFixed(1)} s`);
    expect(manifest.scan_duration_s).toBeGreaterThanOrEqual(own - 1);
    expect(manifest.scan_duration_s).toBeLessThanOrEqual(own + 30);
});
