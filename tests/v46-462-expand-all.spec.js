// 4.6.2 round 2 (A): Expand all / Collapse all next to the rules search, on
// a saved scan opened from Scan History. No real scan: a fixture scan
// (manifest + a small results.xml.gz: 2 high, 3 medium, 1 low failing,
// 2 not applicable; stub report.html and arf.xml.gz) is written under ~/SCAP/scans and removed afterwards.
// The fresh-scan side is v46-462-expand-fresh (real scan, scap-apply10).
const { test } = require('@playwright/test');
const { openModuleInShell, shellFrame, hostSpawn } = require('./helpers/cockpit');
const S = require('./helpers/scap');
const X = require('./helpers/expand-all');

test.describe.configure({ mode: 'serial' });

const TS = '2099-01-05T00-00-00';
let page, frame, before;

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    before = await S.snapshotScans(frame);
    const home = (await hostSpawn(frame, ['sh', '-c', 'echo $HOME'])).trim();
    const dir = `${home}/SCAP/scans/${TS}`;
    await hostSpawn(frame, ['mkdir', '-p', dir]);
    const manifest = {
        timestamp: TS,
        profile_id: S.PROFILE_L1,
        profile_title: 'v46-test expand all',
        base_profile_id: S.PROFILE_L1,
        sds_file: S.DS,
        tailoring_file: null,
        tailoring_path: null,
        score: 50,
        counts: { pass: 1, fail: X.FIXTURE_FAILING },
        scan_duration_s: 10,
        rule_meta: {},
    };
    await frame.evaluate(async ({ dir, manifest }) => {
        await window.cockpit.file(`${dir}/manifest.json`).replace(JSON.stringify(manifest, null, 2));
    }, { dir, manifest });
    await hostSpawn(frame, ['sh', '-c', 'printf "%s" "$1" | gzip > "$2"', 'sh', X.fixtureResultsXml(), `${dir}/results.xml.gz`]);
    await hostSpawn(frame, ['sh', '-c', 'echo "<html>v46-test</html>" > "$1/report.html" && echo "v46-test" | gzip > "$1/arf.xml.gz"', 'sh', dir]);
    await page.reload();
    frame = await shellFrame(page);
    const row = frame.locator('.ct-history-card tbody tr').filter({ hasText: 'v46-test expand all' });
    await row.getByRole('button', { name: 'View', exact: true }).click();
    await frame.locator('[data-ct-results] .ct-score-value').waitFor({ timeout: 30000 });
});

test.afterAll(async () => {
    if (frame) await S.cleanupCreated(frame, before);
    await page?.close();
});

test('default: high open with its rows closed; the button says Expand all', async () => {
    await X.expectDefault(frame);
});

test('Expand all opens every failing group and row; Not applicable stays as it is', async () => {
    await X.expandAllAndCheck(frame);
});

test('a single row still toggles after Expand all, and the label follows', async () => {
    await X.toggleOneRow(frame);
});

test('Collapse all closes every group and row, Not applicable included', async () => {
    await X.collapseAllAndCheck(frame);
});

test('keyboard: Enter and Space on the button', async () => {
    await X.keyboard(frame);
});

test('search still opens matches, and clearing it restores the default groups', async () => {
    await X.searchStillWorks(frame, X.FIXTURE_RULES.medium[1].title, 'medium');
});
