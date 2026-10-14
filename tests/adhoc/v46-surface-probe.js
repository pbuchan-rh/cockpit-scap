// V4.6 Phase 2 ad-hoc probe: computed background/border of the layout
// layers (page, main container, section, cards, ::before borders) for the
// module inside the shell, plus a screenshot per theme into
// tests/screenshots/v46-probe/ (gitignored). No assertions.
// Usage: COCKPIT_URL=... COCKPIT_USER=... COCKPIT_PASS=... node tests/adhoc/v46-surface-probe.js [/scap-dev] [chromium|firefox]
const { chromium, firefox } = require('@playwright/test');
const shellPath = process.argv[2] || '/scap-dev';
const which = process.argv[3] || 'chromium';
(async () => {
    const browser = await (which === 'firefox' ? firefox : chromium).launch();
    for (const scheme of ['light', 'dark']) {
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true, colorScheme: scheme, viewport: { width: 1440, height: 900 } });
        const page = await ctx.newPage();
        await page.goto(process.env.COCKPIT_URL);
        await page.fill('#login-user-input', process.env.COCKPIT_USER);
        await page.fill('#login-password-input', process.env.COCKPIT_PASS);
        await page.click('#login-button');
        await page.waitForFunction(() => !document.getElementById('login-user-input'), null, { timeout: 20000 });
        await page.goto(process.env.COCKPIT_URL + shellPath);
        const iframe = page.locator(`iframe[name="cockpit1:localhost${shellPath}"]`);
        await iframe.waitFor({ state: 'attached' });
        const frame = await (await iframe.elementHandle()).contentFrame();
        await frame.locator('.pf-v6-c-card').first().waitFor();
        await page.waitForTimeout(2500);
        const info = await frame.evaluate(() => {
            const q = s => document.querySelector(s);
            const cs = (el, p) => el ? getComputedStyle(el, p) : null;
            const row = (name, el) => {
                const c = cs(el); const b = cs(el, '::before');
                return c ? `${name}: bg=${c.backgroundColor} border=${c.borderTopWidth} ${c.borderTopColor} before-border=${b.borderTopWidth} ${b.borderTopColor} font=${c.fontSize}/${c.fontWeight}` : `${name}: (none)`;
            };
            return [
                row('html', document.documentElement), row('body', document.body),
                row('page', q('.pf-v6-c-page')), row('main-container', q('.pf-v6-c-page__main-container')),
                row('main', q('.pf-v6-c-page__main')), row('section', q('.pf-v6-c-page__main-section')),
                row('tabs', q('.pf-v6-c-tabs')), row('card', q('.pf-v6-c-card')),
                row('card-header', q('.pf-v6-c-card__header')),
                'html.classes=' + document.documentElement.className,
            ].join('\n');
        });
        console.log(`--- ${which} ${scheme} ${shellPath}\n${info}`);
        require('fs').mkdirSync(__dirname + '/../screenshots/v46-probe', { recursive: true });
        await page.screenshot({ path: `${__dirname}/../screenshots/v46-probe/${shellPath.slice(1)}-${which}-${scheme}.png`, fullPage: false });
        await ctx.close();
    }
    await browser.close();
})().catch(e => { console.error(e); process.exit(1) });
