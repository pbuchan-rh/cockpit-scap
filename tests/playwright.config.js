// @ts-check
const { defineConfig, devices } = require('@playwright/test');
require('dotenv').config({ path: __dirname + '/.env' });

module.exports = defineConfig({
    globalSetup:    __dirname + '/global-setup.js',
    globalTeardown: __dirname + '/global-teardown.js',
    testDir: __dirname,
    testMatch: '**/*.spec.js',
    timeout: 600000,          // 10 min per test — PCI-DSS on hardened host can exceed 5 min
    expect: { timeout: 30000 },
    fullyParallel: false,     // Cockpit session is shared state
    workers: 1,
    reporter: [
        [__dirname + '/reporters/dashboard-reporter.js'],
        ['html', { outputFolder: __dirname + '/report', open: 'never' }],
    ],
    use: {
        baseURL: process.env.COCKPIT_URL,
        ignoreHTTPSErrors: true,
        screenshot: 'on',
        video: 'retain-on-failure',
        trace: 'retain-on-failure',
        actionTimeout: 30000,
    },
    outputDir: __dirname + '/screenshots',
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    ],
});
