// V4.6 Phase 4, G4: a download stages a user temp file
// (/tmp/cockpit-scap-dl-*) for Cockpit's external channel; it must be gone
// within ~70 s of a Remediation Builder download. INSIDE the Cockpit shell
// (/scap-dev), both browser projects.
const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

let page, frame, before, tmpBefore;

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    before = await S.snapshotScans(frame);
    tmpBefore = await S.snapshotTmp(frame);
    await S.runScan(frame, { profileId: S.PROFILE_L1 });
});

test.afterAll(async () => {
    if (frame) await S.cleanupCreated(frame, before, tmpBefore);
    await page?.close();
});

const staged = async () => (await hostSpawn(frame, ['sh', '-c', 'ls -1 /tmp/cockpit-scap-dl-* 2>/dev/null || true']))
        .split('\n').filter(Boolean);

test('Builder downloads: the staged temp files are removed within 70 s', async () => {
    test.setTimeout(240000);
    const old = await staged();
    await S.openBuilder(frame, 'critical');
    const bash = await S.builderDownload(page, frame, 'bash');
    expect(bash.text).toContain('# BEGIN fix');
    const ansible = await S.builderDownload(page, frame, 'ansible');
    expect(ansible.text).toMatch(/hosts:/);
    const mine = (await staged()).filter(p => !old.includes(p));
    expect(mine.length).toBe(2);
    const t0 = Date.now();
    await expect.poll(async () => (await staged()).filter(p => mine.includes(p)).length,
                      { timeout: 75000, intervals: [5000] }).toBe(0);
    test.info().annotations.push({ type: 'cleanup', description: `removed after ${Math.round((Date.now() - t0) / 1000)} s` });
    console.log(`G4: staged ${mine.join(', ')} removed ${Math.round((Date.now() - t0) / 1000)} s after the second download`);
    await S.closeBuilder(frame);
});
