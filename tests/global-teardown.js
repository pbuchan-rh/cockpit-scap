/**
 * Playwright global teardown — runs once after all tests complete.
 * Removes playwright-created test artifacts from the test host so they
 * don't accumulate across runs.
 */
const { execSync } = require('child_process');
require('dotenv').config({ path: __dirname + '/.env' });

const COCKPIT_URL  = process.env.COCKPIT_URL  || 'https://your-host:9090';
const COCKPIT_USER = process.env.COCKPIT_USER || 'pbuchan';

const hostname = COCKPIT_URL.replace(/^https?:\/\//, '').replace(/:.*$/, '');

module.exports = async function globalTeardown() {
    const target = `${COCKPIT_USER}@${hostname}`;
    const cmds = [
        'rm -f /var/lib/cockpit-scap/tailoring/playwright-*',
    ];
    for (const cmd of cmds) {
        try {
            execSync(`ssh -o StrictHostKeyChecking=no ${target} "sudo -n ${cmd}"`, { stdio: 'pipe' });
        } catch (e) {
            console.warn(`\n[teardown] cleanup command failed: ${cmd}\n  ${e.message}`);
        }
    }
    console.log('\n[teardown] playwright test artifacts cleaned from test host');
};
