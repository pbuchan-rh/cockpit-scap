// V4.6 Phase 1 (correctness) acceptance, run INSIDE the Cockpit shell
// (/scap-dev dev copy) in both browser projects. PLAN_V4.6_V3_FLOW.md:
//   1. rule-scoped fixes carry the scanned profile's variable values
//      (CIS L1 and a tailored scan with set-values, bash and Ansible),
//   2. setup-page guide/remediation honour the tailoring,
//   3. every download arrives (Playwright download events),
//   4. errors and empty fixes are shown,
//   5. no silent default profile (Amendment 1: derived from saved scans),
//   6. mismatched content warns; 0 % does not say "All rules passed".
// The value diffs are written to tests/test-results/v46-scoped-fix-<browser>.json.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

let page, frame, before, tmpBefore, tailoringPath, home;
const report = {};

async function reopen() {
    await page.reload();
    const iframe = page.locator('iframe[name^="cockpit1:localhost/scap-dev"]');
    await iframe.waitFor({ state: 'attached', timeout: 30000 });
    frame = await (await iframe.elementHandle()).contentFrame();
    await frame.locator('.pf-v6-c-card').first()
            .waitFor({ timeout: 30000 });
}

async function reference(fixType, profileId, tailoring) {
    const args = ['oscap', 'xccdf', 'generate', 'fix', '--fix-type', fixType, '--profile', profileId];
    if (tailoring) args.push('--tailoring-file', tailoring);
    args.push(S.DS);
    return hostSpawn(frame, args);
}

function scopedRuleIds(bashText) {
    return [...bashText.matchAll(/^# BEGIN fix \(\d+ \/ \d+\) for '([^']+)'/gm)].map(m => m[1]);
}

/* What V4.5 and earlier generated: a standalone profile with no extends. */
async function legacyScoped(fixType, ruleIds) {
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<Tailoring xmlns="http://checklists.nist.gov/xccdf/1.2" id="xccdf_cockpit-scap_tailoring_v46legacy">' +
        '<version time="2026-10-14T00:00:00">1</version>' +
        '<Profile id="xccdf_cockpit-scap_profile_v46legacy"><title>legacy</title>' +
        ruleIds.map(id => `<select idref="${id}" selected="true"/>`).join('') +
        '</Profile></Tailoring>';
    const tmp = '/tmp/cockpit-scap-v46-test-legacy.xml';
    await frame.evaluate(async ({ tmp, xml }) => { await window.cockpit.file(tmp).replace(xml) }, { tmp, xml });
    try {
        return await hostSpawn(frame, ['oscap', 'xccdf', 'generate', 'fix', '--fix-type', fixType,
            '--profile', 'xccdf_cockpit-scap_profile_v46legacy', '--tailoring-file', tmp, S.DS]);
    } finally {
        await hostSpawn(frame, ['rm', '-f', tmp]);
    }
}

async function checkScopedValues(label, profileId, tailoring) {
    const results = frame.locator('[data-ct-results]');
    await expect(results).toBeVisible();
    // Every failing rule, through the Remediation Builder (V4.6 phase 3).
    await S.openBuilder(frame, 'all');
    const out = {};
    for (const fixType of ['bash', 'ansible']) {
        const dl = await S.builderDownload(page, frame, fixType);
        expect(dl.filename).toMatch(fixType === 'bash' ? /^remediation-.*-rules\.sh$/ : /^remediation-.*-rules\.yml$/);
        const ref = await reference(fixType, profileId, tailoring);
        const d = S.diffVariables(dl.text, ref, fixType);
        out[fixType] = d;
        expect(d.compared, `${label} ${fixType}: variables found in the scoped fix`).toBeGreaterThan(3);
        expect(d.diffs, `${label} ${fixType}: values that differ from the profile`).toEqual([]);
        if (fixType === 'bash') out.ruleIds = scopedRuleIds(dl.text);
    }
    await S.closeBuilder(frame);
    return out;
}

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ acceptDownloads: true });
    frame = await openModuleInShell(page);
    home = await S.homeDir(frame);
    before = await S.snapshotScans(frame);
    tmpBefore = await S.snapshotTmp(frame);
    tailoringPath = await S.createTestTailoring(frame);
    await reopen();
});

test.afterAll(async ({ browserName }) => {
    if (frame) {
        const removed = await S.cleanupCreated(frame, before, tmpBefore).catch(e => String(e));
        report.cleanedUpScans = removed;
    }
    const dir = path.join(__dirname, 'test-results');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `v46-scoped-fix-${browserName}.json`), JSON.stringify(report, null, 2));
    await page?.close();
});

test('no silent default profile; mismatched content warns', async () => {
    const rhel8 = `${home}/SCAP/content/ssg-rhel8-ds.xml`;
    const options = await frame.locator('#ct-scap-content option').evaluateAll(os => os.map(o => o.value));
    test.skip(!options.includes(rhel8), 'needs uploaded ssg-rhel8-ds.xml on the host');
    await frame.locator('#ct-scap-content').selectOption(rhel8);
    await expect(frame.locator('#ct-scap-profile')).toBeEnabled({ timeout: 60000 });
    // No saved scan of this content -> placeholder, Run Scan disabled.
    await expect(frame.locator('#ct-scap-profile')).toHaveValue('');
    await expect(frame.locator('#ct-scap-profile option:checked')).toHaveText('Select a profile…');
    await expect(frame.getByRole('button', { name: 'Run Scan' })).toBeDisabled();
    await expect(frame.locator('.ct-content-mismatch')).toContainText('Red Hat Enterprise Linux 8');
    await frame.locator('#ct-scap-content').selectOption(S.DS);
    await expect(frame.locator('#ct-scap-profile')).toBeEnabled({ timeout: 60000 });
    await expect(frame.locator('.ct-content-mismatch')).toHaveCount(0);
});

test('CIS L1 scan: scoped bash/Ansible values equal the profile values', async () => {
    await S.runScan(frame, { profileId: S.PROFILE_L1 });
    const r = await checkScopedValues('CIS L1', S.PROFILE_L1, null);
    // The spec must be able to see the old bug: the pre-V4.6 standalone
    // profile gives different values for the same rules.
    const legacy = await legacyScoped('bash', r.ruleIds);
    const ref = await reference('bash', S.PROFILE_L1, null);
    const legacyDiff = S.diffVariables(legacy, ref, 'bash');
    expect(legacyDiff.diffs.length, 'pre-V4.6 scoping differs from the profile').toBeGreaterThan(0);
    report.cisL1 = { rules: r.ruleIds.length, bash: r.bash, ansible: r.ansible, legacyBashDiffs: legacyDiff.diffs };
});

test('results downloads arrive: per-rule .sh, HTML report, results XML, ARF; empty Ansible fix warns', async () => {
    // Any automated rule in the default-expanded (critical/high) groups.
    const row = frame.locator('.ct-rule-item').filter({ hasText: 'Automated' })
            .first();
    await row.locator('.ct-rule-row').click();
    await row.getByRole('button', { name: 'Remediation script' }).click();
    await expect(row.locator('pre.ct-rule-rem-pre')).toContainText('BEGIN fix', { timeout: 60000 });
    const sh = await S.expectDownload(page, () => row.getByRole('button', { name: 'Download .sh' }).click());
    expect(sh.filename).toMatch(/^fix-.*\.sh$/);
    expect(sh.text).toMatch(/^# BEGIN fix/m);

    for (const [item, re, magic] of [['HTML report', /-report\.html$/, null], ['Results XML', /-results\.xml\.gz$/, 0x1f], ['ARF', /-arf\.xml\.gz$/, 0x1f]]) {
        const dl = await S.expectDownload(page, () => S.resultsDownload(frame, item), { binary: true });
        expect(dl.filename).toMatch(re);
        if (magic) expect(dl.buffer[0]).toBe(magic);
        else expect(dl.buffer.toString('utf8', 0, 4000)).toContain('<html');
    }

    // A rule with a bash fix but no Ansible task: the Builder warns
    // instead of downloading an empty playbook.
    await S.openBuilder(frame, 'all');
    const drawer = frame.locator('.ct-builder-drawer');
    await drawer.getByRole('button', { name: 'Deselect all', exact: true }).first()
            .click();
    let picked = null;
    for (const id of S.NO_ANSIBLE_RULES) {
        const cb = drawer.locator(`.ct-builder-rule[data-rule-id="${S.RULE}${id}"] input[type=checkbox]`);
        await drawer.locator('.ct-builder-search input').fill(id);
        if (await cb.count() > 0) { await cb.check(); picked = id; break }
    }
    await drawer.locator('.ct-builder-search input').fill('');
    if (picked) {
        await drawer.getByRole('button', { name: 'Download Ansible playbook' }).click();
        await expect(drawer.locator('.pf-v6-c-alert.pf-m-warning')).toContainText('Ansible remediation', { timeout: 60000 });
        report.emptyAnsibleWarned = picked;
    } else {
        report.emptyAnsibleWarned = 'no candidate rule failing';
    }
    await S.closeBuilder(frame);
});

test('after a scan, the setup page preselects the last scanned profile', async () => {
    await frame.locator('[data-ct-results]').getByRole('button', { name: 'Close', exact: true })
            .click();
    await frame.locator('#ct-scap-content').selectOption(S.DS);
    await expect(frame.locator('#ct-scap-profile')).toBeEnabled({ timeout: 60000 });
    await expect(frame.locator('#ct-scap-profile')).toHaveValue(S.PROFILE_L1);
    await expect(frame.getByRole('button', { name: 'Run Scan' })).toBeEnabled();
});

test('setup remediation and guide honour the tailoring', async () => {
    const remediation = frame.locator('#ct-download-remediation-primary');
    await frame.locator('#ct-scap-profile').selectOption(S.PROFILE_L1);
    const plain = await S.expectDownload(page, () => remediation.click());
    await frame.locator('#ct-scap-tailoring-select').selectOption(tailoringPath);
    const tailored = await S.expectDownload(page, () => remediation.click());
    expect(tailored.filename).toMatch(/\.sh$/);
    const plainN = S.countFixBlocks(plain.text);
    const tailoredN = S.countFixBlocks(tailored.text);
    expect(plainN - tailoredN).toBe(S.DESELECTED.length);
    expect(tailored.text).toContain("var_password_pam_minlen='18'");
    report.setupRemediation = { plainFixBlocks: plainN, tailoredFixBlocks: tailoredN };

    const [popup] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 60000 }),
        frame.getByRole('button', { name: 'View Compliance Guide' }).click(),
    ]);
    await popup.waitForURL(/viewer\.html/, { timeout: 120000 });
    await popup.waitForFunction(() => document.body && document.body.innerText.length > 1000, null, { timeout: 60000 });
    const guide = await popup.content();
    for (const r of S.DESELECTED) expect(guide, `guide lists deselected ${r}`).not.toContain(S.RULE + r);
    expect(guide).toContain(S.TEST_TAILORING_NAME);
    await popup.close();
});

test('tailored scan: scoped values include the set-values', async () => {
    await frame.locator('#ct-scap-tailoring-select').selectOption('');
    await S.runScan(frame, { profileId: S.PROFILE_L1, tailoringPath });
    const r = await checkScopedValues('tailored', S.TEST_TAILORED_PROFILE, tailoringPath);
    for (const fixType of ['bash', 'ansible']) {
        for (const [v, val] of Object.entries(S.SET_VALUES)) {
            if (r[fixType].values[v] !== undefined)
                expect(r[fixType].values[v].replace(/^'|'$/g, '').replace(/^!!str /, '')).toBe(val);
        }
    }
    report.tailored = { rules: r.ruleIds.length, bash: r.bash, ansible: r.ansible };
});

test('fix generation errors are shown', async () => {
    await hostSpawn(frame, ['mv', tailoringPath, tailoringPath + '.v46-test-moved']);
    try {
        await S.openBuilder(frame, 'all');
        await frame.locator('.ct-builder-drawer').getByRole('button', { name: 'Download Bash script' })
                .click();
        const alert = frame.locator('.ct-builder-drawer .pf-v6-c-alert.pf-m-danger').filter({ hasText: 'Fix generation failed' });
        await expect(alert).toBeVisible({ timeout: 60000 });
        report.errorShown = (await alert.innerText()).slice(0, 300);
        await S.closeBuilder(frame);
    } finally {
        await hostSpawn(frame, ['mv', tailoringPath + '.v46-test-moved', tailoringPath]);
    }
});

test('history and tailoring downloads arrive', async () => {
    const row = frame.locator('tbody tr').filter({ hasText: S.TEST_TAILORING_NAME }).first();
    // Phase 4 (spec F): Download is a menu (HTML report / Results XML / ARF).
    const dl = await S.expectDownload(page, async () => {
        await row.getByRole('button', { name: /^Download scan from/ }).click();
        await frame.getByRole('menuitem', { name: /^Results XML/ }).click();
    }, { binary: true });
    expect(dl.filename).toMatch(/^scan-results-.*\.xml\.gz$/);
    expect(dl.buffer[0]).toBe(0x1f);

    const [popup] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 60000 }),
        frame.locator('[data-ct-results]').getByRole('button', { name: 'View report', exact: true }).click(),
    ]);
    await popup.waitForURL(/viewer\.html/, { timeout: 60000 });
    await popup.waitForFunction(() => /OpenSCAP Evaluation Report/.test(document.title + document.body?.innerText), null, { timeout: 60000 });
    await popup.close();

    await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
    const trow = frame.getByRole('grid', { name: 'Saved tailoring policies' }).locator('tbody tr')
            .filter({ hasText: S.TEST_TAILORING_NAME });
    const t = await S.expectDownload(page, () => trow.getByRole('button', { name: 'Download' }).click());
    expect(t.filename).toMatch(/^v46-test-.*\.xml$/);
    expect(t.text).toContain(S.TEST_TAILORED_PROFILE);
});
