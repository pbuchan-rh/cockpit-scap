// V4.6 Phase 2 (visual surfaces and dividers, spec D), INSIDE the Cockpit
// shell, in light, OS dark, and Cockpit Session -> Style: Dark (light OS).
//   - native Cockpit layout (Amendment 3): opaque white main container like
//     the shell's own pages, outlined cards inside it
//   - a PF Divider under every card header and above every card footer
//   - severity group headers: neutral bold text + a readable PF Label
//   - neutral score tile (Amendment 2): no color by value
//   - one filled primary button on the setup screen
//   - no hard-coded hex colors in app.scss
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { openModuleInShell } = require('./helpers/cockpit');
const S = require('./helpers/scap');

function rgb(str) {
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(',').map(Number);
    return { r, g, b, a };
}

function luminance({ r, g, b }) {
    const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
    const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
}

test('app.scss uses PF tokens only (no hard-coded hex colors)', () => {
    const scss = fs.readFileSync(path.join(__dirname, '../src/app.scss'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
    expect(scss.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
});

const THEMES = [
    { name: 'light', colorScheme: 'light', shellStyle: null, dark: false },
    { name: 'os-dark', colorScheme: 'dark', shellStyle: null, dark: true },
    { name: 'shell-style-dark', colorScheme: 'light', shellStyle: 'dark', dark: true },
];

test.describe.serial('surfaces', () => {
    let before, tmpBefore, scanFrame, scanPage;

    test.beforeAll(async ({ browser }) => {
        // One CIS L1 scan for the results-page checks; every theme then
        // opens it from history.
        scanPage = await browser.newPage();
        scanFrame = await openModuleInShell(scanPage);
        before = await S.snapshotScans(scanFrame);
        tmpBefore = await S.snapshotTmp(scanFrame);
        await S.runScan(scanFrame, { profileId: S.PROFILE_L1 });
    });

    test.afterAll(async () => {
        if (scanFrame) await S.cleanupCreated(scanFrame, before, tmpBefore);
        await scanPage?.close();
    });

    for (const theme of THEMES) {
        test(`layout, dividers, severity headers, score tile: ${theme.name}`, async ({ browser }) => {
            const ctx = await browser.newContext({ ignoreHTTPSErrors: true, colorScheme: theme.colorScheme });
            if (theme.shellStyle)
                await ctx.addInitScript(s => { try { localStorage.setItem('shell:style', s) } catch (e) {} }, theme.shellStyle);
            const page = await ctx.newPage();
            const frame = await openModuleInShell(page);
            await expect(frame.locator('html')).toHaveClass(theme.dark ? /pf-v6-theme-dark/ : /^(?!.*pf-v6-theme-dark)/);

            const layers = await frame.evaluate(() => {
                const cs = s => getComputedStyle(document.querySelector(s));
                const card = document.querySelector('.pf-v6-c-card');
                return {
                    body: getComputedStyle(document.body).backgroundColor,
                    container: cs('.pf-v6-c-page__main-container').backgroundColor,
                    containerBorder: cs('.pf-v6-c-page__main-container').borderTopColor,
                    section: cs('.pf-v6-c-page__main-section').backgroundColor,
                    card: getComputedStyle(card).backgroundColor,
                    cardOutline: getComputedStyle(card, '::before').borderTopColor,
                };
            });
            expect(rgb(layers.container).a).toBe(1);
            expect(rgb(layers.cardOutline).a).toBeGreaterThan(0);
            if (!theme.dark) expect(layers.container).toBe('rgb(255, 255, 255)');
            expect(layers.card).not.toBe(layers.body);
            if (!theme.dark) expect(layers.card).toBe('rgb(255, 255, 255)');

            // Every card with a header has a Divider right under it, and every
            // footer has one right above it.
            const dividerProblems = await frame.evaluate(() => {
                const bad = [];
                for (const card of document.querySelectorAll('.pf-v6-c-card')) {
                    if (!card.offsetParent) continue;
                    const header = card.querySelector(':scope > .pf-v6-c-card__header');
                    if (header && !header.nextElementSibling?.classList.contains('pf-v6-c-divider'))
                        bad.push('no divider under header: ' + header.innerText.slice(0, 40));
                    const footer = card.querySelector(':scope > .pf-v6-c-card__footer');
                    if (footer && !footer.previousElementSibling?.classList.contains('pf-v6-c-divider'))
                        bad.push('no divider above footer: ' + footer.innerText.slice(0, 40));
                }
                return bad;
            });
            expect(dividerProblems).toEqual([]);

            const primaries = frame.locator('.pf-v6-c-card .pf-v6-c-button.pf-m-primary:visible');
            await expect(primaries).toHaveCount(1);
            await expect(primaries).toHaveText('Run Scan');

            // Open the spec's scan (newest in history) and check the results.
            await frame.locator('tbody tr').first()
                    .getByRole('button', { name: /^View/ })
                    .click();
            const results = frame.locator('[data-ct-results]');
            await expect(results).toBeVisible({ timeout: 60000 });
            const sev = await frame.evaluate(() => {
                const out = [];
                for (const name of document.querySelectorAll('.ct-sev-group-name')) {
                    // PF6 paints the label fill on __content::before.
                    const label = name.parentElement.querySelector('.pf-v6-c-label__content');
                    const text = label.querySelector('.pf-v6-c-label__text') || label;
                    out.push({
                        name: name.textContent,
                        nameColor: getComputedStyle(name).color,
                        nameWeight: getComputedStyle(name).fontWeight,
                        bodyColor: getComputedStyle(document.body).color,
                        labelFg: getComputedStyle(text).color,
                        labelBg: getComputedStyle(label, '::before').backgroundColor,
                        cardBg: getComputedStyle(name.closest('.pf-v6-c-card')).backgroundColor,
                    });
                }
                return out;
            });
            expect(sev.length).toBeGreaterThan(0);
            for (const g of sev) {
                expect(Number(g.nameWeight), `${g.name} header is bold`).toBeGreaterThanOrEqual(500);
                expect(contrast(rgb(g.nameColor), rgb(g.cardBg)), `${g.name} header text contrast`).toBeGreaterThanOrEqual(4.5);
                const bg = rgb(g.labelBg).a === 0 ? rgb(g.cardBg) : rgb(g.labelBg);
                expect(contrast(rgb(g.labelFg), bg), `${g.name} label contrast`).toBeGreaterThanOrEqual(4.5);
            }

            const tile = await frame.evaluate(() => {
                const t = document.querySelector('.ct-score-tile');
                const v = t.querySelector('.ct-score-value');
                return { tileBg: getComputedStyle(t).backgroundColor, value: getComputedStyle(v).color, body: getComputedStyle(document.body).color, cardBg: getComputedStyle(t.closest('.pf-v6-c-card')).backgroundColor, cls: v.className + ' ' + t.className };
            });
            expect(tile.value, 'score number uses the regular text color').toBe(tile.body);
            expect(tile.tileBg, 'score tile is tinted').not.toBe(tile.cardBg);
            expect(tile.cls).not.toMatch(/green|gold|red|success|warning|danger/);
            await page.screenshot({ path: path.join(__dirname, 'screenshots', `v46-phase2-${theme.name}.png`), fullPage: true });
            await ctx.close();
        });
    }
});
