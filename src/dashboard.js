'use strict';

/* ============================================================
   Compliance Dashboard — all logic contained here.
   Entry point: initDashboard()
   ============================================================ */

const DB_RESULTS_BASE = '/var/lib/cockpit-scap/results/';

let dbLoaded    = false;
let dbHostname  = null;
let dbManifests = [];

function dbInvalidate() { dbLoaded = false; }

function initDashboard() {
    cockpit.spawn(['hostname'], { err: 'message' })
        .then(h => { dbHostname = h.trim(); })
        .catch(() => { dbHostname = null; });

    document.getElementById('tab-btn-dashboard')
        .addEventListener('click', () => {
            if (dbLoaded) return;
            loadDashboard();
        });

    document.getElementById('db-refresh-btn')
        .addEventListener('click', () => {
            dbLoaded = false;
            loadDashboard();
        });
}

/* ---- Data loading ------------------------------------------ */

function loadDashboard() {
    const el = document.getElementById('db-content');
    el.innerHTML = '<p class="db-loading">Loading&#8230;</p>';

    cockpit.spawn(['ls', DB_RESULTS_BASE], { err: 'message' })
        .then(output => {
            const dirs = output.trim().split('\n')
                .filter(d => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(d));

            if (!dirs.length) {
                renderEmpty(el);
                dbLoaded = true;
                return;
            }

            return Promise.all(
                dirs.map(dir =>
                    cockpit.file(DB_RESULTS_BASE + dir + '/manifest.json').read()
                        .then(content => JSON.parse(content))
                        .catch(() => null)
                )
            ).then(manifests => {
                dbManifests = manifests.filter(Boolean);
                dbManifests.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

                const hostMans = dbManifests.filter(m => m.scan_type !== 'container');
                const csMans   = dbManifests.filter(m => m.scan_type === 'container');

                renderDashboard(el, hostMans, csMans);
                dbLoaded = true;
            });
        })
        .catch(() => {
            renderEmpty(document.getElementById('db-content'));
            dbLoaded = true;
        });
}

/* ---- Rendering --------------------------------------------- */

function renderEmpty(el) {
    el.innerHTML =
        '<div class="db-empty-state">' +
            '<p class="db-empty-title">No scans yet</p>' +
            '<p class="db-empty-body">Run your first scan to see your compliance posture here.</p>' +
            '<button class="pf-v6-c-button pf-m-primary" type="button" id="db-go-scan-btn">Go to Host Scan</button>' +
        '</div>';
    document.getElementById('db-go-scan-btn')
        .addEventListener('click', () => document.getElementById('tab-btn-scan').click());
}

const STALE_WARN_DAYS = 7;
const STALE_ERR_DAYS  = 14;

function renderDashboard(el, hostManifests, containerManifests) {
    if (!hostManifests.length && !containerManifests.length) {
        renderEmpty(el);
        return;
    }

    const hostGroups = hostManifests.length
        ? groupManifests(hostManifests, m => (m.profile_id || '') + '|' + (m.sds_file || ''))
        : [];
    const csGroups = containerManifests.length
        ? groupManifests(containerManifests, m => m.image_id || m.image_name || 'unknown')
        : [];

    const allGroups  = [...hostGroups, ...csGroups];
    const bannerHtml = buildAttentionBanner(allGroups);
    const sections   = [];

    if (hostGroups.length) {
        const cards = hostGroups.map(group =>
            buildStatusCard({
                title:    group[0].profile_title || group[0].profile_id || 'Unknown Profile',
                subtitle: dbHostname || 'This Host',
                group,
                goTabId:  'tab-btn-scan',
                goLabel:  'Go to Host Scan',
                scanType: 'host',
            })
        ).join('');
        sections.push(
            '<div class="db-section">' +
                '<h3 class="db-section-title">Host — ' + escHtml(dbHostname || 'This Host') + '</h3>' +
                '<div class="db-cards">' + cards + '</div>' +
            '</div>'
        );
    }

    if (csGroups.length) {
        const cards = csGroups.map(group =>
            buildStatusCard({
                title:    group[0].image_name || group[0].image_id || 'Container',
                subtitle: group[0].profile_title || group[0].profile_id || '',
                group,
                goTabId:  'tab-btn-container-scan',
                goLabel:  'Go to Container Scan',
                scanType: 'container',
            })
        ).join('');
        sections.push(
            '<div class="db-section">' +
                '<h3 class="db-section-title">Container Images</h3>' +
                '<div class="db-cards">' + cards + '</div>' +
            '</div>'
        );
    }

    el.innerHTML = bannerHtml + sections.join('');

    el.querySelectorAll('[data-go-tab]').forEach(btn => {
        btn.addEventListener('click', () =>
            document.getElementById(btn.dataset.goTab).click());
    });

    el.querySelectorAll('[data-view-ts]').forEach(btn => {
        btn.addEventListener('click', () => {
            const m = dbManifests.find(x => x.timestamp === btn.dataset.viewTs);
            if (!m) return;
            if (m.scan_type === 'container') {
                document.getElementById('tab-btn-container-scan').click();
                csLoadScanFromHistory(m);
            } else {
                document.getElementById('tab-btn-scan').click();
                loadScanFromHistory(m);
            }
        });
    });

    el.querySelectorAll('[data-quick-ts]').forEach(btn => {
        btn.addEventListener('click', () => {
            const m = dbManifests.find(x => x.timestamp === btn.dataset.quickTs);
            if (!m) return;
            if (m.scan_type === 'container') {
                csRerunScan(m, true);
            } else {
                rerunHostScan(m, true);
            }
        });
    });
}

function buildAttentionBanner(groups) {
    const regressed = [];
    const stale     = [];

    groups.forEach(group => {
        const m     = group[0];
        const prev  = group[1];
        const label = m.profile_title || m.profile_id || m.image_name || 'Unknown';
        const ageDays = dbAgeDays(m.timestamp);

        if (prev && prev.fail != null && m.counts && m.counts.fail != null) {
            if (m.counts.fail > prev.counts.fail) regressed.push(label);
        }
        if (ageDays !== null && ageDays >= STALE_WARN_DAYS) stale.push(label);
    });

    if (!regressed.length && !stale.length) {
        return '<div class="db-attention-banner db-attention-ok">' +
            '&#10003; All profiles current — no regressions detected.' +
        '</div>';
    }

    const items = [];
    if (regressed.length) {
        items.push(regressed.length + ' profile' + (regressed.length > 1 ? 's have' : ' has') +
            ' regressed since the previous scan');
    }
    if (stale.length) {
        items.push(stale.length + ' profile' + (stale.length > 1 ? 's have' : ' has') +
            ' not been scanned in ' + STALE_WARN_DAYS + '+ days');
    }

    return '<div class="db-attention-banner db-attention-warn">' +
        '&#9888; Needs attention: ' + items.join(' &nbsp;&middot;&nbsp; ') +
    '</div>';
}

function groupManifests(manifests, keyFn) {
    const map = {};
    manifests.forEach(m => {
        const k = keyFn(m);
        if (!map[k]) map[k] = [];
        map[k].push(m);
    });
    return Object.values(map);
}

function buildStatusCard({ title, subtitle, group, goTabId, goLabel, scanType }) {
    const manifest  = group[0];
    const prev      = group[1] || null;
    const score     = parseFloat(manifest.score);
    const hasScore  = !isNaN(score);

    const scoreClass = hasScore
        ? (score >= 80 ? 'db-score-green' : score >= 50 ? 'db-score-yellow' : 'db-score-red')
        : 'db-score-grey';
    const scoreDisplay = hasScore ? score.toFixed(1) + '%' : '—';

    let deltaHtml = '';
    if (hasScore && prev && prev.score != null) {
        const prevScore = parseFloat(prev.score);
        if (!isNaN(prevScore) && Math.abs(score - prevScore) >= 0.05) {
            const delta = score - prevScore;
            const sign  = delta > 0 ? '+' : '';
            const cls   = delta > 0 ? 'db-delta-up' : 'db-delta-down';
            const arrow = delta > 0 ? '↑' : '↓';
            deltaHtml = '<span class="db-score-delta ' + cls + '">' +
                arrow + ' ' + sign + delta.toFixed(1) + '%' +
            '</span>';
        }
    }

    const scores = group
        .map(m => parseFloat(m.score))
        .filter(s => !isNaN(s))
        .reverse();

    const counts       = manifest.counts || {};
    const pass         = counts.pass != null ? counts.pass : '—';
    const fail         = counts.fail != null ? counts.fail : '—';
    const sdsBase      = manifest.sds_file ? manifest.sds_file.split('/').pop() : '';
    const age          = manifest.timestamp ? dbRelativeTime(manifest.timestamp) : '—';
    const ageDays      = dbAgeDays(manifest.timestamp);

    const staleClass = ageDays !== null && ageDays >= STALE_ERR_DAYS ? 'db-stale-err'
                     : ageDays !== null && ageDays >= STALE_WARN_DAYS ? 'db-stale-warn'
                     : '';
    const staleBadge = staleClass
        ? '<span class="db-stale-badge ' + staleClass + '">Stale</span>'
        : '';

    const trendHtml = buildSparkline(scores);

    const subtitleHtml = subtitle
        ? '<p class="db-card-subtitle">' + escHtml(subtitle) + '</p>'
        : '';

    return (
        '<div class="pf-v6-c-card db-status-card">' +
            '<div class="pf-v6-c-card__header">' +
                '<div class="pf-v6-c-card__title db-card-title-row">' +
                    '<div>' +
                        '<h4 class="pf-v6-title pf-m-md db-card-title">' + escHtml(title) + '</h4>' +
                        subtitleHtml +
                    '</div>' +
                    staleBadge +
                '</div>' +
            '</div>' +
            '<div class="pf-v6-c-card__body db-card-body">' +
                '<div class="db-score-block ' + scoreClass + '">' +
                    '<span class="db-score-value">' + scoreDisplay + '</span>' +
                    '<span class="db-score-label">compliance score</span>' +
                    deltaHtml +
                '</div>' +
                '<div class="db-meta">' +
                    '<div class="db-meta-row">' +
                        '<span class="db-meta-label">Content</span>' +
                        '<span class="db-meta-value">' + escHtml(sdsBase || '—') + '</span>' +
                    '</div>' +
                    '<div class="db-meta-row">' +
                        '<span class="db-meta-label">Pass / Fail</span>' +
                        '<span class="db-meta-value">' +
                            '<span class="ct-pass-count">' + escHtml(String(pass)) + ' pass</span>' +
                            ' &nbsp;' +
                            '<span class="ct-fail-count">' + escHtml(String(fail)) + ' fail</span>' +
                        '</span>' +
                    '</div>' +
                    '<div class="db-meta-row">' +
                        '<span class="db-meta-label">Last scan</span>' +
                        '<span class="db-meta-value">' + escHtml(age) + '</span>' +
                    '</div>' +
                    '<div class="db-meta-row">' +
                        '<span class="db-meta-label">Scans tracked</span>' +
                        '<span class="db-meta-value">' + group.length + '</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            (trendHtml ? '<div class="db-trend">' + trendHtml + '</div>' : '') +
            '<div class="pf-v6-c-card__footer db-card-footer">' +
                '<button class="pf-v6-c-button pf-m-primary pf-m-small" type="button" ' +
                        'data-quick-ts="' + escHtml(manifest.timestamp) + '">Quick Scan</button>' +
                '<button class="pf-v6-c-button pf-m-link" type="button" ' +
                        'data-view-ts="' + escHtml(manifest.timestamp) + '" ' +
                        'data-scan-type="' + scanType + '">View Last Scan</button>' +
                '<button class="pf-v6-c-button pf-m-link" type="button" ' +
                        'data-go-tab="' + goTabId + '">' + goLabel + '</button>' +
            '</div>' +
        '</div>'
    );
}

function buildSparkline(scores) {
    if (scores.length < 2) return '';
    const W = 200, H = 28, pad = 2;
    const pts = scores.map((s, i) => {
        const x = pad + (i / (scores.length - 1)) * (W - pad * 2);
        const y = pad + ((100 - s) / 100) * (H - pad * 2);
        return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    const trending = scores[scores.length - 1] >= scores[0];
    const color = trending ? 'var(--ct-color-success)' : 'var(--ct-color-danger)';
    return (
        '<svg class="db-sparkline" viewBox="0 0 ' + W + ' ' + H + '" ' +
              'preserveAspectRatio="none" aria-hidden="true">' +
            '<polyline points="' + pts + '" fill="none" stroke="' + color + '" ' +
                      'stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
        '</svg>'
    );
}

/* ---- Utilities --------------------------------------------- */

function dbAgeDays(timestamp) {
    if (!timestamp) return null;
    const iso  = timestamp.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3');
    const then = new Date(iso);
    if (isNaN(then)) return null;
    return Math.floor((Date.now() - then.getTime()) / 86400000);
}

function dbRelativeTime(timestamp) {
    const iso  = timestamp.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3');
    const then = new Date(iso);
    if (isNaN(then)) return timestamp;
    const diffMs  = Date.now() - then.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1)   return 'just now';
    if (diffMin < 60)  return diffMin + ' minute' + (diffMin === 1 ? '' : 's') + ' ago';
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24)   return diffHr + ' hour' + (diffHr === 1 ? '' : 's') + ' ago';
    const diffDay = Math.floor(diffHr / 24);
    return diffDay + ' day' + (diffDay === 1 ? '' : 's') + ' ago';
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
