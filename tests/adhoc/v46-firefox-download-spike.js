// V4.6 Phase 1 item 3 spike: does a download through Cockpit's external
// channel (/cockpit/channel/<csrf>?<base64 open options>, payload fsread1,
// external content-disposition: attachment) arrive in Firefox when the
// module runs INSIDE the Cockpit shell iframe? Baseline: the blob <a download>
// the module used before V4.6 (blocked by the shell CSP in Firefox, C§1b).
//
// No assertions, just a printed line per variant. Runs against any installed
// module page (default /scap = the RPM build) and only writes/removes its own
// /tmp/cockpit-scap-dl-v46-test-* file.
//
// Usage: COCKPIT_URL=... COCKPIT_USER=... COCKPIT_PASS=... \
//        node tests/adhoc/v46-firefox-download-spike.js [firefox|chromium] [/scap]
const fs = require('fs');
const { firefox, chromium } = require('@playwright/test');

const BASE = process.env.COCKPIT_URL;
const USER = process.env.COCKPIT_USER;
const PASS = process.env.COCKPIT_PASS;
const which = process.argv[2] || 'firefox';
const shellPath = process.argv[3] || '/scap';

async function main() {
    const browser = await (which === 'firefox' ? firefox : chromium).launch();
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('console', m => {
        if (/CSP|Content-Security|blocked/i.test(m.text())) console.log('  console:', m.text().slice(0, 200));
    });
    await page.goto(BASE);
    await page.fill('#login-user-input', USER);
    await page.fill('#login-password-input', PASS);
    await page.click('#login-button');
    await page.waitForFunction(() => !document.getElementById('login-user-input'), null, { timeout: 20000 });
    await page.goto(BASE + shellPath);
    const iframe = page.locator('iframe[name^="cockpit1:localhost' + shellPath + '"]');
    await iframe.waitFor({ timeout: 30000 });
    const frame = await (await iframe.elementHandle()).contentFrame();
    await frame.waitForFunction(() => window.cockpit?.transport?.csrf_token, null, { timeout: 30000 });

    for (const variant of ['blob-anchor', 'channel-iframe', 'channel-anchor', 'channel-window-open']) {
        const expected = `v46-test spike ${variant} ${Date.now()}\n`;
        const dl = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
        const popup = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
        const err = await frame.evaluate(async ({ variant, expected }) => {
            const cockpit = window.cockpit;
            try {
                if (variant === 'blob-anchor') {
                    const url = URL.createObjectURL(new Blob([expected], { type: 'text/plain' }));
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'v46-test-blob.txt';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                    return null;
                }
                const path = (await cockpit.spawn(['mktemp', '/tmp/cockpit-scap-dl-v46-test-XXXXXX'])).trim();
                await cockpit.file(path).replace(expected);
                const opts = {
                    payload: 'fsread1',
                    binary: 'raw',
                    path,
                    host: cockpit.transport.host,
                    external: {
                        'content-disposition': `attachment; filename="v46-test-${variant}.txt"`,
                        'content-type': 'application/octet-stream',
                    },
                    max_read_size: Number.MAX_SAFE_INTEGER,
                };
                const bytes = new TextEncoder().encode(JSON.stringify(opts));
                const query = window.btoa(String.fromCharCode(...bytes));
                const prefix = new URL(cockpit.transport.uri('channel/' + cockpit.transport.csrf_token)).pathname;
                const href = `${prefix}?${query}`;
                if (variant === 'channel-iframe') {
                    const f = document.createElement('iframe');
                    f.hidden = true;
                    f.src = href;
                    document.body.appendChild(f);
                    setTimeout(() => f.remove(), 8000);
                } else if (variant === 'channel-anchor') {
                    const a = document.createElement('a');
                    a.href = href;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                } else {
                    window.open(href);
                }
                setTimeout(() => cockpit.spawn(['rm', '-f', path]), 8000);
                return null;
            } catch (e) {
                return String(e.message || e);
            }
        }, { variant, expected });
        const d = await dl;
        let got = null;
        if (d) {
            const p = await d.path().catch(() => null);
            got = p ? fs.readFileSync(p, 'utf8') : null;
        }
        const result = err
            ? 'ERROR ' + err
            : d ? (got === expected ? 'OK, content matches, ' + d.suggestedFilename() : 'DOWNLOAD, CONTENT MISMATCH') : 'NO DOWNLOAD';
        console.log(`${which} ${shellPath} ${variant}: ${result}`);
        const alive = await frame.evaluate(() => !!document.getElementById('app')).catch(() => false);
        if (!alive) console.log('  (module frame navigated away)');
        const pp = await Promise.race([popup, new Promise(r => setTimeout(() => r(null), 200))]);
        if (pp) console.log('  (a popup window was opened)');
        await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(9000);
    await browser.close();
}
main().catch(e => { console.error(e); process.exit(1) });
