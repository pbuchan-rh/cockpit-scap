// Review fixes, job 2 (scan lifecycle, remediation, report viewer):
// L1 (systemctl start time without --timestamp=unix), L3 (History View off
// while a scan runs), L4 (no root-owned scan tmpdir left behind), X1 (the
// running view's total counts only the scanned tailoring profile), L9 (the
// report viewer keeps scripts blocked) and L2 (a run picked up without
// admin is followed once admin turns on). Applies a (fake, echo-only) fix as
// root, so ONLY against the disposable scap-apply10.
const { requireApplyHost, sshApplyHost } = require('./helpers/apply-host');
requireApplyHost();

const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn, requestAdmin, COCKPIT_URL } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

const USER = process.env.COCKPIT_USER || 'pbuchan';
const PASS = process.env.COCKPIT_PASS || '';
const SHELL_PATH = process.env.SCAP_SHELL_PATH || '/scap-dev';

// A v46-test copy of the SSG datastream whose journald_compress fix is
// replaced by 90 s of ticks (the real fix never runs, so the rule keeps
// failing and the host is not changed).
const SLOW_RULE = 'journald_compress';
const TEST_DS_NAME = 'ssg-rhel10-v46-test-lifecycle-ds.xml';
// X1: a tailoring file with two profiles. The scanned one deselects 2 CIS L1
// rules, the other deselects 5 more; only the first 2 may count.
const TAILORED = 'xccdf_cockpit-scap_profile_v46-test-lifecycle-a';
const OTHER_PROFILE = 'xccdf_cockpit-scap_profile_v46-test-lifecycle-b';
const DESELECT_A = ['package_aide_installed', 'aide_build_database'];
const DESELECT_B = ['sysctl_kernel_dmesg_restrict', 'sysctl_kernel_yama_ptrace_scope', 'coredump_disable_backtraces',
    'coredump_disable_storage', 'sysctl_fs_suid_dumpable'];
// Scan tmpdirs only (makeTmpdir); not -remediate-/-dl-/-fixscope- files.
const SCAN_TMP_RE = /^\/tmp\/cockpit-scap-[A-Za-z0-9]{6}$/;

let page, frame, home, before, tmpBefore, testDs, tailoringPath, scanA, totalL1;

const drawer = f => f.locator('.ct-builder-drawer');
const modal = f => f.locator('.ct-apply-modal');
const historyRow = (f, ts) => f.getByRole('grid', { name: 'Scan history' }).locator('tbody tr')
        .filter({ hasText: ts.slice(0, 10) + ' ' + ts.slice(11).replace(/-/g, ':') });
const viewButton = (f, ts) => historyRow(f, ts).getByRole('button', { name: 'View', exact: true });

async function scanTmpdirs(f = frame) {
    return (await S.snapshotTmp(f)).filter(p => SCAN_TMP_RE.test(p));
}

async function expectNoNewScanTmpdir(what, f = frame) {
    const now = await scanTmpdirs(f);
    expect(now.filter(p => !tmpBefore.includes(p)), `no scan tmpdir left after ${what}`).toEqual([]);
}

async function startScan(content, tailoring = null) {
    await S.pickContentAndProfile(frame, S.PROFILE_L1, content);
    if (tailoring) await S.pick(frame, '#ct-scap-tailoring-select', tailoring);
    const run = frame.getByRole('button', { name: 'Run Scan' });
    await expect(run).toBeEnabled({ timeout: 30000 });
    await run.click();
    const running = frame.locator('[data-ct-running]');
    await expect(running).toBeVisible();
    return running;
}

async function runningTotal(running) {
    const bar = running.locator('.ct-scan-progress-bar');
    await expect(bar).toContainText(/\d+ of \d+ rules evaluated/, { timeout: 60000 });
    return Number((await bar.innerText()).match(/\d+ of (\d+) rules evaluated/)[1]);
}

async function waitResults(f = frame) {
    await f.locator('[data-ct-results]').waitFor({ timeout: 300000 });
}

async function closeResults(f = frame) {
    if (await f.locator('.pf-v6-c-drawer.pf-m-expanded').count()) {
        await f.getByRole('button', { name: 'Close Remediation Builder' }).click();
        await expect(f.locator('.pf-v6-c-drawer.pf-m-expanded')).toHaveCount(0);
    }
    await f.locator('[data-ct-results]').getByRole('button', { name: 'Close', exact: true })
            .click();
    await expect(f.locator('[data-ct-results]')).toHaveCount(0);
}

function remediationUnits() {
    return sshApplyHost("systemctl list-units --all --plain --no-legend 'cockpit-scap-remediate-*' | awk '{print $1}'")
            .split('\n')
            .filter(Boolean);
}

async function reloadFrame() {
    await page.reload();
    const iframe = page.locator(`iframe[name="cockpit1:localhost${SHELL_PATH}"]`);
    await iframe.waitFor({ state: 'attached', timeout: 30000 });
    frame = await (await iframe.elementHandle()).contentFrame();
    await frame.locator('.pf-v6-c-card').first()
            .waitFor({ timeout: 30000 });
}

/* A second browser context, logged in WITHOUT administrative access. */
async function openLimited(browser) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(COCKPIT_URL);
    await p.locator('#login-user-input').waitFor({ timeout: 15000 });
    await p.fill('#login-user-input', USER);
    await p.fill('#login-password-input', PASS);
    await p.click('#login-button');
    await p.waitForFunction(() => !document.getElementById('login-user-input'), null, { timeout: 20000 });
    await p.goto(COCKPIT_URL + SHELL_PATH);
    await expect(p.locator('a:has-text("Limited access"), button:has-text("Limited access")').first()).toBeVisible({ timeout: 15000 });
    const iframe = p.locator(`iframe[name="cockpit1:localhost${SHELL_PATH}"]`);
    await iframe.waitFor({ state: 'attached', timeout: 30000 });
    const f = await (await iframe.elementHandle()).contentFrame();
    await f.locator('.pf-v6-c-card').first()
            .waitFor({ timeout: 30000 });
    return { ctx, p, f };
}

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    home = await S.homeDir(frame);
    before = await S.snapshotScans(frame);
    tmpBefore = await S.snapshotTmp(frame);
    expect(remediationUnits(), 'no remediation unit left from an earlier run').toEqual([]);

    testDs = `${home}/SCAP/content/${TEST_DS_NAME}`;
    sshApplyHost(`mkdir -p ~/SCAP/content && python3 -I - ${S.DS} ${testDs} <<'PY'
import re, sys
src, dst = sys.argv[1:3]
t = open(src).read()
body = 'echo "v46-test slow fix start"\\nfor i in $(seq 1 90); do echo "v46-test tick $i"; sleep 1; done\\necho "v46-test slow fix done"\\n'
fix_re = re.compile(r'(<xccdf-1.2:fix [^>]*system="urn:xccdf:fix:script:sh"[^>]*>)(.*?)(</xccdf-1.2:fix>)', re.S)
m = re.search(r'<xccdf-1.2:Rule [^>]*id="xccdf_org.ssgproject.content_rule_${SLOW_RULE}"[^>]*>', t)
end = t.index('</xccdf-1.2:Rule>', m.end())
f = fix_re.search(t, m.end(), end)
t = t[:f.start(2)] + body + t[f.end(2):]
open(dst, 'w').write(t)
PY
chmod 600 ${testDs}`);

    // X1's two-profile tailoring (XML + sidecar, as lib/tailoring.js writes).
    const dir = `${home}/SCAP/tailoring`;
    const base = `${dir}/v46-test-lifecycle-2026-10-20T00-00-00`;
    tailoringPath = `${base}.xml`;
    const profile = (id, title, rules) => [
        `  <Profile id="${id}" extends="${S.PROFILE_L1}">`,
        `    <title>${title}</title>`,
        ...rules.map(r => `    <select idref="${S.RULE}${r}" selected="false"/>`),
        '  </Profile>',
    ];
    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Tailoring xmlns="http://checklists.nist.gov/xccdf/1.2" id="xccdf_cockpit-scap_tailoring_v46-test-lifecycle">',
        '  <version time="2026-10-20T00:00:00">1</version>',
        ...profile(TAILORED, 'v46-test lifecycle A', DESELECT_A),
        ...profile(OTHER_PROFILE, 'v46-test lifecycle B', DESELECT_B),
        '</Tailoring>',
    ].join('\n');
    const sidecar = {
        name: 'v46-test lifecycle A',
        base_profile_id: S.PROFILE_L1,
        base_profile_title: 'CIS Red Hat Enterprise Linux 10 Benchmark for Level 1 - Server',
        profile_id: TAILORED,
        sds_path: S.DS,
        path: tailoringPath,
        created: '2026-10-20T00-00-00',
        rules_modified: DESELECT_A.length,
    };
    await frame.evaluate(async ({ dir, base, xml, sidecar }) => {
        const c = window.cockpit;
        await c.spawn(['mkdir', '-p', dir]);
        await c.file(`${base}.xml`).replace(xml);
        await c.file(`${base}.json`).replace(JSON.stringify(sidecar, null, 2));
        await c.spawn(['chmod', '600', `${base}.xml`, `${base}.json`]);
    }, { dir, base, xml, sidecar });
    // The pickers list content and policies when the page loads.
    await reloadFrame();
});

test.afterAll(async () => {
    // A run cut short by a failure must end first: its log goes into a scan
    // dir that cleanup removes.
    await expect.poll(() => remediationUnits(), { timeout: 150000, intervals: [3000] }).toEqual([]);
    if (frame) await S.cleanupCreated(frame, before, tmpBefore);
    await page?.close();
});

test('L1: start time parses from the default and the unix timestamp format', async () => {
    const { parseRunState, parseStartTimestamp } = await import('../src/lib/runState.js');
    const RE = /^\/tmp\/cockpit-scap-remediate-[A-Za-z0-9]{6}$/;
    const ms = Date.UTC(2026, 9, 20, 14, 3, 7);
    expect(parseStartTimestamp('Tue 2026-10-20 14:03:07 UTC')).toBe(ms);
    expect(parseStartTimestamp('2026-10-20 14:03:07 UTC')).toBe(ms);
    expect(parseStartTimestamp(`@${ms / 1000}`)).toBe(ms);
    for (const v of ['', 'n/a', '0', 'Tue 2026-10-20 14:03:07 CEST', undefined]) expect(parseStartTimestamp(v)).toBeNull();

    const show = (active, stamp, load = 'loaded', env = 'COCKPIT_SCAP_RUN_DIR=/tmp/cockpit-scap-remediate-Ab12Cd') =>
        `LoadState=${load}\nActiveState=${active}\nExecMainStartTimestamp=${stamp}\nEnvironment=${env}\n`;
    expect(parseRunState(show('activating', 'Tue 2026-10-20 14:03:07 UTC'), RE))
            .toEqual({ running: true, dir: '/tmp/cockpit-scap-remediate-Ab12Cd', startedAt: ms });
    // Same unit, systemd >= 248 with --timestamp=unix: same result.
    expect(parseRunState(show('activating', `@${ms / 1000}`), RE))
            .toEqual({ running: true, dir: '/tmp/cockpit-scap-remediate-Ab12Cd', startedAt: ms });
    // --no-block start, not started yet: running.
    expect(parseRunState(show('inactive', ''), RE).running).toBe(true);
    expect(parseRunState(show('inactive', 'n/a'), RE).running).toBe(true);
    // Finished but not yet collected, and collected.
    expect(parseRunState(show('inactive', 'Tue 2026-10-20 14:03:07 UTC'), RE).running).toBe(false);
    expect(parseRunState(show('inactive', '', 'not-found', ''), RE)).toEqual({ running: false, dir: null, startedAt: null });
    expect(parseRunState(show('failed', 'Tue 2026-10-20 14:03:07 UTC'), RE).running).toBe(false);
    // A dir that is not a run dir is dropped.
    expect(parseRunState(show('active', '', 'loaded', 'COCKPIT_SCAP_RUN_DIR=/etc'), RE).dir).toBeNull();

    // The real systemctl on the host, as getRunState runs it: the default
    // format with TZ=UTC gives the same second as --timestamp=unix.
    const unitName = 'systemd-journald.service';
    const shown = await hostSpawn(frame, ['sh', '-c',
        `TZ=UTC LC_ALL=C systemctl show -p LoadState -p ActiveState -p ExecMainStartTimestamp -p Environment ${unitName}`]);
    const unix = await hostSpawn(frame, ['systemctl', 'show', '--timestamp=unix', '-p', 'ExecMainStartTimestamp', unitName]);
    const viaDefault = parseRunState(shown, RE).startedAt;
    expect(viaDefault).not.toBeNull();
    expect(viaDefault).toBe(parseStartTimestamp(unix.trim().split('=')[1]));
});

test('L3 + L4: View is off while a scan runs; no scan tmpdir after scan, New scan, View', async () => {
    // Scan A (the v46-test copy), then New scan (Close).
    let running = await startScan(testDs);
    totalL1 = await runningTotal(running);
    await waitResults();
    scanA = (await S.snapshotScans(frame)).filter(ts => !before.includes(ts))[0];
    expect(scanA).toBeTruthy();
    await expectNoNewScanTmpdir('a scan');
    const subA = await frame.locator('[data-ct-results] .ct-results-meta').innerText();
    await closeResults();
    await expectNoNewScanTmpdir('New scan');

    // Scan B: while it runs, View is aria-disabled with a tooltip, Download
    // still works, and a forced click changes nothing.
    running = await startScan(S.DS);
    const view = viewButton(frame, scanA);
    await expect(view).toHaveAttribute('aria-disabled', 'true');
    await view.hover();
    await expect(frame.getByRole('tooltip')).toContainText('A scan is running');
    await view.click({ force: true });
    await expect(running).toBeVisible();
    await expect(frame.locator('[data-ct-results]')).toHaveCount(0);
    await expect(running.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(historyRow(frame, scanA).getByRole('button', { name: /^Download scan from/ })).toBeEnabled();
    await page.mouse.move(0, 0);

    // B's own results replace the running view, and View is back.
    await waitResults();
    const subB = await frame.locator('[data-ct-results] .ct-results-meta').innerText();
    expect(subB).not.toBe(subA);
    await expect(viewButton(frame, scanA)).toBeEnabled();
    await expect(viewButton(frame, scanA)).not.toHaveAttribute('aria-disabled', 'true');
    await expectNoNewScanTmpdir('a second scan');

    // Viewing a saved scan from the live results leaves nothing either.
    await viewButton(frame, scanA).click();
    await expect.poll(() => frame.locator('[data-ct-results] .ct-results-meta').innerText()).toBe(subA);
    await expectNoNewScanTmpdir('View of a saved scan');
    await closeResults();
});

test('X1 + cancel: the running total counts only the scanned tailoring profile; Cancel leaves no tmpdir', async () => {
    const running = await startScan(S.DS, tailoringPath);
    const total = await runningTotal(running);
    expect(total, `L1 total ${totalL1} minus the scanned profile's ${DESELECT_A.length}`).toBe(totalL1 - DESELECT_A.length);
    await running.getByRole('button', { name: 'Cancel' }).click();
    await expect(frame.getByRole('button', { name: 'Run Scan' })).toBeVisible({ timeout: 60000 });
    await expect.poll(async () => (await hostSpawn(frame, ['sh', '-c', "pgrep -a -x oscap | grep 'xccdf eval' || true"])).trim(),
                      { timeout: 30000 }).toBe('');
    await expectNoNewScanTmpdir('Cancel');
});

test('L9: the report viewer applies the report but keeps its scripts blocked', async () => {
    await historyRow(frame, scanA).getByRole('button', { name: 'View', exact: true })
            .click();
    const footer = frame.locator('[data-ct-results] .ct-results-footer');
    const [popup] = await Promise.all([
        page.context().waitForEvent('page'),
        footer.getByRole('button', { name: 'View report' }).click(),
    ]);
    await popup.waitForURL(/\/viewer\.html/, { timeout: 30000 });
    await expect(popup.locator('body')).toContainText('Compliance and Scoring', { timeout: 60000 });
    const state = await popup.evaluate(() => {
        // An inline script added now must be blocked as well.
        window.__ctInjected = false;
        const s = document.createElement('script');
        s.textContent = 'window.__ctInjected = true;';
        document.head.appendChild(s);
        return {
            scripts: document.querySelectorAll('script:not([src])').length,
            jquery: typeof window.jQuery,
            injected: window.__ctInjected,
            // The report's own stylesheet does apply.
            styled: getComputedStyle(document.body).fontFamily,
        };
    });
    console.log('viewer:', JSON.stringify(state));
    expect(state.scripts, 'the report has inline scripts').toBeGreaterThan(0);
    expect(state.jquery, "the report's inline jQuery did not run").toBe('undefined');
    expect(state.injected, 'an injected inline script is blocked').toBe(false);
    expect(state.styled).not.toMatch(/^"?Times/);
    await popup.close();
    await closeResults();
});

test('L2: a run picked up without admin is followed once admin turns on; Rescan leaves no tmpdir', async ({ browser }) => {
    // Start the slow fix from scan A with admin.
    await viewButton(frame, scanA).click();
    await waitResults();
    await frame.locator('[data-ct-results]').getByRole('button', { name: /^All failures \(\d+\)$/ })
            .click();
    await drawer(frame).locator('.ct-builder-toolbar')
            .getByRole('button', { name: 'Deselect all' })
            .click();
    await drawer(frame).locator('.ct-builder-search input')
            .fill(SLOW_RULE);
    await drawer(frame).locator(`[id="ct-builder-${S.RULE}${SLOW_RULE}"]`)
            .check();
    await drawer(frame).getByRole('button', { name: 'Apply now' })
            .click();
    const apply = modal(frame).getByRole('button', { name: 'Apply', exact: true });
    await expect(apply).toBeEnabled({ timeout: 60000 });
    await apply.click();
    await expect(modal(frame).locator('.ct-apply-output')).toContainText('v46-test tick 2', { timeout: 60000 });
    const [unit] = remediationUnits();
    expect(unit).toBeTruthy();

    // A page without admin: limited, no output.
    const { ctx, p, f } = await openLimited(browser);
    try {
        const alert = f.locator('.ct-remediation-alert');
        await expect(alert).toContainText(/A remediation is running on this host \(started .+\)/, { timeout: 30000 });
        await expect(alert).toContainText('Turn on administrative access to follow its output.');
        await expect(alert.getByRole('button', { name: 'View output' })).toHaveCount(0);

        // Admin on: the same page attaches fully.
        await requestAdmin(p);
        // The shell's switch dialog can stay up after it has switched; it
        // would cover the module.
        const shellDialog = p.locator('.pf-v6-c-backdrop');
        if (!(await shellDialog.waitFor({ state: 'detached', timeout: 10000 }).then(() => true)
                .catch(() => false))) {
            await p.screenshot({ path: 'tests/test-results/v46-review-lifecycle-admin-dialog.png' });
            console.log('shell dialog after requestAdmin:', (await shellDialog.innerText()).replace(/\s+/g, ' '));
            await p.keyboard.press('Escape');
        }
        await expect(shellDialog).toHaveCount(0);
        await expect(alert.getByRole('button', { name: 'View output' })).toBeVisible({ timeout: 30000 });
        await expect(alert).not.toContainText('Turn on administrative access');
        expect(sshApplyHost(`systemctl show -p ActiveState --value ${unit}`).trim()).toBe('activating');
        await alert.getByRole('button', { name: 'View output' }).click();
        const m = modal(f);
        await expect(m).toBeVisible();
        await expect(m.locator('.ct-apply-output')).toContainText('v46-test tick 1\n'); // from the first byte
        const ticks = async () => ((await m.locator('.ct-apply-output').innerText()).match(/v46-test tick \d+/g) || []).length;
        const t1 = await ticks();
        await expect.poll(ticks, { timeout: 15000 }).toBeGreaterThan(t1); // followed live
        await expect(m.locator('.pf-v6-c-modal-box__title')).toContainText('Fixes applied', { timeout: 240000 });
        await expect(m).toContainText('exit code 0');
        await expect(m.locator('.ct-apply-output')).toContainText('v46-test slow fix done');
        await expect(m.getByRole('button', { name: 'Download log' })).toBeVisible();
        await expect(m.locator('.ct-apply-log-path')).toContainText(`${home}/SCAP/scans/${scanA}/remediation-`);
        expect(remediationUnits()).toEqual([]);

        // Rescan to verify (from the upgraded page): no scan tmpdir after it.
        const rescan = m.getByRole('button', { name: 'Rescan to verify' });
        await expect(rescan).toBeEnabled();
        await rescan.click();
        await expect(m).toHaveCount(0);
        await waitResults(f);
        await expectNoNewScanTmpdir('Rescan to verify', f);
    } finally {
        await ctx.close();
    }
    // The first page's dialog saw the end too; close it.
    await modal(frame).locator('.pf-v6-c-modal-box__footer')
            .getByRole('button', { name: 'Close' })
            .click();
    await expect(modal(frame)).toHaveCount(0);
});

test('L10: reads run as the user; a root-owned saved scan (V4.1/V4.2 era) still lists and opens', async () => {
    // A copy of scan A whose files are root's, 0600, as a failed chown of
    // the old root writes would have left them.
    const ts = '2099-01-02T00-00-00';
    const dir = `${home}/SCAP/scans/${ts}`;
    await hostSpawn(frame, ['cp', '-a', `${home}/SCAP/scans/${scanA}`, dir]);
    await hostSpawn(frame, ['sed', '-i', `s/"timestamp": "${scanA}"/"timestamp": "${ts}"/`, `${dir}/manifest.json`]);
    await hostSpawn(frame, ['sh', '-c', `chown root:root "$1"/* && chmod 600 "$1"/*`, 'sh', dir], { superuser: true });
    expect((await hostSpawn(frame, ['stat', '-c', '%U', `${dir}/manifest.json`])).trim()).toBe('root');
    // The user cannot read it, so only the superuser retry can.
    expect(await hostSpawn(frame, ['sh', '-c', 'cat "$1" 2>&1 || true', 'sh', `${dir}/manifest.json`])).toContain('Permission denied');

    await reloadFrame();
    await expect(historyRow(frame, ts)).toHaveCount(1, { timeout: 30000 });
    await viewButton(frame, ts).click();
    await waitResults();
    await expect(frame.locator('[data-ct-results] .ct-results-profile')).toBeVisible();
    await closeResults();
    // cleanupCreated removes it (the user owns the directory).
});
