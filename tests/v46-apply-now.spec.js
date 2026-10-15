// Apply now (PLAN_V4.5_APPLY_NOW.md, amendments 2026-10-15 item 8). Clicks
// Apply, so fixes run as root: ONLY against the disposable scap-apply10.
const { requireApplyHost, sshApplyHost } = require('./helpers/apply-host');
requireApplyHost();

const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn, COCKPIT_URL } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

const SHOTS = 'tests/test-results/v46-apply';
fs.mkdirSync(SHOTS, { recursive: true });

const USER = process.env.COCKPIT_USER || 'pbuchan';
const PASS = process.env.COCKPIT_PASS || '';
const SHELL_PATH = process.env.SCAP_SHELL_PATH || '/scap-dev';

// Low-risk CIS L1 rules for the real applies (no sshd/PAM/firewall/
// bootloader/SELinux/mounts/accounts). Each run fixes the first two that
// still fail, so the host keeps failing ones for later runs.
const POOL = [
    'sysctl_kernel_dmesg_restrict', 'banner_etc_issue_cis',
    'sysctl_kernel_yama_ptrace_scope', 'accounts_maximum_age_login_defs',
    'coredump_disable_backtraces', 'coredump_disable_storage',
    'sysctl_net_ipv4_icmp_ignore_bogus_error_responses', 'sysctl_net_ipv4_icmp_echo_ignore_broadcasts',
    'sysctl_net_ipv4_conf_all_log_martians', 'sysctl_net_ipv4_conf_default_log_martians',
    'sysctl_net_ipv4_tcp_syncookies', 'sysctl_fs_suid_dumpable', 'sysctl_kernel_randomize_va_space',
    'sysctl_net_ipv4_conf_all_secure_redirects', 'sysctl_net_ipv4_conf_default_secure_redirects',
    'sysctl_net_ipv4_conf_all_accept_redirects', 'sysctl_net_ipv4_conf_default_accept_redirects',
    'sysctl_net_ipv6_conf_all_accept_redirects', 'sysctl_net_ipv6_conf_default_accept_redirects',
];
// No Bash remediation in SSG 0.1.81 RHEL 10: the fix is empty.
const EMPTY_RULE = 'partition_for_tmp';
// A v46-test copy of the SSG datastream (an ordinary uploaded content file,
// no hook in the app) whose fixes for these two rules are replaced: one is
// slow (45 s of ticks) for the reload test, one exits 3. The real fixes of
// both rules never run, so they keep failing.
const SLOW_RULE = 'journald_compress';
const FAIL_RULE = 'banner_etc_issue_net_cis';
const TEST_DS_NAME = 'ssg-rhel10-v46-test-ds.xml';

let page, frame, home, before, tmpBefore, mainScan, testScan, testDs;

async function shot(name, info) {
    await page.screenshot({ path: `${SHOTS}/${name}-${info.project.name}.png` });
}

async function reopenFrame() {
    const iframe = page.locator(`iframe[name="cockpit1:localhost${SHELL_PATH}"]`);
    await iframe.waitFor({ state: 'attached', timeout: 30000 });
    frame = await (await iframe.elementHandle()).contentFrame();
    await frame.locator('.pf-v6-c-card').first()
            .waitFor({ timeout: 30000 });
}

async function runScanWith(content) {
    await frame.locator('#ct-scap-content').selectOption(content);
    await expect(frame.locator('#ct-scap-profile')).toBeEnabled({ timeout: 60000 });
    await frame.locator('#ct-scap-profile').selectOption(S.PROFILE_L1);
    const run = frame.getByRole('button', { name: 'Run Scan' });
    await expect(run).toBeEnabled({ timeout: 30000 });
    const scansBefore = await S.snapshotScans(frame);
    await run.click();
    await frame.locator('[data-ct-results]').waitFor({ timeout: 300000 });
    return (await S.snapshotScans(frame)).filter(ts => !scansBefore.includes(ts))[0];
}

const historyRow = ts => frame.getByRole('grid', { name: 'Scan history' }).locator('tbody tr')
        .filter({ hasText: ts.slice(0, 10) + ' ' + ts.slice(11).replace(/-/g, ':') });

async function viewFromHistory(ts) {
    const results = frame.locator('[data-ct-results]');
    if (await results.count()) await closeResults();
    await historyRow(ts).getByRole('button', { name: 'View', exact: true })
            .click();
    await expect(results).toBeVisible({ timeout: 60000 });
}

async function closeResults() {
    if (await frame.locator('.pf-v6-c-drawer.pf-m-expanded').count()) {
        await frame.getByRole('button', { name: 'Close Remediation Builder' }).click();
        await expect(frame.locator('.pf-v6-c-drawer.pf-m-expanded')).toHaveCount(0);
    }
    await frame.locator('[data-ct-results]').getByRole('button', { name: 'Close', exact: true })
            .click();
    await expect(frame.locator('[data-ct-results]')).toHaveCount(0);
}

const drawer = () => frame.locator('.ct-builder-drawer');
const modal = () => frame.locator('.ct-apply-modal');
const applyNowButton = () => drawer().getByRole('button', { name: 'Apply now' });

async function selectOnly(ids) {
    await drawer().locator('.ct-builder-toolbar')
            .getByRole('button', { name: 'Deselect all' })
            .click();
    const search = drawer().locator('.ct-builder-search input');
    for (const id of ids) {
        await search.fill(id);
        await drawer().locator(`[id="ct-builder-${S.RULE}${id}"]`)
                .check();
    }
    await search.fill('');
    await expect(drawer().locator('.ct-builder-count')).toHaveText(new RegExp(`^${ids.length} of \\d+ rules selected$`));
}

async function failingInBuilder(ids) {
    const out = [];
    for (const id of ids) {
        if (await drawer().locator(`.ct-builder-rule[data-rule-id="${S.RULE}${id}"]`)
                .count()) out.push(id);
    }
    return out;
}

// The run's unit from the systemd side (needs no UI).
function remediationUnits() {
    return sshApplyHost("systemctl list-units --all --plain --no-legend 'cockpit-scap-remediate-*' | awk '{print $1}'")
            .split('\n')
            .filter(Boolean);
}

function syslogFor(unit) {
    return sshApplyHost(`journalctl -t cockpit-scap --no-pager -o cat --since '-2h' | grep -F 'unit=${unit}' || true`)
            .split('\n')
            .filter(Boolean);
}

async function newestLog(scanTs) {
    const out = await hostSpawn(frame, ['sh', '-c', `ls -1t "${home}/SCAP/scans/${scanTs}"/remediation-*.log 2>/dev/null || true`]);
    return out.split('\n').filter(Boolean)[0];
}

/* After a run: user-owned 0600 log with header, script, output and exit
 * code; both syslog lines; no unit and no temp dir left. */
async function checkRunRecord(scanTs, exitCode, ruleIds) {
    const log = await newestLog(scanTs);
    expect(log, 'remediation log in the source scan dir').toBeTruthy();
    expect((await hostSpawn(frame, ['stat', '-c', '%U %G %a', log])).trim()).toBe(`${USER} ${USER} 600`);
    const text = await hostSpawn(frame, ['cat', log]);
    expect(text).toContain(`User:        ${USER}`);
    expect(text).toContain(`Source scan: ${scanTs}`);
    for (const id of ruleIds) expect(text).toContain(`  ${S.RULE}${id}`);
    expect(text).toContain('==== Script ====');
    expect(text).toContain('==== Output ====');
    expect(text).toMatch(new RegExp(`^Exit code: ${exitCode}$`, 'm'));
    const unit = text.match(/^Unit: +(\S+)$/m)[1];
    const lines = syslogFor(unit);
    expect(lines.filter(l => l.startsWith('Remediation started: '))).toHaveLength(1);
    const end = lines.filter(l => l.startsWith('Remediation finished: '));
    expect(end).toHaveLength(1);
    expect(end[0]).toContain(`user=${USER} `);
    expect(end[0]).toContain(`scan=${scanTs} `);
    expect(end[0]).toContain(`rules=${ruleIds.length} `);
    expect(end[0]).toContain(`profile=${S.PROFILE_L1} `);
    expect(end[0]).toMatch(new RegExp(` exit=${exitCode}$`));
    expect(remediationUnits()).toEqual([]);
    expect(sshApplyHost('sudo -n sh -c "ls -1d /tmp/cockpit-scap-remediate-* 2>/dev/null || true"').trim()).toBe('');
    return { log, text, unit };
}

async function waitDone(title) {
    await expect(modal().locator('.pf-v6-c-modal-box__title')).toContainText(title, { timeout: 240000 });
}

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    home = await S.homeDir(frame);
    before = await S.snapshotScans(frame);
    tmpBefore = await S.snapshotTmp(frame);
    expect(remediationUnits(), 'no remediation unit left from an earlier run').toEqual([]);
    // The v46-test content copy with the slow and the failing fix.
    testDs = `${home}/SCAP/content/${TEST_DS_NAME}`;
    sshApplyHost(`mkdir -p ~/SCAP/content && python3 -I - ${S.DS} ${testDs} <<'PY'
import re, sys
src, dst = sys.argv[1:3]
t = open(src).read()
fixes = {
    "${SLOW_RULE}": 'echo "v46-test slow fix start"\\nfor i in $(seq 1 45); do echo "v46-test tick $i"; sleep 1; done\\necho "v46-test slow fix done"\\n',
    "${FAIL_RULE}": 'echo "v46-test forced failure" &gt;&amp;2\\nexit 3\\n',
}
fix_re = re.compile(r'(<xccdf-1.2:fix [^>]*system="urn:xccdf:fix:script:sh"[^>]*>)(.*?)(</xccdf-1.2:fix>)', re.S)
for rid, body in fixes.items():
    m = re.search(r'<xccdf-1.2:Rule [^>]*id="xccdf_org.ssgproject.content_rule_%s"[^>]*>' % rid, t)
    end = t.index('</xccdf-1.2:Rule>', m.end())
    f = fix_re.search(t, m.end(), end)
    t = t[:f.start(2)] + body + t[f.end(2):]
open(dst, 'w').write(t)
PY
chmod 600 ${testDs}`);
});

test.afterAll(async () => {
    if (frame) await S.cleanupCreated(frame, before, tmpBefore);
    await page?.close();
});

test('happy path: confirm dialog, live run, success, log + syslog, rescan proves the rules pass', async ({ browserName }, info) => {
    mainScan = await runScanWith(S.DS);
    await frame.locator('[data-ct-results]').getByRole('button', { name: /^All failures \(\d+\)$/ })
            .click();
    await expect(drawer()).toBeVisible();
    const targets = (await failingInBuilder(POOL)).slice(0, 2);
    expect(targets.length, 'two low-risk rules still failing (rebuild scap-apply10 when the pool is used up)').toBe(2);
    await selectOnly(targets);
    // Apply now is first, a danger button, before the two downloads.
    const actions = await drawer().locator('.ct-builder-actions button')
            .allInnerTexts();
    expect(actions.map(a => a.trim())).toEqual(['Apply now', 'Download Bash script', 'Download Ansible playbook']);
    await expect(applyNowButton()).toHaveClass(/pf-m-danger/);
    await expect(applyNowButton()).toBeEnabled();
    await shot('builder-apply-now-admin', info);

    await applyNowButton().click();
    await expect(modal()).toBeVisible();
    await expect(modal().locator('.pf-v6-c-modal-box__title')).toContainText('Apply fixes to this host?');
    await expect(modal().locator('.ct-apply-warning')).toContainText('run as root');
    await expect(modal().locator('.ct-apply-warning')).toContainText('reboot');
    await expect(modal().locator('.ct-apply-warning')).toContainText('not undone automatically');
    await expect(modal().locator('.ct-apply-warning')).toContainText('cannot be cancelled');
    const hostname = (await hostSpawn(frame, ['hostname'])).trim();
    await expect(modal().locator('.ct-apply-host')).toHaveText(hostname);
    await expect(modal().locator('.ct-apply-scan')).toHaveText(/^Scan of .+ \(just now\)$/);
    await expect(modal().locator('.ct-apply-rule')).toHaveCount(2);
    for (const r of await modal().locator('.ct-apply-rule .pf-v6-c-label')
            .allInnerTexts()) expect(['Critical', 'High', 'Medium', 'Low', 'Unknown']).toContain(r.trim());
    const apply = modal().getByRole('button', { name: 'Apply', exact: true });
    await expect(apply).toBeEnabled({ timeout: 60000 });
    await expect(modal().locator('.ct-apply-script')).toBeHidden(); // collapsed
    await shot('confirm-collapsed', info);
    await modal().getByRole('button', { name: 'View script' })
            .click();
    const script = await modal().locator('.ct-apply-script')
            .innerText();
    for (const id of targets) expect(script).toContain(`${S.RULE}${id}`);
    expect((script.match(/^# BEGIN fix/gm) || []).length).toBe(2);
    await shot('confirm-expanded', info);
    await page.emulateMedia({ colorScheme: 'dark' });
    await shot('confirm-expanded-dark', info);
    await page.emulateMedia({ colorScheme: 'light' });

    await apply.click();
    await expect(modal().locator('.pf-v6-c-modal-box__title')).toContainText(/Applying fixes|Fixes applied/);
    await shot('running', info);
    await waitDone('Fixes applied');
    await expect(modal()).toContainText('exit code 0');
    await expect(modal().locator('.ct-apply-output')).toContainText('Remediating rule 1/2:');
    await shot('success', info);

    await checkRunRecord(mainScan, 0, targets);

    // Download log is the same file.
    const dl = await S.expectDownload(page, () => modal().getByRole('button', { name: 'Download log' })
            .click());
    expect(dl.filename).toMatch(/^remediation-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.log$/);
    expect(dl.text).toMatch(/^Exit code: 0$/m);

    // Rescan to verify: same content/profile; the fixed rules now pass.
    const scansBefore = await S.snapshotScans(frame);
    await modal().getByRole('button', { name: 'Rescan to verify' })
            .click();
    await expect(modal()).toHaveCount(0);
    await frame.locator('[data-ct-results]').waitFor({ timeout: 300000 });
    const rescan = (await S.snapshotScans(frame)).filter(ts => !scansBefore.includes(ts))[0];
    expect(rescan).toBeTruthy();
    const xml = await hostSpawn(frame, ['gzip', '-dc', `${home}/SCAP/scans/${rescan}/results.xml.gz`]);
    const manifest = JSON.parse(await hostSpawn(frame, ['cat', `${home}/SCAP/scans/${rescan}/manifest.json`]));
    expect(manifest.sds_file).toBe(S.DS);
    expect(manifest.profile_id).toBe(S.PROFILE_L1);
    for (const id of targets) {
        const m = xml.match(new RegExp(`<rule-result[^>]*idref="${S.RULE}${id}"[^>]*>[\\s\\S]*?<result>(\\w+)</result>`));
        expect(m?.[1], `${id} after the rescan`).toBe('pass');
    }
    console.log(`APPLIED ${info.project.name}: ${targets.join(', ')} fail -> pass (scan ${mainScan} -> rescan ${rescan})`);
    info.annotations.push({ type: 'applied', description: `${targets.join(', ')}: fail -> pass (scan ${mainScan} -> ${rescan})` });
});

test('empty fix: Empty remediation notice and no Apply', async () => {
    await viewFromHistory(mainScan);
    await frame.locator('[data-ct-results]').getByRole('button', { name: /^All failures \(\d+\)$/ })
            .click();
    await selectOnly([EMPTY_RULE]);
    await applyNowButton().click();
    await expect(modal().locator('.pf-v6-c-alert', { hasText: 'Empty remediation' })).toBeVisible({ timeout: 60000 });
    await expect(modal().getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
    await expect(modal().getByRole('button', { name: 'View script' })).toHaveCount(0);
    await modal().getByRole('button', { name: 'Cancel' })
            .click();
    await expect(modal()).toHaveCount(0);
    expect(remediationUnits()).toEqual([]);
});

test('non-admin (limited access): Apply now disabled with tooltip', async ({ browser }, info) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    try {
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
        await expect(f.locator('.ct-admin-needed')).toBeVisible({ timeout: 30000 });
        await f.getByRole('grid', { name: 'Scan history' }).locator('tbody tr')
                .filter({ hasText: mainScan.slice(0, 10) + ' ' + mainScan.slice(11).replace(/-/g, ':') })
                .getByRole('button', { name: 'View', exact: true })
                .click();
        await f.locator('[data-ct-results]').getByRole('button', { name: /^All failures \(\d+\)$/ })
                .click();
        const btn = f.locator('.ct-builder-drawer').getByRole('button', { name: 'Apply now' });
        await expect(btn).toHaveAttribute('aria-disabled', 'true');
        await btn.hover();
        await expect(f.getByRole('tooltip')).toContainText('Administrative access');
        await p.screenshot({ path: `${SHOTS}/builder-apply-now-limited-${info.project.name}.png` });
        await btn.click({ force: true });
        await expect(f.locator('.ct-apply-modal')).toHaveCount(0);
    } finally {
        await ctx.close();
    }
});

test('reload mid-run: unit keeps running, alert, output reattaches, run completes', async ({ browserName }, info) => {
    if (await frame.locator('[data-ct-results]').count()) await closeResults();
    testScan = await runScanWith(testDs);
    await frame.locator('[data-ct-results]').getByRole('button', { name: /^All failures \(\d+\)$/ })
            .click();
    await selectOnly([SLOW_RULE]);
    await applyNowButton().click();
    const apply = modal().getByRole('button', { name: 'Apply', exact: true });
    await expect(apply).toBeEnabled({ timeout: 60000 });
    await modal().getByRole('button', { name: 'View script' })
            .click();
    await expect(modal().locator('.ct-apply-script')).toContainText('v46-test tick');
    await apply.click();
    await expect(modal().locator('.ct-apply-output')).toContainText('v46-test tick 3', { timeout: 60000 });
    await expect(modal().locator('.ct-apply-status')).toContainText('Elapsed');
    await page.emulateMedia({ colorScheme: 'dark' });
    await shot('running-dark', info);
    await page.emulateMedia({ colorScheme: 'light' });
    const units = remediationUnits();
    expect(units).toHaveLength(1);
    const unit = units[0];

    await page.reload();
    await reopenFrame();
    const alert = frame.locator('.ct-remediation-alert');
    await expect(alert).toContainText(/A remediation is running on this host \(started .+\)/, { timeout: 30000 });
    expect(sshApplyHost(`systemctl show -p ActiveState --value ${unit}`).trim()).toBe('activating');
    await shot('reattach-alert', info);

    // While it runs: Run Scan and Apply now are disabled.
    const runScan = frame.getByRole('button', { name: 'Run Scan' });
    await expect(runScan).toHaveAttribute('aria-disabled', 'true');
    await runScan.hover();
    await expect(frame.getByRole('tooltip')).toContainText('A remediation is running');
    await viewFromHistory(testScan);
    await frame.locator('[data-ct-results]').getByRole('button', { name: /^All failures \(\d+\)$/ })
            .click();
    await expect(applyNowButton()).toHaveAttribute('aria-disabled', 'true');
    await applyNowButton().hover();
    await expect(frame.getByRole('tooltip')).toContainText('already running');
    await frame.getByRole('button', { name: 'Close Remediation Builder' }).click();

    await alert.getByRole('button', { name: 'View output' }).click();
    await expect(modal()).toBeVisible();
    // Reattached from the first byte, not just what came after the reload.
    await expect(modal().locator('.ct-apply-output')).toContainText('v46-test tick 1\n');
    await waitDone('Fixes applied');
    await expect(modal().locator('.ct-apply-output')).toContainText('v46-test slow fix done');
    await checkRunRecord(testScan, 0, [SLOW_RULE]);
    await modal().locator('.pf-v6-c-modal-box__footer')
            .getByRole('button', { name: 'Close' })
            .click();
    await expect(modal()).toHaveCount(0);
    await expect(frame.locator('.ct-remediation-alert')).toHaveCount(0);
});

test('forced failure from History -> View of an older scan: age shown, exit code, log and syslog', async ({ browserName }, info) => {
    // The scan must be at least a minute old so the dialog shows its age.
    const scanTime = Date.parse(testScan.slice(0, 11) + testScan.slice(11).replace(/-/g, ':') + 'Z');
    const wait = scanTime + 65000 - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    await viewFromHistory(testScan);
    await frame.locator('[data-ct-results]').getByRole('button', { name: /^All failures \(\d+\)$/ })
            .click();
    await selectOnly([FAIL_RULE]);
    await applyNowButton().click();
    await expect(modal().locator('.ct-apply-scan')).toHaveText(/^Scan of .+ \(\d+ minutes? ago\)$/);
    const apply = modal().getByRole('button', { name: 'Apply', exact: true });
    await expect(apply).toBeEnabled({ timeout: 60000 });
    await apply.click();
    await waitDone('Remediation failed');
    await expect(modal()).toContainText('The remediation failed (exit code 3)');
    await expect(modal().locator('.ct-apply-output')).toContainText('v46-test forced failure');
    await expect(modal().getByRole('button', { name: 'Rescan to verify' })).toBeVisible();
    await expect(modal().getByRole('button', { name: 'Download log' })).toBeVisible();
    await shot('failure', info);
    await checkRunRecord(testScan, 3, [FAIL_RULE]);
    await modal().locator('.pf-v6-c-modal-box__footer')
            .getByRole('button', { name: 'Close' })
            .click();
    await expect(modal()).toHaveCount(0);
});

test('page closed mid-run: the unit finishes, logs and cleans up with no page open', async ({ browser }) => {
    await viewFromHistory(testScan);
    await frame.locator('[data-ct-results]').getByRole('button', { name: /^All failures \(\d+\)$/ })
            .click();
    await selectOnly([SLOW_RULE]);
    await applyNowButton().click();
    const apply = modal().getByRole('button', { name: 'Apply', exact: true });
    await expect(apply).toBeEnabled({ timeout: 60000 });
    await apply.click();
    await expect(modal().locator('.ct-apply-output')).toContainText('v46-test tick 2', { timeout: 60000 });
    const [unit] = remediationUnits();
    expect(unit).toBeTruthy();
    const logsBefore = (await hostSpawn(frame, ['sh', '-c', `ls -1 "${home}/SCAP/scans/${testScan}"/remediation-*.log`])).split('\n').filter(Boolean);

    await page.close();
    expect(sshApplyHost(`systemctl show -p ActiveState --value ${unit}`).trim()).toBe('activating');
    await expect.poll(() => remediationUnits(), { timeout: 120000, intervals: [3000] }).toEqual([]);

    page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    const logsAfter = (await hostSpawn(frame, ['sh', '-c', `ls -1 "${home}/SCAP/scans/${testScan}"/remediation-*.log`])).split('\n').filter(Boolean);
    expect(logsAfter.length).toBe(logsBefore.length + 1);
    const { text } = await checkRunRecord(testScan, 0, [SLOW_RULE]);
    expect(text).toContain(`Unit:        ${unit.replace(/\.service$/, '')}\n`);
    expect(text).toContain('v46-test slow fix done');
    // Nothing to reattach to: no alert.
    await expect(frame.locator('.ct-remediation-alert')).toHaveCount(0);
});
