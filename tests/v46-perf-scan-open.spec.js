// 4.6.2 timing: how long Host Scan takes to become usable when SCAP opens.
// Opt-in only (SCAP_PERF=1); it asserts nothing about speed, it prints the
// numbers. Read-only: it opens the page, never scans, saves or deletes.
//
//   SCAP_PERF=1 SCAP_SHELL_PATH=/scap ... npx playwright test ... tests/v46-perf-scan-open.spec.js
//
// Per run: a fresh shell page load of SCAP_SHELL_PATH (login and admin are
// done once, before the runs), then the ms from the start of that load to
//   (i)   the Profile picker enabled with a profile in it
//   (ii)  the profile description text shown
//   (iii) Run Scan enabled
//   (iv)  the first Scan History row shown
// and then, on the same page, from clicking View on the newest saved scan
//   (v)   ms until its results show the score and the first rule group
//   (vi)  bytes the shell's WebSocket received meanwhile (frame payloads)
// Needs a saved scan of the auto-selected content, so a profile is
// preselected. SCAP_PERF_RUNS (default 5). Results also go to
// tests/test-results/perf/<project>-<path>.json (gitignored).
const fs = require('fs');
const { test } = require('@playwright/test');
const { openModuleInShell, shellFrame, SHELL_PATH, COCKPIT_URL } = require('./helpers/cockpit');

const RUNS = Number(process.env.SCAP_PERF_RUNS || 5);

test.skip(process.env.SCAP_PERF !== '1', 'timing spec: set SCAP_PERF=1 to run it');

test('Host Scan open timing', async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await openModuleInShell(page);
    let wsBytes = 0;
    page.on('websocket', ws => {
        ws.on('framereceived', f => { wsBytes += Buffer.byteLength(f.payload) });
    });
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
        await page.goto(COCKPIT_URL + '/system');
        await page.waitForLoadState('load');
        const t0 = Date.now();
        await page.goto(COCKPIT_URL + SHELL_PATH);
        const frame = await shellFrame(page);
        const tFrame = Date.now();
        const marks = await frame.evaluate(() => new Promise((resolve, reject) => {
            const m = {};
            const nav = performance.timing;
            const visible = el => !!el && el.getClientRects().length > 0;
            const check = () => {
                const now = Date.now();
                const prof = document.getElementById('ct-scap-profile');
                if (m.card === undefined && document.querySelector('.pf-v6-c-card')) m.card = now;
                if (m.content === undefined && document.getElementById('ct-scap-content')) m.content = now;
                if (m.shown === undefined && prof && prof.getAttribute('data-ct-value')) m.shown = now;
                if (m.i === undefined && prof && !prof.disabled && prof.getAttribute('data-ct-value')) m.i = now;
                const desc = Array.from(document.querySelectorAll('.ct-profile-desc-col p'))
                        .find(p => !p.classList.contains('ct-profile-desc-heading') &&
                            !p.classList.contains('ct-profile-desc-placeholder') && p.textContent.trim());
                if (m.ii === undefined && visible(desc)) m.ii = now;
                const run = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Run Scan');
                if (m.iii === undefined && run && !run.disabled && run.getAttribute('aria-disabled') !== 'true') m.iii = now;
                if (m.iv === undefined && visible(document.querySelector('table[aria-label="Scan history"] tbody tr'))) m.iv = now;
                if (m.i !== undefined && m.ii !== undefined && m.iii !== undefined && m.iv !== undefined) {
                    m.navStart = nav.navigationStart;
                    m.domLoaded = nav.domContentLoadedEventEnd;
                    resolve(m);
                }
            };
            const timer = setInterval(check, 5);
            setTimeout(() => { clearInterval(timer); reject(new Error('not ready in 60 s: ' + JSON.stringify(m))) }, 60000);
            check();
        }));
        // (v)/(vi): View on the newest saved scan (the first row).
        wsBytes = 0;
        const v = await frame.evaluate(() => new Promise((resolve, reject) => {
            const row = document.querySelector('table[aria-label="Scan history"] tbody tr');
            const view = Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim() === 'View');
            const start = performance.now();
            view.click();
            const timer = setInterval(() => {
                const card = document.querySelector('[data-ct-results]');
                if (card && card.querySelector('.ct-score-value') &&
                    card.querySelector('.ct-failing-group, .pf-v6-c-empty-state')) {
                    clearInterval(timer);
                    resolve(Math.round(performance.now() - start));
                }
            }, 5);
            setTimeout(() => { clearInterval(timer); reject(new Error('saved scan not shown in 60 s')) }, 60000);
        }));
        const vBytes = wsBytes;
        runs.push({
            i: marks.i - t0,
            ii: marks.ii - t0,
            iii: marks.iii - t0,
            iv: marks.iv - t0,
            v,
            vi: vBytes,
            // where the time goes: the module page's own load start and
            // DOMContentLoaded, the first card, the content picker, the
            // profile shown (maybe still disabled), the frame seen by Playwright
            moduleNav: marks.navStart - t0,
            moduleDom: marks.domLoaded - t0,
            card: marks.card - t0,
            content: marks.content - t0,
            shown: marks.shown - t0,
            frameSeen: tFrame - t0,
        });
        console.log(`run ${i + 1}: ${JSON.stringify(runs[i])}`);
    }
    const stat = k => {
        const v = runs.map(r => r[k]).sort((a, b) => a - b);
        return { median: v[Math.floor(v.length / 2)], max: v[v.length - 1] };
    };
    const summary = {
        project: testInfo.project.name,
        path: SHELL_PATH,
        runs,
        ...Object.fromEntries(['i', 'ii', 'iii', 'iv', 'v', 'vi'].map(k => [k, stat(k)])),
    };
    console.log('SUMMARY ' + JSON.stringify(summary));
    fs.mkdirSync('tests/test-results/perf', { recursive: true });
    fs.writeFileSync(`tests/test-results/perf/${testInfo.project.name}${SHELL_PATH.replace(/\//g, '-')}-${Date.now()}.json`,
                     JSON.stringify(summary, null, 2));
    await context.close();
});
