// Ad-hoc (4.6.2 investigation, no assertions): every bridge channel the
// page opens when SCAP is loaded in the shell, with open/close times from
// the start of the load, read from the shell's WebSocket frames. Read-only.
//   SCAP_PERF=1 SCAP_SHELL_PATH=/scap-dev ... npx playwright test ... tests/adhoc/v46-462-open-timeline.spec.js
const { test } = require('@playwright/test');
const { openModuleInShell, shellFrame, SHELL_PATH, COCKPIT_URL } = require('../helpers/cockpit');

test.skip(process.env.SCAP_PERF !== '1', 'investigation: set SCAP_PERF=1 to run it');

test('open timeline', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await openModuleInShell(page);
    await page.goto(COCKPIT_URL + '/system');
    await page.waitForLoadState('load');
    const chans = new Map();
    let t0 = 0;
    const ctl = (text, dir) => {
        if (!text.startsWith('\n')) {
            const nl = text.indexOf('\n');
            const c = chans.get(text.slice(0, nl));
            if (c) { c.bytes += text.length - nl - 1; if (dir === 'in') c.lastData = Date.now() - t0; }
            return;
        }
        let m;
        try { m = JSON.parse(text.slice(1)) } catch { return }
        if (m.command === 'open' && t0) {
            chans.set(m.channel, {
                open: Date.now() - t0,
                what: m.spawn ? 'spawn ' + m.spawn.map(a => a.length > 60 ? a.slice(0, 40) + '…' : a).join(' ') : `${m.payload} ${m.path || ''}`,
                su: m.superuser || '',
                bytes: 0,
            });
        } else if (m.command === 'close' && chans.has(m.channel)) {
            const c = chans.get(m.channel);
            if (c.close === undefined) c.close = Date.now() - t0;
        }
    };
    page.on('websocket', ws => {
        ws.on('framesent', f => typeof f.payload === 'string' && ctl(f.payload, 'out'));
        ws.on('framereceived', f => typeof f.payload === 'string' && ctl(f.payload, 'in'));
    });
    t0 = Date.now();
    await page.goto(COCKPIT_URL + SHELL_PATH);
    const frame = await shellFrame(page);
    await frame.getByRole('button', { name: 'Run Scan' }).and(frame.locator(':enabled'))
            .waitFor({ timeout: 60000 });
    const ready = Date.now() - t0;
    await page.waitForTimeout(3000);
    const rows = [...chans.values()].sort((a, b) => a.open - b.open);
    for (const r of rows)
        console.log(`${String(r.open).padStart(5)} → ${String(r.close ?? '-').padStart(5)} (${String((r.close ?? NaN) - r.open).padStart(5)} ms) ${String(r.bytes).padStart(8)} B ${r.su} ${r.what}`);
    console.log(`Run Scan enabled at ${ready} ms`);
    await context.close();
});
