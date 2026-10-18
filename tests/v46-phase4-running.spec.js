// V4.6 Phase 4, spec A: the running view, INSIDE the Cockpit shell
// (/scap-dev), both browser projects, at 1280x800 @125 % (a 1024x640 CSS
// viewport). One real CIS L1 scan drives the bar, tiles, feed (follow,
// pause on scroll-up, "Jump to latest", "Failed only") and the raw output
// expander; a second scan is cancelled and oscap must be gone.
const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

let page, frame, before, tmpBefore;

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 1.25 });
    frame = await openModuleInShell(page);
    before = await S.snapshotScans(frame);
    tmpBefore = await S.snapshotTmp(frame);
});

test.afterAll(async () => {
    if (frame) await S.cleanupCreated(frame, before, tmpBefore);
    await page?.close();
});

async function startScan() {
    await S.pickContentAndProfile(frame, S.PROFILE_L1);
    const run = frame.getByRole('button', { name: 'Run Scan' });
    await expect(run).toBeEnabled({ timeout: 30000 });
    await run.click();
    const running = frame.locator('[data-ct-running]');
    await expect(running).toBeVisible();
    return running;
}

const feedRows = () => frame.locator('.ct-rule-feed .ct-rule-feed-row');
const tile = kind => frame.locator(`[data-ct-live="${kind}"]`);
// Only scanning oscap processes: the setup page itself runs `oscap info`.
const oscapPids = async () => (await hostSpawn(frame, ['sh', '-c', "pgrep -a -x oscap | grep 'xccdf eval' || true"])).trim();

test('running view: context, bar moves, tiles count up, feed follows / pauses / jumps, failed only, raw output', async ({ browserName }) => {
    expect(await oscapPids()).toBe('');
    const running = await startScan();

    // Cancel sits in the card header, inside the 1024x640 viewport.
    const cancel = running.getByRole('button', { name: 'Cancel' });
    const box = await cancel.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(640);

    // Context block (v3 order).
    const ctx = running.locator('.ct-scan-context');
    await expect(ctx).toContainText('Red Hat Enterprise Linux 10');
    await expect(ctx).toContainText(/Version\s*0\.1\.\d+/);
    await expect(ctx).toContainText('CIS Red Hat Enterprise Linux 10 Benchmark for Level 1 - Server');
    await expect(ctx).toContainText(/Policy\s*—/);
    // The target is the host under test (scap-test10 or scap-apply10).
    await expect(ctx).toContainText(new URL(process.env.COCKPIT_URL).hostname.split('.')[0]);

    // The bar is real: "n of 323 rules" and its value grows.
    const bar = running.locator('.ct-scan-progress-bar');
    await expect(bar).toContainText(/\d+ of 323 rules evaluated/, { timeout: 60000 });
    await expect.poll(() => feedRows().count(), { timeout: 60000 }).toBeGreaterThan(25);
    const value = async () => Number(await bar.getByRole('progressbar').getAttribute('aria-valuenow'));
    const v1 = await value();
    await expect.poll(value, { timeout: 15000 }).toBeGreaterThan(v1);
    await expect(running.locator('.ct-scan-eta')).toContainText(/Elapsed \d+s/);

    // Tiles add up to the rows seen, and pass is counting.
    const n = async k => Number(await tile(k).innerText());
    expect(await n('pass')).toBeGreaterThan(0);
    const [p, f, e, rows] = [await n('pass'), await n('fail'), await n('error'), await feedRows().count()];
    expect(p + f + e).toBeLessThanOrEqual(rows + 5);
    // Each row: icon + title + result.
    await expect(feedRows().first().locator('svg.ct-feed-icon')).toBeVisible();

    // Follows the newest...
    const feed = frame.locator('.ct-rule-feed');
    const gap = () => feed.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight);
    await expect.poll(gap).toBeLessThanOrEqual(8);
    // ...pauses when scrolled up...
    await feed.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) });
    const jump = running.getByRole('button', { name: 'Jump to latest' });
    await expect(jump).toBeVisible();
    const rowsAtPause = await feedRows().count();
    await expect.poll(() => feedRows().count(), { timeout: 20000 }).toBeGreaterThan(rowsAtPause);
    expect(await feed.evaluate(el => el.scrollTop)).toBe(0);
    // ...and "Jump to latest" resumes following.
    await jump.click();
    await expect(jump).toBeHidden();
    await expect.poll(gap).toBeLessThanOrEqual(8);

    // Failed only.
    await running.getByText('Failed only').click();
    await expect.poll(async () => {
        const classes = await feedRows().evaluateAll(els => els.map(e => e.className));
        return classes.length > 0 && classes.every(c => c.includes('ct-rule-feed-fail'));
    }).toBe(true);
    await running.getByText('Failed only').click();

    await page.screenshot({ path: `tests/test-results/v46-phase4/running-1280x800@125-${browserName}.png` });

    // Raw oscap output behind its expander.
    await running.getByRole('button', { name: 'Show oscap output' }).click();
    await expect(running.locator('pre.ct-scan-output')).toContainText(/xccdf_org\.ssgproject\.content_rule_\S+:(pass|fail)/);

    // The scan completes into the results page.
    await frame.locator('[data-ct-results]').waitFor({ timeout: 300000 });
    await frame.locator('[data-ct-results] .ct-results-footer').getByRole('button', { name: 'Close' })
            .click();
});

test('Cancel stops oscap and returns to setup', async () => {
    const running = await startScan();
    await expect.poll(() => feedRows().count(), { timeout: 60000 }).toBeGreaterThan(5);
    expect(await oscapPids()).not.toBe('');
    await running.getByRole('button', { name: 'Cancel' }).click();
    await expect(frame.getByRole('button', { name: 'Run Scan' })).toBeVisible({ timeout: 30000 });
    await expect.poll(oscapPids, { timeout: 15000 }).toBe('');
    // The scan's tmpdir is removed too.
    await expect.poll(async () => (await S.snapshotTmp(frame)).filter(p => !tmpBefore.includes(p) && !p.includes('-dl-')).length,
                      { timeout: 15000 }).toBe(0);
});
