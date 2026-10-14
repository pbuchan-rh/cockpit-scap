// V4.6 Phase 3: Results page (spec B) and the Remediation Builder drawer
// (spec C), INSIDE the Cockpit shell (/scap-dev), both browser projects.
// Runs one CIS L1 scan, checks the results structure, search, rule detail,
// footer, the drawer (presets, counts, search, downloads), and a saved
// scan whose manifest predates rule_meta (results-file header/details).
const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

let page, frame, before, tmpBefore, home;

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    home = await S.homeDir(frame);
    before = await S.snapshotScans(frame);
    tmpBefore = await S.snapshotTmp(frame);
    await S.runScan(frame, { profileId: S.PROFILE_L1 });
});

test.afterAll(async () => {
    if (frame) await S.cleanupCreated(frame, before, tmpBefore);
    await page?.close();
});

test('header: label, profile, date; duration and content + SSG version', async () => {
    const header = frame.locator('[data-ct-results] .ct-results-header');
    await expect(header.locator('.ct-results-label')).toHaveText(/host scan results/i);
    await expect(header.locator('.ct-results-profile')).toHaveText('CIS Red Hat Enterprise Linux 10 Benchmark for Level 1 - Server');
    await expect(header.locator('.ct-results-heading .ct-results-sub')).toHaveText(/\d{4}/);
    await expect(header.locator('.ct-results-meta')).toContainText(/Duration \d+/);
    await expect(header.locator('.ct-results-meta')).toContainText(/SSG \d+\.\d+\.\d+/);
});

test('three zones: score | summary | builder panel, divided; one primary', async () => {
    const results = frame.locator('[data-ct-results]');
    const zones = results.locator('.ct-results-zones');
    await expect(zones.locator('.ct-score-tile')).toContainText('%');
    await expect(zones.locator('.ct-results-summary-line')).toHaveText(/^\d+ passed · \d+ failed · \d+ n\/a · \d+ errors$/);
    await expect(zones.locator('> .pf-v6-c-divider')).toHaveCount(2);
    const panel = zones.locator('.ct-builder-panel');
    await expect(panel).toContainText('Remediation Builder');
    await expect(panel).toContainText(/\d+ critical\/high rules? can be auto-remediated/);
    await expect(panel.getByRole('button', { name: /^Critical & high \(\d+\)$/ })).toHaveClass(/pf-m-primary/);
    await expect(panel.getByRole('button', { name: /^All failures \(\d+\)$/ })).toHaveClass(/pf-m-secondary/);
    await expect(results.locator('.pf-v6-c-button.pf-m-primary')).toHaveCount(1);
    const tint = await panel.evaluate(el => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, accent: cs.borderInlineStartWidth, card: getComputedStyle(el.closest('.pf-v6-c-card')).backgroundColor };
    });
    expect(tint.bg).not.toBe(tint.card);
    expect(parseFloat(tint.accent)).toBeGreaterThanOrEqual(2);
});

test('rule groups: high expanded, others and n/a collapsed, no checkboxes', async () => {
    const results = frame.locator('[data-ct-results]');
    const high = results.locator('.ct-failing-group-high');
    await expect(high.locator('.ct-rule-item').first()).toBeVisible();
    await expect(results.locator('.ct-failing-group-medium .ct-rule-item')).toHaveCount(0);
    await expect(results.locator('.ct-failing-group-notapplicable')).toBeVisible();
    await expect(results.locator('.ct-failing-group-notapplicable .ct-rule-item')).toHaveCount(0);
    await expect(results.locator('input[type=checkbox]')).toHaveCount(0);
    // CCE on the second line, Automated/Manual tag on the right.
    const row = high.locator('.ct-rule-row').first();
    await expect(row.locator('.ct-rule-cce')).toHaveText(/^CCE-/);
    await expect(row.locator('.ct-rule-tag')).toHaveText(/Automated|Manual/);
    // Rows are divided.
    expect(await high.locator('.pf-v6-c-divider.ct-rule-divider').count()).toBeGreaterThan(0);
});

test('search expands matching groups, hides the rest; clearing restores', async () => {
    const results = frame.locator('[data-ct-results]');
    const search = results.getByRole('textbox', { name: 'Search rules' });
    await search.fill('pam_faillock');
    await expect(results.locator('.ct-failing-group-medium .ct-rule-item').first()).toBeVisible();
    await expect(results.locator('.ct-failing-group-high')).toHaveCount(0);
    const titles = await results.locator('.ct-rule-item').allInnerTexts();
    expect(titles.length).toBeGreaterThan(0);
    await search.fill('zz-no-such-rule-zz');
    await expect(results.locator('.ct-no-match')).toBeVisible();
    await results.getByRole('button', { name: 'Reset' }).click();
    await expect(results.locator('.ct-failing-group-high .ct-rule-item').first()).toBeVisible();
    await expect(results.locator('.ct-failing-group-medium .ct-rule-item')).toHaveCount(0);
});

test('expanded rule: tinted detail, code, framework chips, remediation script', async () => {
    const results = frame.locator('[data-ct-results]');
    await results.locator('.ct-failing-group-medium').getByRole('button', { name: /Medium/ })
            .first()
            .click();
    const item = results.locator('.ct-failing-group-medium .ct-rule-item').filter({ hasText: 'Automated' })
            .first();
    await item.locator('.ct-rule-row').click();
    const detail = item.locator('.ct-rule-detail');
    await expect(detail).toBeVisible();
    const bg = await detail.evaluate(el => [getComputedStyle(el).backgroundColor, getComputedStyle(el.closest('.pf-v6-c-card')).backgroundColor]);
    expect(bg[0]).not.toBe(bg[1]);
    await expect(detail.locator('.ct-rule-refs .pf-v6-c-label').first()).toBeVisible();
    await expect(detail.locator('.ct-rule-refs')).toContainText(/CIS|NIST|PCI-DSS|DISA/);
    await detail.getByRole('button', { name: 'Remediation script' }).click();
    await expect(detail.locator('pre.ct-rule-rem-pre')).toContainText('BEGIN fix', { timeout: 60000 });
    const dl = await S.expectDownload(page, () => detail.getByRole('button', { name: 'Download .sh' }).click());
    expect(dl.filename).toMatch(/^fix-.*\.sh$/);
    // R12: some rule shows inline commands as code.
    expect(await results.locator('.ct-rule-detail code.ct-inline-code').count()).toBeGreaterThan(0);
});

test('drawer: Critical & high preset, counts, group select, search, downloads', async () => {
    const panelBtn = frame.locator('[data-ct-results] .ct-builder-panel').getByRole('button', { name: /^Critical & high/ });
    const n = Number((await panelBtn.innerText()).match(/\((\d+)\)/)[1]);
    const drawer = await S.openBuilder(frame, 'critical');
    await expect(drawer.locator('.ct-builder-context')).toContainText('Profile');
    await expect(drawer.locator('.ct-builder-context')).toContainText('Scanned');
    const total = Number((await frame.locator('[data-ct-results] .ct-builder-panel').getByRole('button', { name: /^All failures/ })
            .innerText()).match(/\((\d+)\)/)[1]);
    await expect(drawer.locator('.ct-builder-count')).toHaveText(`${n} of ${total} rules selected`);
    await expect(drawer.locator('input[type=checkbox]:checked')).toHaveCount(n);
    await expect(drawer.locator('.ct-builder-group-high .ct-builder-group-count')).toHaveText(/\d+ of \d+ selected/);

    // Per-group select all.
    const medium = drawer.locator('.ct-builder-group-medium');
    const mTotal = Number((await medium.locator('.ct-builder-group-count').innerText()).match(/of (\d+)/)[1]);
    await medium.getByRole('button', { name: 'Select all' }).click();
    await expect(medium.locator('.ct-builder-group-count')).toHaveText(`${mTotal} of ${mTotal} selected`);
    await expect(drawer.locator('.ct-builder-count')).toContainText(`${n + mTotal} of ${total}`);
    await medium.getByRole('button', { name: 'Deselect all' }).click();
    await expect(drawer.locator('.ct-builder-count')).toHaveText(`${n} of ${total} rules selected`);

    // Search filters rules but not the selection.
    await drawer.locator('.ct-builder-search input').fill('sshd');
    expect(await drawer.locator('.ct-builder-rule').count()).toBeGreaterThan(0);
    for (const t of await drawer.locator('.ct-builder-rule').allInnerTexts()) expect(t.toLowerCase()).toContain('ssh');
    await drawer.locator('.ct-builder-search input').fill('');

    for (const fixType of ['bash', 'ansible']) {
        const dl = await S.builderDownload(page, frame, fixType);
        expect(dl.filename).toMatch(new RegExp(`-${n}-rules\\.${fixType === 'bash' ? 'sh' : 'yml'}$`));
        if (fixType === 'bash') expect((dl.text.match(/^# BEGIN fix/gm) || []).length).toBe(n);
    }
    await expect(drawer.getByRole('button', { name: /Apply/ })).toHaveCount(0);
    await S.closeBuilder(frame);
});

test('footer: View report, Download menu, Close set apart', async () => {
    const footer = frame.locator('[data-ct-results] .ct-results-footer');
    await expect(footer.getByRole('button', { name: 'View report' })).toBeVisible();
    await footer.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(frame.getByRole('menuitem')).toHaveText([/HTML report/, /Results XML/, /ARF/]);
    await page.keyboard.press('Escape');
    const close = footer.getByRole('button', { name: 'Close', exact: true });
    const [vr, cl] = await Promise.all([footer.getByRole('button', { name: 'View report' }).boundingBox(), close.boundingBox()]);
    const footerBox = await footer.boundingBox();
    expect(cl.x - vr.x).toBeGreaterThan(footerBox.width / 2);
    await expect(frame.locator('[data-ct-results]').getByRole('button', { name: /New Scan/i })).toHaveCount(0);
});

test('a saved scan without rule_meta still gets header, titles and chips', async () => {
    // Copy this spec's own scan into a new history entry whose manifest
    // looks like a pre-V4.2 one (no rule_meta, no base_profile_id).
    const mine = (await S.snapshotScans(frame)).filter(ts => !before.includes(ts));
    expect(mine.length).toBe(1);
    const src = `${home}/SCAP/scans/${mine[0]}`;
    const ts = '2099-01-01T00-00-00';
    const dst = `${home}/SCAP/scans/${ts}`;
    await hostSpawn(frame, ['cp', '-a', src, dst]);
    await frame.evaluate(async ({ dst, ts }) => {
        const f = window.cockpit.file(`${dst}/manifest.json`);
        const m = JSON.parse(await f.read());
        delete m.rule_meta;
        delete m.base_profile_id;
        m.timestamp = ts;
        await f.replace(JSON.stringify(m, null, 2));
    }, { dst, ts });
    await frame.locator('[data-ct-results]').getByRole('button', { name: 'Close', exact: true })
            .click();
    await page.reload();
    const iframe = page.locator('iframe[name^="cockpit1:localhost/scap-dev"]');
    frame = await (await iframe.elementHandle()).contentFrame();
    const row = frame.locator('tbody tr').first();
    await expect(row).toContainText('2099');
    await row.getByRole('button', { name: /^View/ }).click();
    const results = frame.locator('[data-ct-results]');
    await expect(results.locator('.ct-results-meta')).toContainText(/SSG \d/);
    const item = results.locator('.ct-failing-group-high .ct-rule-item').first();
    await expect(item.locator('.ct-rule-title')).not.toHaveText(/^[a-z0-9_]+$/);
    await item.locator('.ct-rule-row').click();
    await expect(item.locator('.ct-rule-refs')).toBeVisible();
    await results.getByRole('button', { name: 'Close', exact: true }).click();
});
