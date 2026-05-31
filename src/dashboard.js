'use strict';

/* ============================================================
   Compliance Dashboard — all logic contained here.
   Entry point: initDashboard()
   ============================================================ */

const DB_RESULTS_BASE = '/var/lib/cockpit-scap/results/';

let dbLoaded   = false;
let dbHostname = null;

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
                const valid = manifests.filter(Boolean);
                valid.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

                const hostMans = valid.filter(m => m.scan_type !== 'container');
                const csMans   = valid.filter(m => m.scan_type === 'container');

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

function renderDashboard(el, hostManifests, containerManifests) {
    const sections = [];

    if (hostManifests.length > 0) {
        const latest = hostManifests[0];
        const prev   = hostManifests[1] || null;
        sections.push(
            '<div class="db-section">' +
                '<h3 class="db-section-title">Host</h3>' +
                '<div class="db-cards">' +
                    buildStatusCard({
                        title:   dbHostname || 'This Host',
                        manifest: latest,
                        prev:    prev,
                        goTabId: 'tab-btn-scan',
                        goLabel: 'Go to Host Scan',
                    }) +
                '</div>' +
            '</div>'
        );
    }

    if (containerManifests.length > 0) {
        const byImage = {};
        const prevByImage = {};
        containerManifests.forEach(m => {
            const key = m.image_id || m.image_name || 'unknown';
            if (!byImage[key]) {
                byImage[key] = m;
            } else if (!prevByImage[key]) {
                prevByImage[key] = m;
            }
        });

        const cards = Object.values(byImage).map(m => {
            const key = m.image_id || m.image_name || 'unknown';
            return buildStatusCard({
                title:    m.image_name || m.image_id || 'Container',
                manifest: m,
                prev:     prevByImage[key] || null,
                goTabId:  'tab-btn-container-scan',
                goLabel:  'Go to Container Scan',
            });
        }).join('');

        sections.push(
            '<div class="db-section">' +
                '<h3 class="db-section-title">Container Images</h3>' +
                '<div class="db-cards">' + cards + '</div>' +
            '</div>'
        );
    }

    if (!sections.length) {
        renderEmpty(el);
        return;
    }

    el.innerHTML = sections.join('');

    el.querySelectorAll('[data-go-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById(btn.dataset.goTab).click();
        });
    });
}

function buildStatusCard({ title, manifest, prev, goTabId, goLabel }) {
    const score    = parseFloat(manifest.score);
    const hasScore = !isNaN(score);
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

    const counts       = manifest.counts || {};
    const pass         = counts.pass  != null ? counts.pass  : '—';
    const fail         = counts.fail  != null ? counts.fail  : '—';
    const profileLabel = manifest.profile_title || manifest.profile_id || '—';
    const sdsBase      = manifest.sds_file ? manifest.sds_file.split('/').pop() : '';
    const contentLabel = sdsBase || '—';
    const age          = manifest.timestamp ? dbRelativeTime(manifest.timestamp) : '—';

    return (
        '<div class="pf-v6-c-card db-status-card">' +
            '<div class="pf-v6-c-card__header">' +
                '<div class="pf-v6-c-card__title">' +
                    '<h4 class="pf-v6-title pf-m-md db-card-title">' + escHtml(title) + '</h4>' +
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
                        '<span class="db-meta-label">Profile</span>' +
                        '<span class="db-meta-value">' + escHtml(profileLabel) + '</span>' +
                    '</div>' +
                    '<div class="db-meta-row">' +
                        '<span class="db-meta-label">Content</span>' +
                        '<span class="db-meta-value">' + escHtml(contentLabel) + '</span>' +
                    '</div>' +
                    '<div class="db-meta-row">' +
                        '<span class="db-meta-label">Pass / Fail</span>' +
                        '<span class="db-meta-value">' +
                            '<span class="ct-pass-count">' + pass + ' pass</span>' +
                            ' &nbsp;' +
                            '<span class="ct-fail-count">' + fail + ' fail</span>' +
                        '</span>' +
                    '</div>' +
                    '<div class="db-meta-row">' +
                        '<span class="db-meta-label">Last scan</span>' +
                        '<span class="db-meta-value">' + escHtml(age) + '</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="pf-v6-c-card__footer">' +
                '<button class="pf-v6-c-button pf-m-link" type="button" data-go-tab="' + goTabId + '">' +
                    goLabel +
                '</button>' +
            '</div>' +
        '</div>'
    );
}

/* ---- Utilities --------------------------------------------- */

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
