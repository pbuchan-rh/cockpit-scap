// Custom Playwright reporter — live ASCII dashboard
// Shows per-file grouping, inline progress bar, and final summary.

const C = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    dim:    '\x1b[2m',
    green:  '\x1b[32m',
    red:    '\x1b[31m',
    yellow: '\x1b[33m',
    cyan:   '\x1b[36m',
    gray:   '\x1b[90m',
};

const isTTY = process.stdout.isTTY;

class DashboardReporter {
    constructor() {
        this.passed      = 0;
        this.failed      = 0;
        this.skipped     = 0;
        this.total       = 0;
        this.start       = null;
        this.currentFile = null;
        this._barShown   = false;
        this._failures   = [];
    }

    _elapsed() {
        const s = Math.floor((Date.now() - this.start) / 1000);
        return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
    }

    _clearBar() {
        if (isTTY && this._barShown) {
            process.stdout.write('\r\x1b[K');
            this._barShown = false;
        }
    }

    _printBar() {
        if (!isTTY) return;
        const done = this.passed + this.failed + this.skipped;
        const fill = Math.floor((done / Math.max(this.total, 1)) * 28);
        const bar  = '█'.repeat(fill) + '░'.repeat(28 - fill);
        process.stdout.write(
            `  ${C.dim}[${bar}]${C.reset} ` +
            `${C.dim}${done}/${this.total}${C.reset}  ` +
            `${C.green}✓ ${this.passed}${C.reset}  ` +
            `${C.red}✗ ${this.failed}${C.reset}  ` +
            `${C.yellow}- ${this.skipped}${C.reset}  ` +
            `${C.gray}${this._elapsed()}${C.reset}`
        );
        this._barShown = true;
    }

    _println(line = '') {
        this._clearBar();
        console.log(line);
        this._printBar();
    }

    onBegin(_config, suite) {
        this.total = suite.allTests().length;
        this.start = Date.now();
        const pad = '═'.repeat(54);
        console.log(`\n${C.cyan}${C.bold}╔${pad}╗${C.reset}`);
        console.log(`${C.cyan}${C.bold}║${'cockpit-scap  ·  Playwright Test Suite'.padStart(46).padEnd(54)}║${C.reset}`);
        console.log(`${C.cyan}${C.bold}╚${pad}╝${C.reset}`);
        this._printBar();
    }

    onTestEnd(test, result) {
        const file  = test.location.file.split('/').pop().replace('.spec.js', '');
        const title = test.title.length > 48 ? test.title.slice(0, 45) + '...' : test.title;
        const dur   = result.duration ? `${C.gray}(${(result.duration / 1000).toFixed(1)}s)${C.reset}` : '';

        if (file !== this.currentFile) {
            this.currentFile = file;
            this._println(`\n  ${C.bold}${C.cyan}[ ${file} ]${C.reset}`);
        }

        if (result.status === 'passed') {
            this.passed++;
            this._println(`  ${C.green}✓${C.reset}  ${title.padEnd(50)} ${dur}`);
        } else if (result.status === 'failed' || result.status === 'timedOut') {
            this.failed++;
            this._println(`  ${C.red}✗${C.reset}  ${C.bold}${title}${C.reset}`.padEnd(54) + ` ${dur}`);
            const msg = (result.error?.message || '').split('\n')[0].slice(0, 76);
            if (msg) this._println(`     ${C.red}${C.dim}${msg}${C.reset}`);
            this._failures.push({ file, title, msg });
        } else {
            this.skipped++;
            this._println(`  ${C.yellow}-${C.reset}  ${C.dim}${title}${C.reset}`);
        }
    }

    onEnd(_result) {
        this._clearBar();

        const line = '─'.repeat(54);
        console.log(`\n  ${C.dim}${line}${C.reset}`);

        const ok     = this.failed === 0;
        const status = ok
            ? `${C.green}${C.bold}  PASSED${C.reset}`
            : `${C.red}${C.bold}  FAILED${C.reset}`;

        console.log(
            `${status}   ` +
            `${C.green}${this.passed} passed${C.reset}   ` +
            `${this.failed > 0 ? C.red : C.dim}${this.failed} failed${C.reset}   ` +
            `${C.yellow}${this.skipped} skipped${C.reset}   ` +
            `${C.gray}${this._elapsed()}${C.reset}`
        );
        console.log(`  ${C.dim}${line}${C.reset}\n`);

        if (this._failures.length > 0) {
            console.log(`  ${C.red}${C.bold}Failures:${C.reset}`);
            this._failures.forEach(({ file, title, msg }) => {
                console.log(`    ${C.red}✗${C.reset}  [${file}] ${title}`);
                if (msg) console.log(`       ${C.dim}${msg}${C.reset}`);
            });
            console.log(`\n  ${C.yellow}Full report:${C.reset} tests/report/index.html\n`);
        }
    }
}

module.exports = DashboardReporter;
