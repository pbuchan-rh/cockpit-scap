// V4.6 polish batch 1, R1 + H1, INSIDE the Cockpit shell (/scap-dev), both
// browser projects. One real CIS L1 scan; the results summary row is three
// equal, divided thirds (score | PASSED/FAILED/ERRORS tiles | Remediation
// Builder) at 1440x900, score + counts over a full-width Builder at
// 1024x640 @1.25, stacked at 375 px. H1: both Download menus list exactly
// HTML report / Results XML / ARF, with no description line.
const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

const SHOTS = 'tests/test-results/v46-polish';
let page, frame, before, tmpBefore, home, mine;

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    home = await S.homeDir(frame);
    before = await S.snapshotScans(frame);
    tmpBefore = await S.snapshotTmp(frame);
    await S.runScan(frame, { profileId: S.PROFILE_L1 });
    mine = (await S.snapshotScans(frame)).filter(ts => !before.includes(ts))[0];
});

test.afterAll(async () => {
    if (frame) await S.cleanupCreated(frame, before, tmpBefore);
    await page?.close();
});

const zones = () => frame.locator('[data-ct-results] .ct-results-zones');

// Border boxes of the score zone, the counts zone and the Builder panel.
async function zoneBoxes() {
    return zones().evaluate(z => ['.ct-results-zone-score', '.ct-results-zone-summary', '.ct-builder-panel'].map(sel => {
        const r = z.querySelector(sel).getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
    }));
}

async function noHorizontalScroll() {
    const o = await frame.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(o.sw, 'no horizontal page scroll').toBeLessThanOrEqual(o.cw + 1);
}

// Counts straight from the scan's results file.
async function fileCounts() {
    const xml = await hostSpawn(frame, ['sh', '-c', `zcat "${home}/SCAP/scans/${mine}/results.xml.gz"`]);
    const n = kind => (xml.match(new RegExp(`<(?:\\w+:)?result>${kind}</(?:\\w+:)?result>`, 'g')) || []).length;
    return { pass: n('pass'), fail: n('fail'), error: n('error'), notapplicable: n('notapplicable'), notchecked: n('notchecked') };
}

test('1440x900: three equal thirds, divided, tiles match the results file', async ({ browserName }) => {
    await zones().scrollIntoViewIfNeeded();
    const [score, counts, builder] = await zoneBoxes();
    const widths = [score.w, counts.w, builder.w];
    const avg = widths.reduce((a, b) => a + b) / 3;
    for (const w of widths) expect(Math.abs(w - avg) / avg, `zone widths ${widths.map(Math.round)}`).toBeLessThanOrEqual(0.02);
    expect(Math.abs(score.y - counts.y)).toBeLessThan(2);
    expect(Math.abs(counts.y - builder.y)).toBeLessThan(2);
    expect(counts.x).toBeGreaterThan(score.x + score.w);
    expect(builder.x).toBeGreaterThan(counts.x + counts.w);
    // Two vertical dividers between them.
    const dividers = zones().locator('> .pf-v6-c-divider');
    await expect(dividers).toHaveCount(2);
    for (const d of await dividers.all()) {
        const b = await d.boundingBox();
        expect(b.height, 'divider is vertical').toBeGreaterThan(b.width);
    }

    // Tiles: the running view's classes and colors, real counts.
    const want = await fileCounts();
    const summary = zones().locator('.ct-results-zone-summary');
    for (const [kind, label] of [['pass', 'Passed'], ['fail', 'Failed'], ['error', 'Errors']]) {
        const tile = summary.locator(`.ct-live-tile-${kind}`);
        await expect(tile.locator('.ct-live-tile-label')).toHaveText(label);
        await expect(tile.locator('.ct-live-tile-num')).toHaveText(String(want[kind]));
    }
    const other = summary.locator('.ct-results-other-counts');
    await expect(other).toHaveText(want.notchecked > 0
        ? `${want.notapplicable} n/a · ${want.notchecked} not checked`
        : `${want.notapplicable} n/a`);
    const look = await summary.evaluate(s => {
        const cs = el => getComputedStyle(el);
        const o = s.querySelector('.ct-results-other-counts');
        const num = s.querySelector('.ct-live-tile-num');
        return {
            otherSize: parseFloat(cs(o).fontSize),
            numSize: parseFloat(cs(num).fontSize),
            otherColor: cs(o).color,
            body: cs(document.body).color,
            pass: cs(s.querySelector('.ct-live-tile-pass .ct-live-tile-num')).color,
            fail: cs(s.querySelector('.ct-live-tile-fail .ct-live-tile-num')).color
        };
    });
    expect(look.otherSize, 'n/a line is small').toBeLessThanOrEqual(look.numSize * 0.6);
    expect(look.otherColor, 'n/a line is subtle').not.toBe(look.body);
    expect(look.pass).not.toBe(look.fail);

    // Score tile scaled to its third; Builder buttons on one line.
    const tile = await zones().locator('.ct-score-tile')
            .boundingBox();
    expect(tile.width / score.w, 'score tile fills a good part of its third').toBeGreaterThan(0.5);
    const btns = await zones().locator('.ct-builder-actions .pf-v6-c-button')
            .all();
    expect(btns).toHaveLength(2);
    const [b1, b2] = [await btns[0].boundingBox(), await btns[1].boundingBox()];
    expect(Math.abs(b1.y - b2.y), 'both Builder buttons on one line').toBeLessThan(2);
    // No gray band: the zones row has no background of its own.
    expect(await zones().evaluate(z => getComputedStyle(z).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: `${SHOTS}/results-1440x900-${browserName}.png` });
});

test('H1: results Download menu is HTML report / Results XML / ARF, no description', async ({ browserName }) => {
    const footer = frame.locator('[data-ct-results] .ct-results-footer');
    await footer.scrollIntoViewIfNeeded();
    await footer.getByRole('button', { name: 'Download', exact: true }).click();
    const items = frame.getByRole('menuitem');
    await expect(items).toHaveText(['HTML report', 'Results XML', 'ARF']);
    await expect(frame.locator('.pf-v6-c-menu__item-description')).toHaveCount(0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/menu-results-download-${browserName}.png` });
    await page.keyboard.press('Escape');
    await expect(items).toHaveCount(0);
});

test('375 phone: zones stack, no horizontal scroll', async ({ browserName }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await zones().scrollIntoViewIfNeeded();
    const [score, counts, builder] = await zoneBoxes();
    expect(counts.y).toBeGreaterThanOrEqual(score.y + score.h);
    expect(builder.y).toBeGreaterThanOrEqual(counts.y + counts.h);
    const width = await frame.evaluate(() => document.documentElement.clientWidth);
    for (const z of [score, counts, builder]) expect(z.x + z.w).toBeLessThanOrEqual(width + 1);
    await noHorizontalScroll();
    await page.screenshot({ path: `${SHOTS}/results-phone-375-${browserName}.png`, fullPage: false });
    await page.setViewportSize({ width: 1440, height: 900 });
});

test('H1: history Download menu is HTML report / Results XML / ARF, no description', async ({ browserName }) => {
    await frame.locator('[data-ct-results]').getByRole('button', { name: 'Close', exact: true })
            .click();
    const table = frame.getByRole('grid', { name: 'Scan history' });
    const row = table.locator('tbody tr').filter({ hasText: mine.slice(0, 10) + ' ' + mine.slice(11).replace(/-/g, ':') });
    await row.scrollIntoViewIfNeeded();
    await row.getByRole('button', { name: /^Download scan from/ }).click();
    const items = frame.getByRole('menuitem');
    await expect(items).toHaveText(['HTML report', 'Results XML', 'ARF']);
    await expect(frame.locator('.pf-v6-c-menu__item-description')).toHaveCount(0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/menu-history-download-${browserName}.png` });
    await page.keyboard.press('Escape');
});

test('1024x640 @1.25: score + counts side by side, Builder full width under them', async ({ browser, browserName }) => {
    const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 });
    try {
        const f2 = await openModuleInShell(p2);
        await p2.setViewportSize({ width: 1024, height: 640 });
        const row = f2.getByRole('grid', { name: 'Scan history' }).locator('tbody tr')
                .filter({ hasText: mine.slice(0, 10) + ' ' + mine.slice(11).replace(/-/g, ':') });
        await row.getByRole('button', { name: 'View', exact: true }).click();
        const z = f2.locator('[data-ct-results] .ct-results-zones');
        await z.waitFor();
        await z.scrollIntoViewIfNeeded();
        const [score, counts, builder] = await z.evaluate(el => ['.ct-results-zone-score', '.ct-results-zone-summary', '.ct-builder-panel'].map(sel => {
            const r = el.querySelector(sel).getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
        }));
        const zr = await z.boundingBox();
        expect(Math.abs(score.y - counts.y), 'score and counts on one row').toBeLessThan(2);
        expect(Math.abs(score.w - counts.w) / counts.w, 'score and counts equal halves').toBeLessThanOrEqual(0.02);
        expect(builder.y).toBeGreaterThanOrEqual(Math.max(score.y + score.h, counts.y + counts.h));
        expect(builder.w / zr.width, 'Builder full width').toBeGreaterThan(0.98);
        const o = await f2.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(o.sw).toBeLessThanOrEqual(o.cw + 1);
        await p2.screenshot({ path: `${SHOTS}/results-1280x800@125-${browserName}.png` });
    } finally {
        await p2.close();
    }
});
