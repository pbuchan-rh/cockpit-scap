// 4.6.2 round 2 (B): Scan History lists from a light read of the
// manifests (rule_meta left out), and a saved scan's View reads only its
// manifest and results XML; report.html and the gzipped results/ARF are
// read when View report or a Download asks. No real scan: fixture scan
// dirs under ~/SCAP/scans, removed afterwards.
const { test, expect } = require('@playwright/test');
const { openModuleInShell, shellFrame, hostSpawn } = require('./helpers/cockpit');
const S = require('./helpers/scap');
const X = require('./helpers/expand-all');

test.describe.configure({ mode: 'serial' });

let page, frame, before, tmpBefore, home;

const base = (ts, title) => ({
    timestamp: ts,
    profile_id: S.PROFILE_L1,
    profile_title: title,
    base_profile_id: S.PROFILE_L1,
    sds_file: S.DS,
    tailoring_file: null,
    tailoring_path: null,
    score: 50,
    counts: { pass: 1, fail: X.FIXTURE_FAILING },
});
// The fixture results carry no CCE, so a CCE shown on the rule comes from
// the manifest's rule_meta, i.e. View read the whole manifest.
const META = {
    'xccdf_org.ssgproject.content_rule_v46_test_high_a': {
        title: 'v46-test meta title', description: '', rationale: '', cce: 'CCE-v46-test-1', automated: false,
    },
};

// [timestamp, manifest text or null (no manifest), shows a row?]
const SHAPES = [
    ['2099-02-01T00-00-01', JSON.stringify({ ...base('2099-02-01T00-00-01', 'v46-test shape last'), rule_meta: META }, null, 2), true],
    ['2099-02-01T00-00-02', JSON.stringify({ rule_meta: META, ...base('2099-02-01T00-00-02', 'v46-test shape first') }, null, 2), true],
    ['2099-02-01T00-00-03', JSON.stringify({ ...base('2099-02-01T00-00-03', 'v46-test shape compact'), rule_meta: META }), true],
    ['2099-02-01T00-00-04', JSON.stringify({ ...base('2099-02-01T00-00-04', 'v46-test shape empty meta'), rule_meta: {} }, null, 2), true],
    ['2099-02-01T00-00-05', JSON.stringify(base('2099-02-01T00-00-05', 'v46-test shape no meta'), null, 2), true],
    ['2099-02-01T00-00-06', null, false],
    ['2099-02-01T00-00-07', '{ "timestamp": "2099-02-01T00-00-07", "profile_title": "v46-test shape broken"', false],
];
const VIEW_TS = '2099-02-01T00-00-01';
const REPORT = '<html><body>v46-test report ✓</body></html>\n';

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    before = await S.snapshotScans(frame);
    tmpBefore = await S.snapshotTmp(frame);
    home = (await hostSpawn(frame, ['sh', '-c', 'echo $HOME'])).trim();
    for (const [ts, text] of SHAPES) {
        const dir = `${home}/SCAP/scans/${ts}`;
        await hostSpawn(frame, ['mkdir', '-p', dir]);
        if (text !== null) {
            await frame.evaluate(async ({ dir, text }) => {
                await window.cockpit.file(`${dir}/manifest.json`).replace(text);
            }, { dir, text });
        }
    }
    const dir = `${home}/SCAP/scans/${VIEW_TS}`;
    await hostSpawn(frame, ['sh', '-c', 'printf "%s" "$1" | gzip > "$2/results.xml.gz"', 'sh', X.fixtureResultsXml(), dir]);
    await hostSpawn(frame, ['sh', '-c', 'printf "%s" "$1" > "$2/report.html" && echo v46-test-arf | gzip > "$2/arf.xml.gz"', 'sh', REPORT, dir]);
    await page.reload();
    frame = await shellFrame(page);
    await frame.locator('.ct-history-card tbody tr').first()
            .waitFor({ timeout: 30000 });
});

test.afterAll(async () => {
    if (frame) await S.cleanupCreated(frame, before, tmpBefore);
    await page?.close();
});

test('every manifest shape that parses gets its row, newest first; broken or missing ones none', async () => {
    const rows = frame.locator('.ct-history-card tbody tr');
    const titles = (await rows.allInnerTexts()).filter(t => t.includes('v46-test shape'))
            .map(t => t.match(/v46-test shape [a-z ]+/)[0].trim());
    expect(titles).toEqual(SHAPES.filter(s => s[2]).reverse()
            .map(s => JSON.parse(s[1]).profile_title));
});

test('View reads only the manifest and the results XML; View report and Download read their own file', async () => {
    await frame.evaluate(() => {
        const c = window.cockpit;
        if (!window.__ctRealSpawn) window.__ctRealSpawn = c.spawn;
        const real = window.__ctRealSpawn;
        window.__ctSpawns = [];
        c.spawn = function (args, opts) {
            window.__ctSpawns.push(args.join(' '));
            return real.call(this, args, opts);
        };
    });
    const spawned = () => frame.evaluate(() => window.__ctSpawns.filter(a => a.includes('2099-02-01T00-00-01')));
    const row = frame.locator('.ct-history-card tbody tr').filter({ hasText: 'v46-test shape last' });
    await row.getByRole('button', { name: 'View', exact: true }).click();
    const results = frame.locator('[data-ct-results]');
    await results.locator('.ct-score-value').waitFor({ timeout: 30000 });
    // rule_meta came from the whole manifest
    await expect(results.locator('.ct-failing-group-high .ct-rule-item').filter({ hasText: 'v46-test high rule A' })
            .locator('.ct-rule-cce')).toHaveText('CCE-v46-test-1');
    let reads = await spawned();
    // results.xml.gz itself (gunzipped in the browser), nothing else
    expect(reads.filter(a => /^(cat|gzip) /.test(a))).toEqual([`cat ${home}/SCAP/scans/${VIEW_TS}/results.xml.gz`]);

    // Download Results XML: the bytes View already read, no new read
    const want = Buffer.from(await hostSpawn(frame, ['sh', '-c', 'base64 -w0 "$1"', 'sh', `${home}/SCAP/scans/${VIEW_TS}/results.xml.gz`]), 'base64');
    const d = await S.expectDownload(page, () => S.resultsDownload(frame, 'Results XML'), { binary: true });
    expect(Buffer.compare(d.buffer, want)).toBe(0);
    reads = await spawned();
    expect(reads.filter(a => /^cat /.test(a))).toEqual([`cat ${home}/SCAP/scans/${VIEW_TS}/results.xml.gz`]);

    // View report: reads report.html once; the viewer gets its bytes
    await frame.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, key) {
            if (key === 'current') window.__ctReport = value;
            return put.call(this, value, key);
        };
    });
    const [popup] = await Promise.all([
        page.context().waitForEvent('page'),
        results.getByRole('button', { name: 'View report' }).click(),
    ]);
    await frame.waitForFunction(() => !!window.__ctReport, null, { timeout: 30000 });
    expect(await frame.evaluate(() => window.__ctReport.text())).toBe(REPORT);
    await popup.close();
    reads = await spawned();
    expect(reads.filter(a => /^cat /.test(a))).toEqual([
        `cat ${home}/SCAP/scans/${VIEW_TS}/results.xml.gz`,
        `cat ${home}/SCAP/scans/${VIEW_TS}/report.html`,
    ]);
    await expect(results.getByRole('button', { name: 'View report' })).toBeEnabled();
});

test('a saved file that cannot be read shows the error on the results', async () => {
    await hostSpawn(frame, ['rm', '-f', `${home}/SCAP/scans/${VIEW_TS}/arf.xml.gz`]);
    await S.resultsDownload(frame, 'ARF');
    const alert = frame.locator('[data-ct-results] .pf-v6-c-alert').filter({ hasText: 'Action failed' });
    await expect(alert).toBeVisible({ timeout: 30000 });
    await expect(alert).toContainText('arf.xml.gz');
    await expect(frame.locator('[data-ct-results]').getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
});
