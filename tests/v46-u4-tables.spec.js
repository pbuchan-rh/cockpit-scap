// UAT batch 1, U4: no table is ever wider than its card and every row's
// actions are visible and reachable, at browser windows of 1024, 1100,
// 1280, 1440 and 1920 px (Cockpit shell with its sidebar) and on a 390 px
// phone. INSIDE the Cockpit shell (/scap-dev), both browser projects,
// light and dark. Fixtures (removed again by cleanupCreated): two
// fabricated scans with a long profile title and four-digit counts, the
// v46-test tailoring policy, and an uploaded copy of the RHEL 10
// datastream (~/SCAP/content/v46-test-wide-ds.xml), so every table has
// worst-case rows on any host.
const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn } = require('./helpers/cockpit');
const S = require('./helpers/scap');

// Not serial: a failing size must not hide the others (a failure restarts
// the worker; each describe makes and removes its own fixtures).

const SIZES = [
    { name: 'w1024', width: 1024, height: 900, shot: true },
    { name: 'w1100', width: 1100, height: 900 },
    { name: 'w1280', width: 1280, height: 900, shot: true },
    { name: 'w1440', width: 1440, height: 900 },
    { name: 'w1920', width: 1920, height: 1080, shot: true },
    { name: 'phone', width: 390, height: 844, shot: true },
];
const TABLES = [
    { key: 'history', tab: 'Host Scan', label: 'Scan history' },
    { key: 'tailoring', tab: 'Policy Tailoring', label: 'Saved tailoring policies' },
    { key: 'content', tab: 'Policy Tailoring', label: 'SCAP content' },
];
const LONG_TITLE = 'v46-test CIS Red Hat Enterprise Linux 10 Benchmark for Level 2 - Server, tailored for the DMZ web tier';
const SHOTS = 'tests/test-results/uat1';

async function fixtures(frame) {
    const home = await S.homeDir(frame);
    const base = {
        profile_id: 'xccdf_cockpit-scap_profile_v46-test-wide',
        profile_title: LONG_TITLE,
        base_profile_id: S.PROFILE_L1,
        sds_file: S.DS,
        tailoring_file: 'v46-test wide policy',
        tailoring_path: '/nonexistent/v46-test-wide.xml',
        rule_meta: {},
    };
    for (const [ts, score, pass, fail] of [['2099-01-01T00-00-00', 64, 1234, 1011], ['2099-01-02T00-00-00', 100, 9999, 0]]) {
        const dir = `${home}/SCAP/scans/${ts}`;
        await hostSpawn(frame, ['mkdir', '-p', dir]);
        const manifest = { ...base, timestamp: ts, score, counts: { pass, fail } };
        await frame.evaluate(async ({ dir, manifest }) => {
            await window.cockpit.file(`${dir}/manifest.json`).replace(JSON.stringify(manifest, null, 2));
        }, { dir, manifest });
    }
    await S.createTestTailoring(frame);
    await hostSpawn(frame, ['sh', '-c', `mkdir -p "${home}/SCAP/content" && cp "${S.DS}" "${home}/SCAP/content/v46-test-wide-ds.xml"`]);
}

/* For one table at the current size: every problem found, as strings. */
function tableProblems(label) {
    const problems = [];
    const table = document.querySelector(`table[aria-label="${label}"]`);
    if (!table) return [`${label}: no table`];
    const card = table.closest('.pf-v6-c-card');
    const c = card.getBoundingClientRect();
    const t = table.getBoundingClientRect();
    if (t.right > c.right + 0.5 || t.left < c.left - 0.5) problems.push(`${label}: table ${t.left.toFixed(0)}..${t.right.toFixed(0)} outside card ${c.left.toFixed(0)}..${c.right.toFixed(0)}`);
    const shown = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    for (const cell of table.querySelectorAll('th, td')) {
        if (!shown(cell)) continue;
        const r = cell.getBoundingClientRect();
        const name = `${label} ${cell.tagName.toLowerCase()} "${cell.textContent.trim().slice(0, 30)}"`;
        if (r.right > c.right + 0.5) problems.push(`${name}: right ${r.right.toFixed(0)} > card ${c.right.toFixed(0)}`);
        if (cell.scrollWidth > cell.clientWidth + 1) problems.push(`${name}: content ${cell.scrollWidth} wider than cell ${cell.clientWidth}`);
    }
    const rows = [...table.querySelectorAll('tbody tr')];
    rows.forEach((tr, i) => {
        tr.scrollIntoView({ block: 'center' });
        const actions = [...tr.querySelectorAll('.ct-actions-cell button')].filter(shown);
        const names = actions.map(b => b.textContent.trim() || b.getAttribute('aria-label'));
        const need = label === 'Scan history'
            ? (names.includes('View') && ((names.includes('Download') && names.includes('Delete')) || actions.some(b => /More actions/.test(b.getAttribute('aria-label') || ''))))
            : label === 'Saved tailoring policies'
                ? ['Edit', 'Download', 'Delete'].every(n => names.includes(n))
                : (tr.dataset.ctSource !== 'uploaded' || names.includes('Delete'));
        if (!need) problems.push(`${label} row ${i}: actions shown [${names.join(', ')}]`);
        for (const b of actions) {
            const r = b.getBoundingClientRect();
            const what = `${label} row ${i} "${b.textContent.trim() || b.getAttribute('aria-label')}"`;
            if (r.left < c.left - 0.5 || r.right > c.right + 0.5) problems.push(`${what}: ${r.left.toFixed(0)}..${r.right.toFixed(0)} outside card ${c.left.toFixed(0)}..${c.right.toFixed(0)}`);
            const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
            if (!hit || !(b === hit || b.contains(hit))) problems.push(`${what}: not reachable at its center (hit ${hit?.tagName}.${hit?.className})`);
        }
    });
    return problems;
}

for (const scheme of ['light', 'dark']) {
    test.describe(scheme, () => {
        let context, page, frame, before, tmpBefore;

        test.beforeAll(async ({ browser }) => {
            context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, ignoreHTTPSErrors: true });
            page = await context.newPage();
            frame = await openModuleInShell(page);
            before = await S.snapshotScans(frame);
            tmpBefore = await S.snapshotTmp(frame);
            await fixtures(frame);
            await page.reload();
            frame = await (await page.locator('iframe[name^="cockpit1:localhost/scap-dev"]').elementHandle()).contentFrame();
            await frame.getByRole('grid', { name: 'Scan history' }).locator('tbody tr')
                    .first()
                    .waitFor({ timeout: 30000 });
        });

        test.afterAll(async () => {
            if (frame) await S.cleanupCreated(frame, before, tmpBefore);
            await context?.close();
        });

        for (const size of SIZES) {
            test(`${size.name}: tables fit their cards, every action reachable`, async ({ browserName }) => {
                await page.setViewportSize({ width: size.width, height: size.height });
                await page.waitForTimeout(800);
                const problems = [];
                for (const tab of ['Host Scan', 'Policy Tailoring']) {
                    await frame.getByRole('tab', { name: tab }).click();
                    for (const tb of TABLES.filter(x => x.tab === tab)) {
                        const table = frame.locator(`table[aria-label="${tb.label}"]`);
                        await table.locator('tbody tr').first()
                                .waitFor({ timeout: 30000 });
                        if (tb.key === 'tailoring')
                            await expect(table.locator('tbody tr').filter({ hasText: S.TEST_TAILORING_NAME })).toHaveCount(1);
                        if (tb.key === 'content')
                            await expect(table.locator('tbody tr').filter({ hasText: 'v46-test-wide-ds.xml' })).toHaveCount(1, { timeout: 30000 });
                        problems.push(...await frame.evaluate(tableProblems, tb.label));
                        if (size.shot) {
                            const card = table.locator('xpath=ancestor::div[contains(@class,"pf-v6-c-card")][1]');
                            await card.scrollIntoViewIfNeeded();
                            await card.screenshot({ path: `${SHOTS}/u4-${tb.key}-${size.name}-${scheme}-${browserName}.png` });
                        }
                    }
                }
                expect(problems).toEqual([]);
            });
        }
    });
}
