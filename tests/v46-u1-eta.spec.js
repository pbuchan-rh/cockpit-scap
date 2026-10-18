// UAT batch 1, U1: the running view's time-left estimate, INSIDE the
// Cockpit shell (/scap-dev), both browser projects. No real scan: the
// module frame's cockpit.spawn is wrapped so `oscap xccdf eval` becomes a
// fake process whose --progress lines this spec plays back (one 20 s
// "slow rule" in the middle). Prior scans are fabricated manifests in
// ~/SCAP/scans (2099-* timestamps, profile title "v46-test …"), removed
// again by cleanupCreated(). The profile (CIS Level 1 - Workstation) has
// no real scan on the test hosts, so "no prior scan" really means none.
const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn } = require('./helpers/cockpit');
const S = require('./helpers/scap');

// Not serial: each test stands alone (a failure restarts the worker, and
// beforeAll / afterAll run again), so a fail-first run reports all four.

const PROFILE = 'xccdf_org.ssgproject.content_profile_cis_workstation_l1';
let page, frame, before, tmpBefore, home;

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    home = await S.homeDir(frame);
    before = await S.snapshotScans(frame);
    tmpBefore = await S.snapshotTmp(frame);
    // No saved scan of this profile may exist, or "no prior" is a lie.
    const hits = await hostSpawn(frame, ['sh', '-c', `grep -l '"profile_id": "${PROFILE}"' "${home}"/SCAP/scans/*/manifest.json 2>/dev/null || true`]);
    expect(hits.trim(), 'a saved scan of the workstation profile already exists').toBe('');
});

test.afterAll(async () => {
    if (frame) await S.cleanupCreated(frame, before, tmpBefore);
    await page?.close();
});

/* A saved scan of PROFILE on S.DS, newest of all. `duration` goes into
 * scan_duration_s; `resultsSpan` (s) writes a results.xml.gz whose
 * TestResult start/end are that far apart (the backfill path). */
async function fakePrior(ts, { duration = null, resultsSpan = null }) {
    const dir = `${home}/SCAP/scans/${ts}`;
    const manifest = {
        timestamp: ts,
        profile_id: PROFILE,
        profile_title: 'v46-test fake prior scan',
        base_profile_id: PROFILE,
        sds_file: S.DS,
        tailoring_file: null,
        tailoring_path: null,
        score: 50,
        counts: { pass: 1, fail: 1 },
        ...(duration !== null ? { scan_duration_s: duration } : {}),
        rule_meta: {},
    };
    await hostSpawn(frame, ['mkdir', '-p', dir]);
    await frame.evaluate(async ({ dir, manifest }) => {
        await window.cockpit.file(`${dir}/manifest.json`).replace(JSON.stringify(manifest, null, 2));
    }, { dir, manifest });
    if (resultsSpan !== null) {
        const end = new Date(Date.UTC(2099, 0, 1, 0, 0, resultsSpan)).toISOString()
                .replace('.000Z', '+00:00');
        const xml = '<?xml version="1.0"?>\n<Benchmark xmlns="http://checklists.nist.gov/xccdf/1.2">\n' +
            `<TestResult id="xccdf_v46-test_testresult" start-time="2099-01-01T00:00:00+00:00" end-time="${end}" version="0.1.81">\n` +
            '</TestResult>\n</Benchmark>\n';
        await hostSpawn(frame, ['sh', '-c', 'printf "%s" "$1" | gzip > "$2"', 'sh', xml, `${dir}/results.xml.gz`]);
    }
}

/* Wraps the frame's cockpit.spawn: `oscap xccdf eval` returns a fake
 * process (stream / then / close like a real cockpit proc) whose output
 * callback lands in window.__fake.cb. Everything else spawns for real. */
async function installFakeOscap() {
    await frame.evaluate(() => {
        const c = window.cockpit;
        if (!window.__realSpawn) window.__realSpawn = c.spawn;
        const real = window.__realSpawn;
        window.__fake = {};
        c.spawn = function (args, opts) {
            if (Array.isArray(args) && args[0] === 'oscap' && args[1] === 'xccdf' && args[2] === 'eval') {
                let reject;
                const done = new Promise((_resolve, _reject) => { reject = _reject });
                const proc = {
                    stream(cb) { window.__fake.cb = cb; return proc },
                    then(a, b) { return done.then(a, b) },
                    catch(b) { return done.catch(b) },
                    finally(f) { return done.finally(f) },
                    input() {},
                    close(problem) { reject(Object.assign(new Error(problem || 'closed'), { problem })) },
                };
                window.__fake.args = args;
                return proc;
            }
            return real.apply(this, arguments);
        };
    });
}

async function startFakeScan({ waitTotal = true } = {}) {
    await installFakeOscap();
    await S.pickContentAndProfile(frame, PROFILE);
    const run = frame.getByRole('button', { name: 'Run Scan' });
    await expect(run).toBeEnabled({ timeout: 30000 });
    await run.click();
    const running = frame.locator('[data-ct-running]');
    await expect(running).toBeVisible();
    await expect.poll(() => frame.evaluate(() => !!window.__fake.args?.includes('--progress'))).toBe(true);
    // The profile's rule total has arrived (extractProfile).
    if (waitTotal) await expect(running.locator('.ct-scan-progress-bar')).toContainText(/0 of \d+ rules evaluated/, { timeout: 60000 });
    return running;
}

/* Plays `plan` ([[atMs, rules], ...]) through the fake process and samples
 * the running view every 250 ms until `untilMs`. Returns the samples:
 * { t (ms), done (feed rows), text (time-left text or ''), source,
 * remaining (data attribute), elapsed (s), value (bar %) }. */
async function play(plan, untilMs) {
    await frame.evaluate(({ plan, untilMs }) => {
        const f = window.__fake;
        let n = 0;
        const emit = count => {
            const lines = [];
            for (let k = 0; k < count; k++, n++)
                lines.push(`xccdf_org.ssgproject.content_rule_v46_test_fake_${n}:${n % 6 ? 'pass' : 'fail'}`);
            f.cb(lines.join('\n') + '\n');
        };
        const t0 = performance.now();
        for (const [at, count] of plan) setTimeout(() => emit(count), at);
        window.__samples = [];
        const sample = () => {
            const eta = document.querySelector('.ct-scan-eta');
            const rem = document.querySelector('.ct-scan-remaining');
            const full = eta?.textContent || '';
            window.__samples.push({
                t: Math.round(performance.now() - t0),
                done: document.querySelectorAll('.ct-rule-feed-row').length,
                full,
                text: rem ? rem.textContent : (full.split(' · ')[1] || ''),
                source: rem?.dataset.ctEtaSource || null,
                remaining: rem ? Number(rem.dataset.ctRemaining) : null,
                elapsed: (() => {
                    const m = full.match(/Elapsed (?:(\d+)m )?(\d+)s/);
                    return m ? Number(m[1] || 0) * 60 + Number(m[2]) : null;
                })(),
                value: Number(document.querySelector('.ct-scan-progress-bar [role="progressbar"]')?.getAttribute('aria-valuenow')),
            });
        };
        const timer = setInterval(sample, 250);
        setTimeout(() => clearInterval(timer), untilMs);
    }, { plan, untilMs });
    await page.waitForTimeout(untilMs + 500);
    return frame.evaluate(() => window.__samples);
}

/* Seconds a shown time-left text stands for (both the old exact wording
 * and the coarse one), so "never rises" can be checked on what the user
 * reads. null when no estimate is shown. */
function shownSeconds(text) {
    if (!text) return null;
    if (/Finishing/.test(text)) return 0;
    if (/less than a minute/.test(text)) return 30;
    let m = text.match(/about (\d+) minutes? remaining/);
    if (m) return Number(m[1]) * 60;
    m = text.match(/about (?:(\d+)m )?(\d+)s remaining/);
    if (m) return Number(m[1] || 0) * 60 + Number(m[2]);
    return null;
}

async function cancel(running) {
    await running.getByRole('button', { name: 'Cancel' }).click();
    await expect(frame.getByRole('button', { name: 'Run Scan' })).toBeVisible({ timeout: 30000 });
}

test('no prior scan: rule-rate estimate counts down between completions, coarse words, no exact seconds', async ({ browserName }) => {
    const running = await startFakeScan();
    // 40 rules at 5/s, a 20 s slow rule, 40 rules at 10/s, 30 at 5/s.
    const plan = [];
    for (let i = 0; i < 40; i++) plan.push([i * 200, 1]);
    const afterSlow = 8000 + 20000;
    for (let i = 0; i < 40; i++) plan.push([afterSlow + i * 100, 1]);
    for (let i = 0; i < 30; i++) plan.push([afterSlow + 4000 + i * 200, 1]);
    const samples = await play(plan, afterSlow + 4000 + 6000 + 1000);
    await page.screenshot({ path: `tests/test-results/uat1/u1-countdown-rate-${browserName}.png` });
    await cancel(running);

    const shown = samples.filter(s => s.text);
    expect(shown.length, 'an estimate is shown').toBeGreaterThan(20);
    // Never exact seconds from the rule rate.
    const exact = shown.filter(s => /\d+\s*s\b|\d+s remaining/.test(s.text)).map(s => s.text);
    expect.soft(exact, 'rule-rate estimate shows exact seconds').toEqual([]);
    // Between completions (same rule count) the shown time never rises.
    const rises = [];
    for (let i = 1; i < samples.length; i++) {
        const [a, b] = [samples[i - 1], samples[i]];
        if (a.done !== b.done) continue;
        const [sa, sb] = [shownSeconds(a.text), shownSeconds(b.text)];
        if (sa !== null && sb !== null && sb > sa) rises.push(`${a.t}ms ${a.text} -> ${b.text}`);
        if (a.remaining !== null && b.remaining !== null && b.remaining > a.remaining) rises.push(`${a.t}ms ${a.remaining}s -> ${b.remaining}s`);
    }
    expect.soft(rises, 'the time left rose between rule completions').toEqual([]);
    // The slow rule really was covered: >= 15 s of samples at 40 rules.
    const stalled = samples.filter(s => s.done === 40);
    expect(stalled.length).toBeGreaterThan(60);
    expect(stalled.every(s => s.source === 'rate')).toBe(true);
    // Bar and text agree: the bar is elapsed / (elapsed + time left).
    for (const s of shown.filter(x => x.remaining !== null && x.elapsed > 5)) {
        const expected = Math.min(99, Math.round(s.elapsed / (s.elapsed + s.remaining) * 100));
        expect(Math.abs(s.value - expected), `bar ${s.value}% vs ${expected}% at ${s.t}ms`).toBeLessThanOrEqual(4);
    }
});

test('prior scan with scan_duration_s: counts down from it ("about 1m 30s"), smoothly', async ({ browserName }) => {
    await fakePrior('2099-01-01T00-00-00', { duration: 90 });
    const running = await startFakeScan({ waitTotal: false });
    const plan = [];
    for (let i = 0; i < 30; i++) plan.push([i * 300, 1]);
    const samples = await play(plan, 9000);
    await page.screenshot({ path: `tests/test-results/uat1/u1-countdown-prior-${browserName}.png` });
    await cancel(running);

    const shown = samples.filter(s => s.text);
    expect(shown.length).toBeGreaterThan(20);
    expect(shown.every(s => s.source === 'prior')).toBe(true);
    // Starts at the prior duration (minus the seconds already run) ...
    const first = shownSeconds(shown[0].text);
    expect(first).toBeLessThanOrEqual(90);
    expect(first).toBeGreaterThanOrEqual(90 - shown[0].elapsed - 2);
    expect(shown[0].text).toMatch(/^about 1m [23]\ds remaining$/);
    // ... and only ever counts down, through rule bursts too.
    for (let i = 1; i < shown.length; i++)
        expect(shownSeconds(shown[i].text)).toBeLessThanOrEqual(shownSeconds(shown[i - 1].text));
    const last = shownSeconds(shown[shown.length - 1].text);
    expect(first - last).toBeGreaterThanOrEqual(6);
    // remaining + elapsed stays the prior duration.
    for (const s of shown) expect(Math.abs(s.remaining + s.elapsed - 90)).toBeLessThanOrEqual(1);
    // The bar follows the same estimate.
    for (const s of shown) expect(Math.abs(s.value - Math.round(s.elapsed / 90 * 100))).toBeLessThanOrEqual(2);
});

test('older prior scan without scan_duration_s: duration read from that scan\'s results', async () => {
    await fakePrior('2099-01-02T00-00-00', { resultsSpan: 150 });
    const running = await startFakeScan({ waitTotal: false });
    const samples = await play([[0, 3]], 3000);
    await cancel(running);
    const shown = samples.filter(s => s.text);
    expect(shown.length).toBeGreaterThan(5);
    expect(shown.every(s => s.source === 'prior')).toBe(true);
    for (const s of shown) expect(Math.abs(s.remaining + s.elapsed - 150)).toBeLessThanOrEqual(1);
    expect(shown[0].text).toMatch(/^about 2m (2\d|30)s remaining$/);
});

test('past the prior duration: "Finishing…", then elapsed only after 1.5x', async () => {
    await fakePrior('2099-01-03T00-00-00', { duration: 6 });
    const running = await startFakeScan({ waitTotal: false });
    const samples = await play([[0, 2], [1000, 2]], 11000);
    await cancel(running);
    const finishing = samples.filter(x => x.elapsed >= 6 && x.elapsed < 9);
    // 6-8 s: Finishing…; from 9 s (1.5 x 6): no estimate, elapsed only.
    expect(finishing.length).toBeGreaterThan(0);
    expect(finishing.every(s => s.text === 'Finishing…')).toBe(true);
    const late = samples.filter(x => x.elapsed >= 9);
    expect(late.length).toBeGreaterThan(0);
    const elapsedOnly = late.every(s => s.text === '' && /^Elapsed \d+s$/.test(s.full));
    expect(elapsedOnly).toBe(true);
    // No number ever grows past the estimate.
    expect(samples.some(s => /remaining/.test(s.text) && s.elapsed >= 6)).toBe(false);
});
