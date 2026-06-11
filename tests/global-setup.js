/**
 * Playwright global setup — runs once before all tests.
 * Restores known-good settings on the test host so tabs are in the expected
 * state regardless of what the previous run left behind.
 */
const { execSync } = require('child_process');
require('dotenv').config({ path: __dirname + '/.env' });

const COCKPIT_URL  = process.env.COCKPIT_URL  || 'https://your-host:9090';
const COCKPIT_USER = process.env.COCKPIT_USER || 'pbuchan';

const hostname = COCKPIT_URL.replace(/^https?:\/\//, '').replace(/:.*$/, '');
const target   = `${COCKPIT_USER}@${hostname}`;

const DEFAULT_SETTINGS = JSON.stringify({
    host_retention:         10,
    container_retention:    10,
    container_scan_enabled: true,
    dashboard_enabled:      true,
    tailoring_enabled:      true,
}, null, 2);

module.exports = async function globalSetup() {
    try {
        execSync(
            `echo '${DEFAULT_SETTINGS}' | ssh -o StrictHostKeyChecking=no ${target} "sudo tee /var/lib/cockpit-scap/settings.json"`,
            { stdio: 'pipe' }
        );
        console.log('\n[setup] settings restored to known-good state');
    } catch (e) {
        console.warn('\n[setup] could not restore settings (tests may skip dashboard/container tabs):', e.message);
    }

    try {
        execSync(
            `ssh -o StrictHostKeyChecking=no ${target} "sudo -n chmod -R a+r /var/lib/cockpit-scap/results"`,
            { stdio: 'pipe' }
        );
        console.log('[setup] results permissions relaxed (remediation scripts readable)');
    } catch (e) {
        console.warn('[setup] could not relax results permissions:', e.message);
    }
};
