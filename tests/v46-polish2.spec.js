// V4.6 polish batch 2 (Peter's 2026-10-15 afternoon review), INSIDE the
// Cockpit shell (/scap-dev), both browser projects.
// W1: the policy editor says "modified" for every change count; the
//     Variables header reads like the Rules header ("Variables  165 · 1
//     modified", no parentheses).
// E4: the editor card's side borders stay continuous beside the sticky
//     action bar, in place and stuck, light and dark.
// R2: the results row's Remediation Builder content is centered in its
//     tinted panel (accent bar + tint unchanged), 1440x900 and 1024x640 @1.25.
// C2: SCAP Content Source reads plain "Installed": no tooltip, no underline.
// One real CIS L1 scan (deleted afterwards); no policy is saved.
const { test, expect } = require('@playwright/test');
const { PNG } = require('playwright-core/lib/utilsBundle');
const { openModuleInShell } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

const SHOTS = 'tests/test-results/v46-polish2';
let page, frame, before, tmpBefore, mine;

// Builder panel tint + accent bar as computed on 744d127 (light theme,
// 1440x900), recorded before the R2 change. R2 is alignment only.
const BUILDER_LOOK_744D127 = {
    chromium: { borderLeft: '3px solid rgb(0, 102, 204)', background: 'color(srgb 0.93 0.958 0.986)' },
    firefox: { borderLeft: '3px solid rgb(0, 102, 204)', background: 'color(srgb 0.93 0.958 0.986)' },
};

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    before = await S.snapshotScans(frame);
    tmpBefore = await S.snapshotTmp(frame);
});

test.afterAll(async () => {
    if (frame) await S.cleanupCreated(frame, before, tmpBefore);
    await page?.close();
});

const editorOf = f => f.locator('.ct-tailor-editor-card');
const barOf = f => editorOf(f).locator('[data-ct-tailor-actionbar]');
const editor = () => editorOf(frame);
const bar = () => barOf(frame);
const rulesToggle = () => editor().locator('#ct-tailor-rules-title-toggle');
const varsToggle = () => editor().locator('#ct-tailor-values-title-toggle');
const changeCount = () => bar().locator('.ct-tailor-change-count');
const summarySub = () => editor().locator('.ct-tailor-summary .ct-tailor-section-head .ct-tailor-section-desc');

async function loadNew(f) {
    await f.getByRole('tab', { name: 'Policy Tailoring' }).click();
    await f.locator('#ct-tailor-content-select').selectOption(S.DS);
    await expect(f.locator('#ct-tailor-profile-select')).toBeEnabled({ timeout: 60000 });
    await f.locator('#ct-tailor-profile-select').selectOption(S.PROFILE_L1);
    await editorOf(f).getByRole('button', { name: 'Load Rules' })
            .click();
    await expect(barOf(f)).toBeVisible({ timeout: 120000 });
}

// Toggles the i-th rule (its own checkbox, not a group's) among the "aide" matches.
async function toggleAideRule(i) {
    const search = editor().getByRole('textbox', { name: 'Search rules' });
    await search.fill('aide');
    const titles = await editor().locator('.ct-tailor-tree .ct-tailor-rule-title')
            .allInnerTexts();
    await editor().getByRole('checkbox', { name: titles[i], exact: true })
            .click();
    await search.fill('');
}

async function changeFirstVariable() {
    if (await varsToggle().getAttribute('aria-expanded') !== 'true') await varsToggle().click();
    const ctl = editor().locator('.ct-tailor-values-grid')
            .locator('select, input')
            .first();
    if (await ctl.evaluate(e => e.tagName) === 'SELECT') {
        const values = await ctl.locator('option').evaluateAll(os => os.map(o => o.value));
        const cur = await ctl.inputValue();
        await ctl.selectOption(values.find(v => v !== cur));
    } else {
        await ctl.fill((await ctl.inputValue()) + '1');
    }
}

test('W1: Variables header reads like Rules, every count says "modified"', async ({ browserName }) => {
    await loadNew(frame);
    await expect(rulesToggle()).toHaveText(/^Rules\s+\d+ of \d+ selected · 0 modified$/);
    await expect(varsToggle()).toHaveText(/^Variables\s+\d+ · 0 modified$/);
    await expect(varsToggle()).not.toContainText('(');
    // Same structure and the same plain subtle count text as Rules.
    for (const t of [rulesToggle(), varsToggle()]) {
        await expect(t.locator('.ct-tailor-section-title')).toHaveCount(1);
        await expect(t.locator('.ct-tailor-section-counts')).toHaveCount(1);
    }
    await expect(varsToggle().locator('.ct-tailor-section-title')).toHaveText('Variables');
    await expect(varsToggle().locator('.ct-tailor-section-counts')).toHaveText(/^\d+ · 0 modified$/);
    const look = t => t.locator('.ct-tailor-section-counts').evaluate(el => {
        const cs = getComputedStyle(el);
        return { color: cs.color, size: cs.fontSize, weight: cs.fontWeight, family: cs.fontFamily, cls: el.className };
    });
    expect(await look(varsToggle())).toEqual(await look(rulesToggle()));

    await expect(changeCount()).toHaveText('No changes yet');
    await expect(summarySub()).toHaveText('No changes from the base profile yet.');

    await toggleAideRule(0);
    await expect(changeCount()).toHaveText('1 rule, 0 variables modified');
    await expect(summarySub()).toHaveText('1 rule, 0 variables modified');
    await changeFirstVariable();
    await expect(changeCount()).toHaveText('1 rule, 1 variable modified');
    await expect(summarySub()).toHaveText('1 rule, 1 variable modified');
    await expect(rulesToggle()).toHaveText(/^Rules\s+\d+ of \d+ selected · 1 modified$/);
    await expect(varsToggle()).toHaveText(/^Variables\s+\d+ · 1 modified$/);
    await expect(editor().getByRole('heading', { name: 'Changes from base profile' })).toBeVisible();

    // Both headers in one shot: fold Rules for the screenshot.
    await rulesToggle().click();
    await rulesToggle().evaluate(el => el.scrollIntoView({ block: 'center' }));
    await page.mouse.move(0, 0); // no hover band in the shot
    await page.screenshot({ path: `${SHOTS}/editor-headers-1-rule-1-variable-${browserName}.png` });
    await rulesToggle().click();
    await expect(rulesToggle()).toHaveAttribute('aria-expanded', 'true');

    await toggleAideRule(1);
    await expect(changeCount()).toHaveText('2 rules, 1 variable modified');
    await expect(summarySub()).toHaveText('2 rules, 1 variable modified');
    await expect(rulesToggle()).toHaveText(/^Rules\s+\d+ of \d+ selected · 2 modified$/);
    expect(await editor().innerText(), 'no "changed" count left in the editor').not.toMatch(/\bchanged\b/i);
});

/* E4 pixel check: 1 px rows across the card's left and right edges at the
 * action bar's vertical middle must look exactly like the same rows lower
 * down the card (where nothing covers the border), and contain the border
 * color. Without the fix the bar row shows the bar background instead. */
async function borderBesideBar(pg, f, label) {
    const ifr = await pg.locator('iframe[name^="cockpit1:localhost/scap-dev"]').boundingBox();
    const g = await f.evaluate(() => {
        const card = document.querySelector('.ct-tailor-editor-card');
        const bar = card.querySelector('[data-ct-tailor-actionbar]');
        const b = bar.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        const pseudo = getComputedStyle(card, '::before');
        return {
            left: c.left,
            right: c.right,
            barMid: b.top + b.height / 2,
            barBottom: b.bottom,
            color: pseudo.borderLeftColor,
            z: pseudo.zIndex,
            barZ: getComputedStyle(bar).zIndex,
        };
    });
    console.log(`E4 ${label}: ${JSON.stringify(g)}`);
    const strip = async (x, y) => {
        const buf = await pg.screenshot({ clip: { x: ifr.x + x - 4, y: ifr.y + Math.round(y), width: 8, height: 1 }, scale: 'css' });
        const png = PNG.sync.read(buf);
        const px = [];
        for (let i = 0; i < png.width; i++) px.push([...png.data.slice(i * 4, i * 4 + 3)]);
        return px;
    };
    const want = (g.color.match(/\d+(\.\d+)?/g) || []).slice(0, 3)
            .map(Number);
    const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
    const refY = g.barBottom + 24;
    for (const [side, x] of [['left', g.left], ['right', g.right]]) {
        const atBar = await strip(x, g.barMid);
        const below = await strip(x, refY);
        expect.soft(atBar.every((p, i) => near(p, below[i], 6)),
                    `${label} ${side}: edge at the bar ${JSON.stringify(atBar)} == edge below it ${JSON.stringify(below)}`).toBe(true);
        expect.soft(atBar.some(p => near(p, want, 24)), `${label} ${side}: border color ${g.color} beside the bar ${JSON.stringify(atBar)}`).toBe(true);
    }
    expect(Number(g.z), `${label}: card border drawn above the bar`).toBeGreaterThan(Number(g.barZ));
    return g;
}

async function stickBar(f) {
    await editorOf(f).getByRole('heading', { name: 'Changes from base profile' })
            .evaluate(el => el.scrollIntoView({ block: 'start' }));
    await expect.poll(() => barOf(f).evaluate(el => Math.round(el.getBoundingClientRect().top))).toBeGreaterThanOrEqual(-1);
    const pos = await f.evaluate(() => ({
        bar: document.querySelector('[data-ct-tailor-actionbar]').getBoundingClientRect().top,
        card: document.querySelector('.ct-tailor-editor-card').getBoundingClientRect().top,
    }));
    expect(Math.round(pos.bar), 'bar stuck at the top (E3)').toBeLessThanOrEqual(5);
    expect(pos.card, 'card top scrolled away above the stuck bar').toBeLessThan(-50);
}

test('E4 light: card border continuous beside the action bar, in place and stuck', async ({ browserName }) => {
    if (await bar().count() === 0) await loadNew(frame);
    await editor().evaluate(el => el.scrollIntoView({ block: 'start' }));
    await borderBesideBar(page, frame, 'light in place');
    await page.screenshot({ path: `${SHOTS}/editor-bar-in-place-light-${browserName}.png` });
    await stickBar(frame);
    await borderBesideBar(page, frame, 'light stuck');
    await page.screenshot({ path: `${SHOTS}/editor-bar-stuck-light-${browserName}.png` });
    // The bar stays clickable under the raised border: Cancel -> discard.
    await bar().getByRole('button', { name: 'Cancel' })
            .click();
    const discard = frame.getByRole('dialog').getByRole('button', { name: 'Discard changes' });
    if (await discard.waitFor({ timeout: 3000 }).then(() => true, () => false)) await discard.click();
    await expect(bar()).toHaveCount(0);
});

test('E4 dark: card border continuous beside the action bar, in place and stuck', async ({ browser, browserName }) => {
    const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    try {
        const f2 = await openModuleInShell(p2);
        await expect(f2.locator('html')).toHaveClass(/pf-v6-theme-dark/);
        await loadNew(f2);
        await editorOf(f2).evaluate(el => el.scrollIntoView({ block: 'start' }));
        await borderBesideBar(p2, f2, 'dark in place');
        await p2.screenshot({ path: `${SHOTS}/editor-bar-in-place-dark-${browserName}.png` });
        await stickBar(f2);
        await borderBesideBar(p2, f2, 'dark stuck');
        await p2.screenshot({ path: `${SHOTS}/editor-bar-stuck-dark-${browserName}.png` });
        await barOf(f2).getByRole('button', { name: 'Cancel' })
                .click();
        await expect(barOf(f2)).toHaveCount(0);
    } finally {
        await p2.close();
    }
});

/* R2: horizontal center of what each Builder child actually draws (text
 * extent for the title and the line, union of the labels and of the
 * buttons) vs the panel's content-box center. */
async function builderGeometry(f) {
    return f.locator('[data-ct-results] .ct-builder-panel').evaluate(p => {
        const cs = getComputedStyle(p);
        const r = p.getBoundingClientRect();
        const left = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
        const right = r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
        const textBox = el => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect() };
        const union = els => {
            const rs = [...els].map(e => e.getBoundingClientRect());
            return { left: Math.min(...rs.map(x => x.left)), right: Math.max(...rs.map(x => x.right)) };
        };
        const kids = {
            title: textBox(p.querySelector('.pf-v6-c-title')),
            line: textBox(p.querySelector('.ct-results-sub')),
            buttons: union(p.querySelectorAll('.ct-builder-actions .pf-v6-c-button')),
        };
        const labels = p.querySelectorAll('.pf-v6-c-label-group .pf-v6-c-label');
        if (labels.length) kids.badges = union(labels);
        const centers = Object.fromEntries(Object.entries(kids).map(([k, b]) => [k, (b.left + b.right) / 2]));
        return {
            center: (left + right) / 2,
            width: r.width,
            centers,
            borderLeft: `${cs.borderLeftWidth} ${cs.borderLeftStyle} ${cs.borderLeftColor}`,
            background: cs.backgroundColor,
        };
    });
}

function expectCentered(g, label) {
    for (const [k, c] of Object.entries(g.centers)) {
        expect.soft(Math.abs(c - g.center), `${label} ${k}: center ${c.toFixed(1)} vs panel ${g.center.toFixed(1)}`).toBeLessThanOrEqual(4);
    }
}

test('R2 1440x900: Builder content centered in its third, tint + accent bar unchanged', async ({ browserName }) => {
    await frame.getByRole('tab', { name: 'Host Scan' }).click();
    await S.runScan(frame, { profileId: S.PROFILE_L1 });
    mine = (await S.snapshotScans(frame)).filter(ts => !before.includes(ts))[0];
    const zones = frame.locator('[data-ct-results] .ct-results-zones');
    await zones.scrollIntoViewIfNeeded();
    const g = await builderGeometry(frame);
    console.log(`R2 ${browserName} 1440: ${JSON.stringify(g)}`);
    expect(g.centers.badges, 'severity badges present on this host').toBeDefined();
    expectCentered(g, '1440x900');
    // Still the third column, not full width.
    const zr = await zones.boundingBox();
    expect(g.width / zr.width).toBeLessThan(0.4);
    expect.soft(g.borderLeft).toBe(BUILDER_LOOK_744D127[browserName].borderLeft);
    expect.soft(g.background).toBe(BUILDER_LOOK_744D127[browserName].background);
    await page.screenshot({ path: `${SHOTS}/results-1440x900-${browserName}.png` });
});

test('R2 1024x640 @1.25: full-width Builder, content centered', async ({ browser, browserName }) => {
    const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 });
    try {
        const f2 = await openModuleInShell(p2);
        await p2.setViewportSize({ width: 1024, height: 640 });
        const row = f2.getByRole('grid', { name: 'Scan history' }).locator('tbody tr')
                .filter({ hasText: mine.slice(0, 10) + ' ' + mine.slice(11).replace(/-/g, ':') });
        await row.getByRole('button', { name: 'View', exact: true }).click();
        const zones = f2.locator('[data-ct-results] .ct-results-zones');
        await zones.waitFor();
        await f2.locator('[data-ct-results] .ct-builder-panel').scrollIntoViewIfNeeded();
        const g = await builderGeometry(f2);
        console.log(`R2 ${browserName} 1024@1.25: ${JSON.stringify(g)}`);
        const zr = await zones.boundingBox();
        expect(g.width / zr.width, 'Builder full width under score + counts').toBeGreaterThan(0.98);
        expectCentered(g, '1024x640@1.25');
        expect.soft(g.borderLeft).toBe(BUILDER_LOOK_744D127[browserName].borderLeft);
        expect.soft(g.background).toBe(BUILDER_LOOK_744D127[browserName].background);
        await p2.screenshot({ path: `${SHOTS}/results-1024x640@125-${browserName}.png` });
    } finally {
        await p2.close();
    }
});

test('C2: SCAP Content Source reads plain "Installed", no tooltip, no underline', async ({ browserName }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
    const card = frame.locator('#ct-scap-content-card');
    const ssg = card.locator('tbody tr').filter({ hasText: 'ssg-rhel10-ds.xml' });
    await expect(ssg).toHaveCount(1);
    const source = ssg.locator('td').nth(1);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/content-card-${browserName}.png` });
    await expect(source).toHaveText('Installed');
    await expect(card).not.toContainText('Included');
    await expect(source.locator('[tabindex], .ct-included-source')).toHaveCount(0);
    const deco = await source.evaluate(td => [td, ...td.querySelectorAll('*')].map(e => getComputedStyle(e).textDecorationLine));
    for (const d of deco) expect(d).toBe('none');
    await source.hover();
    await page.waitForTimeout(800);
    await expect(frame.getByRole('tooltip')).toHaveCount(0);
    await page.mouse.move(0, 0);
});
