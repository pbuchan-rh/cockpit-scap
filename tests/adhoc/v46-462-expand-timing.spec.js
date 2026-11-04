// Ad-hoc (4.6.2 round 2, no assertions): how long Expand all / Collapse all
// and one row toggle take on a big saved scan. Read-only: Views a saved
// scan (SCAP_EXPAND_ROW, history row index, default 0), never scans,
// saves or deletes.
//   SCAP_PERF=1 SCAP_EXPAND_ROW=12 ... npx playwright test ... tests/adhoc/v46-462-expand-timing.spec.js
const { test } = require('@playwright/test');
const { openModuleInShell } = require('../helpers/cockpit');

test.skip(process.env.SCAP_PERF !== '1', 'investigation: set SCAP_PERF=1 to run it');

/* In the page: one click (`what`), then ms until its effect shows and two
 * animation frames have passed (painted). */
function timeClick(frame, what) {
    return frame.evaluate(what => new Promise(resolve => {
        const button = () => document.querySelector('.ct-rules-expand-all');
        const lastRow = () => Array.from(document.querySelectorAll('.ct-rule-row')).pop();
        const steps = {
            expand: [button, () => button().textContent === 'Collapse all' &&
                document.querySelectorAll('[data-ct-results] .ct-rule-detail').length > 0],
            rowClose: [lastRow, () => lastRow().getAttribute('aria-expanded') === 'false'],
            rowOpen: [lastRow, () => button().textContent === 'Collapse all'],
            collapse: [button, () => document.querySelectorAll('[data-ct-results] .ct-rule-row').length === 0],
        };
        const [target, done] = steps[what];
        const t0 = performance.now();
        target().click();
        const poll = () => {
            if (done()) requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round(performance.now() - t0))));
            else setTimeout(poll, 1);
        };
        poll();
    }), what);
}

test('Expand all timing', async ({ browser }) => {
    test.setTimeout(300000);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const frame = await openModuleInShell(page);
    const rows = frame.locator('.ct-history-card table[aria-label="Scan history"] tbody tr');
    await rows.nth(Number(process.env.SCAP_EXPAND_ROW || 0)).getByRole('button', { name: 'View', exact: true })
            .click();
    await frame.locator('[data-ct-results] .ct-score-value').waitFor({ timeout: 60000 });
    const out = [];
    for (let i = 0; i < 3; i++) {
        const failing = await frame.evaluate(() => Array.from(document.querySelectorAll('[data-ct-results] .ct-failing-group'))
                .filter(g => !/notapplicable|notchecked/.test(g.className))
                .reduce((n, g) => n + parseInt(g.querySelector('.pf-v6-c-label').textContent, 10), 0));
        const expand = await timeClick(frame, 'expand');
        const open = await frame.evaluate(() => document.querySelectorAll('[data-ct-results] .ct-rule-detail').length);
        const oneRow = await timeClick(frame, 'rowClose');
        const reopen = await timeClick(frame, 'rowOpen');
        const collapse = await timeClick(frame, 'collapse');
        out.push({ failing, open, expand, oneRow, reopen, collapse });
        console.log(JSON.stringify(out[i]));
    }
    await page.close();
});
