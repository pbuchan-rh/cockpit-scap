// Ad-hoc (4.6.2 round 2, no assertions): what Scan History shows and the
// exact bytes of every saved-scan file the user can get, to compare one
// build with another. Read-only on ~/SCAP: it lists, views and downloads
// saved scans, never scans, saves or deletes. Downloads stage the usual
// /tmp/cockpit-scap-dl-* files, which the module removes after 60 s.
//
//   SCAP_PERF=1 SCAP_SHELL_PATH=/scap-dev SCAP_PROOF_ROWS=0,1 SCAP_PROOF_OUT=<file.json> ... \
//     npx playwright test ... tests/adhoc/v46-462-bytes-proof.spec.js
//
// For each history row index in SCAP_PROOF_ROWS (0 = newest): md5 of the
// row's Download HTML report / Results XML / ARF, then View, then md5 of
// the results footer's three downloads and of the report View report hands
// to viewer.html (captured where lib/reportViewer.js stores it). Also the
// history card's title, count and table text, and the results view's
// text (header, counts, groups with the default ones open; the 4.6.2
// Expand all label left out).
const crypto = require('crypto');
const fs = require('fs');
const { test } = require('@playwright/test');
const { openModuleInShell } = require('../helpers/cockpit');
const S = require('../helpers/scap');

test.skip(process.env.SCAP_PERF !== '1', 'investigation: set SCAP_PERF=1 to run it');

const md5 = buf => crypto.createHash('md5').update(buf)
        .digest('hex');
const ROWS = (process.env.SCAP_PROOF_ROWS || '0,1').split(',').map(Number);
const ITEMS = [['html', 'HTML report'], ['xml', 'Results XML'], ['arf', 'ARF']];

test('saved scan bytes and history text', async ({ browser }) => {
    test.setTimeout(600000);
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    const frame = await openModuleInShell(page);
    const card = frame.locator('.ct-history-card');
    const rows = card.locator('table[aria-label="Scan history"] tbody tr');
    await rows.first().waitFor({ timeout: 60000 });
    const out = {
        history: {
            header: (await card.locator('.pf-v6-c-card__header').innerText()).trim(),
            table: (await card.locator('table').innerText()).trim(),
        },
        scans: [],
    };
    for (const idx of ROWS) {
        const row = rows.nth(idx);
        const entry = {
            row: idx,
            date: (await row.locator('td').first()
                    .innerText()).trim(),
            history: {},
            results: {}
        };
        for (const [kind, item] of ITEMS) {
            const d = await S.expectDownload(page, async () => {
                await row.locator('.ct-history-download').getByRole('button')
                        .click();
                await frame.getByRole('menuitem', { name: item, exact: true }).click();
            }, { binary: true });
            entry.history[kind] = { name: d.filename, bytes: d.buffer.length, md5: md5(d.buffer) };
        }
        await row.getByRole('button', { name: 'View', exact: true }).click();
        const results = frame.locator('[data-ct-results]');
        await results.locator('.ct-score-value').waitFor({ timeout: 60000 });
        entry.results.title = (await results.locator('.ct-results-profile').innerText()).trim();
        // what the results view shows (default groups open), as text
        await results.locator('.ct-failing-group').first()
                .waitFor({ timeout: 60000 });
        const shown = (await results.locator('.ct-results-header, .ct-results-zones, .ct-rules-section').allInnerTexts())
                .join('\n')
                .split('\n')
                .map(l => l.trim())
                .filter(l => l && !/^(Expand|Collapse) all$/.test(l))
                .join('\n');
        entry.results.text = { chars: shown.length, md5: md5(shown) };
        for (const [kind, item] of ITEMS) {
            const d = await S.expectDownload(page, () => S.resultsDownload(frame, item), { binary: true });
            entry.results[kind] = { name: d.filename, bytes: d.buffer.length, md5: md5(d.buffer) };
        }
        // View report: keep a copy of the Blob reportViewer.js stores for
        // viewer.html (which deletes it once read).
        await frame.evaluate(() => {
            if (window.__ctPutHooked) return;
            window.__ctPutHooked = true;
            const put = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (value, key) {
                if (key === 'current') window.__ctReport = value;
                return put.call(this, value, key);
            };
        });
        await frame.evaluate(() => { window.__ctReport = null });
        const [popup] = await Promise.all([
            page.context().waitForEvent('page'),
            results.getByRole('button', { name: 'View report' }).click(),
        ]);
        await frame.waitForFunction(() => !!window.__ctReport, null, { timeout: 60000 });
        const b64 = await frame.evaluate(async () => {
            const buf = new Uint8Array(await window.__ctReport.arrayBuffer());
            let s = '';
            for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
            return btoa(s);
        });
        const viewed = Buffer.from(b64, 'base64');
        entry.results.viewReport = { bytes: viewed.length, md5: md5(viewed) };
        await popup.close();
        out.scans.push(entry);
        console.log(JSON.stringify(entry));
        await results.getByRole('button', { name: 'Close' }).click();
    }
    const file = process.env.SCAP_PROOF_OUT || 'tests/test-results/proof.json';
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log('wrote ' + file);
    await page.close();
});
