// Ad hoc (V4.6 polish): open the dev scan's results at a viewport and dump
// zone / Builder button geometry to SCAP_PROBE_OUT.
const fs = require('fs');
const { test } = require('@playwright/test');
const { openModuleInShell } = require('../helpers/cockpit');

test('probe', async ({ browser }) => {
    const ts = fs.readFileSync(process.env.SCAP_DEV_SCAN_FILE, 'utf8').trim();
    const [w, h] = (process.env.SCAP_PROBE_VP || '1440x900').split('x').map(Number);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const frame = await openModuleInShell(page);
    await page.setViewportSize({ width: w, height: h });
    const row = frame.getByRole('grid', { name: 'Scan history' }).locator('tbody tr')
            .filter({ hasText: ts.slice(0, 10) + ' ' + ts.slice(11).replace(/-/g, ':') });
    await row.getByRole('button', { name: 'View', exact: true }).click();
    const z = frame.locator('[data-ct-results] .ct-results-zones');
    await z.waitFor();
    await z.scrollIntoViewIfNeeded();
    const out = await z.evaluate(el => {
        const box = e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
        return {
            zones: box(el),
            kids: [...el.children].map(c => [c.className.slice(0, 40), box(c)]),
            buttons: [...el.querySelectorAll('.ct-builder-actions .pf-v6-c-button')].map(box),
        };
    });
    fs.writeFileSync(process.env.SCAP_PROBE_OUT, JSON.stringify(out, null, 1));
    await page.screenshot({ path: `tests/test-results/v46-polish/probe-${w}.png` });
    await page.close();
});
