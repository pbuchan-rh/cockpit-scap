'use strict';

/* ============================================================
   Compliance Dashboard — all logic contained here.
   Entry point: initDashboard()
   ============================================================ */

const DB_RESULTS_BASE      = '/var/lib/cockpit-scap/results/';
const DB_PERSISTENCE_CACHE = '/var/lib/cockpit-scap/persistence-cache.json';

const PY_EXTRACT_HIGH_FAILURES = [
    'import xml.etree.ElementTree as ET, json, sys',
    'res, sds = sys.argv[1], sys.argv[2]',
    'NS = "http://checklists.nist.gov/xccdf/1.2"',
    'def t(n): return "{"+NS+"}"+n',
    'def u(e): return e.split("}")[-1] if "}" in e else e',
    'fails = set()',
    'for _, el in ET.iterparse(res, events=("end",)):',
    '    if u(el.tag) == "rule-result":',
    '        if el.get("severity","") == "high":',
    '            for ch in el:',
    '                if u(ch.tag) == "result" and (ch.text or "").strip() == "fail":',
    '                    fails.add(el.get("idref",""))',
    '        el.clear()',
    'if not fails:',
    '    print("[]"); sys.exit(0)',
    'titles = {}',
    'for _, el in ET.iterparse(sds, events=("end",)):',
    '    if el.tag == t("Rule") and el.get("id","") in fails:',
    '        tl = el.find(t("title"))',
    '        titles[el.get("id","")] = (tl.text or "").strip() if tl is not None else el.get("id","")',
    '        el.clear()',
    'out = [{"id": rid, "title": titles.get(rid, rid)} for rid in sorted(fails)]',
    'print(json.dumps(out))',
].join('\n');

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

    const cacheRead = cockpit.file(DB_PERSISTENCE_CACHE).read()
        .then(data => (data && data.trim()) ? JSON.parse(data) : { profiles: {} })
        .catch(() => ({ profiles: {} }));

    cockpit.spawn(['ls', DB_RESULTS_BASE], { err: 'message' })
        .then(output => {
            const dirs = output.trim().split('\n')
                .filter(d => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(d));

            if (!dirs.length) {
                renderEmpty(el);
                dbLoaded = true;
                return;
            }

            return Promise.all([
                Promise.all(
                    dirs.map(dir =>
                        cockpit.file(DB_RESULTS_BASE + dir + '/manifest.json').read()
                            .then(content => JSON.parse(content))
                            .catch(() => null)
                    )
                ),
                cacheRead,
            ]).then(([manifests, persistenceCache]) => {
                dbManifests = manifests.filter(Boolean);
                dbManifests.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

                const hostMans = dbManifests.filter(m => m.scan_type !== 'container');
                const csMans   = dbManifests.filter(m => m.scan_type === 'container');

                renderDashboard(el, hostMans, csMans, persistenceCache);
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

function renderDashboard(el, hostManifests, containerManifests, persistenceCache) {
    if (!hostManifests.length && !containerManifests.length) {
        renderEmpty(el);
        return;
    }

    /* Build unique profile list sorted by most recently scanned */
    const profileMap = {};
    hostManifests.forEach(m => {
        const key = m.profile_id + '|' + m.sds_file;
        if (!profileMap[key]) profileMap[key] = m;
    });
    const profiles = Object.values(profileMap)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const selectedKey = profiles.length ? profiles[0].profile_id + '|' + profiles[0].sds_file : null;

    /* Profile selector row (only shown when multiple profiles exist) */
    let selectorHtml = '';
    if (profiles.length > 1) {
        const opts = profiles.map(p =>
            '<option value="' + escHtml(p.profile_id + '|' + p.sds_file) + '">' +
                escHtml(p.profile_title || p.profile_id) +
            '</option>'
        ).join('');
        selectorHtml =
            '<div class="db-profile-row">' +
                '<label class="db-profile-label" for="db-profile-select">Profile</label>' +
                '<select class="pf-v6-c-form-control db-profile-select" id="db-profile-select">' +
                    opts +
                '</select>' +
            '</div>';
    }

    /* Host timeline section */
    let hostHtml = '';
    if (hostManifests.length && selectedKey) {
        hostHtml = '<div id="db-host-section">' +
            renderHostSection(hostManifests, selectedKey, persistenceCache) +
        '</div>';
    }

    /* Container section */
    let containerHtml = '';
    if (containerManifests.length) {
        const csGroups = groupManifests(containerManifests,
            m => m.image_id || m.image_name || 'unknown');
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
        containerHtml =
            '<div class="db-section">' +
                '<h3 class="db-section-title">Container Images</h3>' +
                '<div class="db-cards">' + cards + '</div>' +
            '</div>';
    }

    el.innerHTML = selectorHtml + hostHtml + containerHtml;

    wireHostSectionEvents(el, hostManifests, selectedKey, persistenceCache);

    /* Profile selector change */
    const sel = document.getElementById('db-profile-select');
    if (sel) {
        sel.addEventListener('change', () => {
            const key = sel.value;
            const section = document.getElementById('db-host-section');
            if (section) {
                section.innerHTML = renderHostSection(hostManifests, key, persistenceCache);
                wireHostSectionEvents(section, hostManifests, key, persistenceCache);
            }
        });
    }

    /* Container view/quick buttons */
    el.querySelectorAll('[data-view-ts][data-scan-type="container"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const m = dbManifests.find(x => x.timestamp === btn.dataset.viewTs);
            if (!m) return;
            document.getElementById('tab-btn-container-scan').click();
            csLoadScanFromHistory(m);
        });
    });
    el.querySelectorAll('[data-quick-ts][data-scan-type="container"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const m = dbManifests.find(x => x.timestamp === btn.dataset.quickTs);
            if (m) csRerunScan(m, true);
        });
    });
}

function renderHostSection(hostManifests, profileKey, persistenceCache) {
    const [profileId, sdsFile] = profileKey.split('|');
    const filtered = hostManifests.filter(m =>
        m.profile_id === profileId && m.sds_file === sdsFile
    ).sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (!filtered.length) return '';

    const latest = filtered[0];
    const prev   = filtered[1] || null;
    const profileData = (persistenceCache.profiles || {})[profileId] || null;

    return buildHostTimeline(latest, prev, filtered, profileData);
}

function wireHostSectionEvents(root, hostManifests, profileKey, persistenceCache) {
    const [profileId] = profileKey.split('|');
    const profileData = (persistenceCache.profiles || {})[profileId] || null;

    /* View last scan */
    root.querySelectorAll('[data-view-ts][data-scan-type="host"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const m = dbManifests.find(x => x.timestamp === btn.dataset.viewTs);
            if (!m) return;
            document.getElementById('tab-btn-scan').click();
            loadScanFromHistory(m);
        });
    });

    /* Quick scan */
    root.querySelectorAll('[data-quick-ts][data-scan-type="host"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const m = dbManifests.find(x => x.timestamp === btn.dataset.quickTs);
            if (m) rerunHostScan(m, true);
        });
    });

    /* Persistent failure row → rule detail drawer */
    root.querySelectorAll('[data-persist-rule-id]').forEach(row => {
        row.addEventListener('click', () => {
            const rid  = row.dataset.persistRuleId;
            const rule = dbInsightRules.find(r => r.id === rid);
            const [pId, sFile] = profileKey.split('|');
            const latest = hostManifests.filter(m =>
                m.profile_id === pId && m.sds_file === sFile
            ).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
            if (rule && latest) {
                populateRuleDetailDrawer(rule, latest);
                openRuleDetailDrawer();
            } else if (latest) {
                /* Rule metadata not yet loaded — show partial from cache */
                const cached = profileData && profileData.failures
                    ? profileData.failures.find(f => f.id === rid)
                    : null;
                if (cached) {
                    populateRuleDetailDrawer({ id: cached.id, title: cached.title,
                        severity: cached.severity, cce: cached.cce || '', automated: false,
                        desc: '', rat: '' }, latest);
                    openRuleDetailDrawer();
                }
            }
        });
    });

    /* Open in Remediation — pre-selects all persistent rules in drawer */
    const openRemBtn = root.querySelector('[data-open-persist-rem]');
    if (openRemBtn && profileData && profileData.failures) {
        openRemBtn.addEventListener('click', () => {
            const ids = profileData.failures.map(f => f.id);
            const [pId, sFile] = profileKey.split('|');
            const latest = hostManifests.filter(m =>
                m.profile_id === pId && m.sds_file === sFile
            ).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
            if (!latest) return;
            pendingPersistentRuleIds = ids;
            document.getElementById('tab-btn-scan').click();
            loadScanFromHistory(latest);
            setTimeout(() => openRemediationPanel(RESULTS_BASE + latest.timestamp + '/'), 500);
        });
    }

    /* Load rule metadata for rule detail drawer */
    const [pId, sFile] = profileKey.split('|');
    const latest = hostManifests.filter(m =>
        m.profile_id === pId && m.sds_file === sFile
    ).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
    if (latest) loadHostInsights(latest);
}

function populateRuleDetailDrawer(rule, manifest) {
    const sevClass = rule.severity === 'high' || rule.severity === 'critical'
        ? 'ct-sev-high' : rule.severity === 'medium' ? 'ct-sev-medium' : 'ct-sev-low';
    const autoTag = rule.automated
        ? '<span class="db-auto-tag">Automatable</span>' : '';

    document.getElementById('ct-rdd-title').textContent = rule.title || rule.id;

    document.getElementById('ct-rdd-body').innerHTML =
        '<div class="ct-rdd-meta">' +
            '<span class="ct-sev-badge ' + sevClass + '">' + escHtml(rule.severity) + '</span>' +
            autoTag +
            (rule.cce ? '<span class="ct-rdd-cce">' + escHtml(rule.cce) + '</span>' : '') +
        '</div>' +
        (rule.desc
            ? '<div class="ct-rdd-section">' +
                  '<p class="ct-rdd-section-title">Description</p>' +
                  '<p class="ct-rdd-text">' + escHtml(rule.desc) + '</p>' +
              '</div>'
            : '') +
        (rule.rat && rule.rat !== rule.desc
            ? '<div class="ct-rdd-section">' +
                  '<p class="ct-rdd-section-title">Rationale</p>' +
                  '<p class="ct-rdd-text">' + escHtml(rule.rat) + '</p>' +
              '</div>'
            : '');

    const viewBtn = document.getElementById('ct-rdd-view-btn');
    viewBtn.onclick = () => {
        const m = dbManifests.find(x => x.timestamp === manifest.timestamp);
        closeRuleDetailDrawer();
        if (m) {
            document.getElementById('tab-btn-scan').click();
            loadScanFromHistory(m);
        }
    };
    document.getElementById('ct-rdd-footer').classList.remove('hidden');
}

function loadHostInsights(manifest) {
    if (!manifest || !manifest.timestamp) return;
    const resultsXml = DB_RESULTS_BASE + manifest.timestamp + '/results.xml';
    const remBash    = DB_RESULTS_BASE + manifest.timestamp + '/remediation.sh';
    cockpit.spawn(['python3', '-c', PY_EXTRACT_FAILING_RULES, resultsXml, remBash], { err: 'message' })
        .then(output => { const d = JSON.parse(output); dbInsightRules = d.fails || d; })
        .catch(() => {});
}

let dbInsightRules  = [];

function buildScoreChart(hostManifests, latest) {
    const relevant = hostManifests
        .filter(m => m.profile_id === latest.profile_id &&
                     m.sds_file   === latest.sds_file   &&
                     m.score != null && !isNaN(parseFloat(m.score)))
        .slice(0, 15)
        .reverse();
    if (relevant.length < 2) return '';

    const scores = relevant.map(m => parseFloat(m.score));
    const lo     = Math.max(0,   Math.min(...scores) - 3);
    const hi     = Math.min(100, Math.max(...scores) + 3);
    const range  = hi - lo || 1;
    const W = 600, H = 160, PX = 16, PY = 16;

    const pts = relevant.map((m, i) => ({
        x:     PX + (i / (relevant.length - 1)) * (W - PX * 2),
        y:     PY + (1 - (parseFloat(m.score) - lo) / range) * (H - PY * 2),
        score: parseFloat(m.score),
        date:  m.timestamp.replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2')
    }));

    const trend = scores[scores.length - 1] - scores[0];
    const color = trend >  0.3 ? 'var(--ct-color-success)'
                : trend < -0.3 ? 'var(--ct-color-danger)'
                : 'var(--pf-global--Color--200)';

    const linePts = pts.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
    const dots    = pts.map((p, i) =>
        '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' +
        (i === pts.length - 1 ? '4.5' : '3') + '" fill="' + color + '"' +
        ' stroke="var(--ct-color-bg-card)" stroke-width="1.5">' +
            '<title>' + escHtml(p.score.toFixed(1) + '% — ' + p.date) + '</title>' +
        '</circle>'
    ).join('');

    return '<svg class="db-chart-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
        '<polyline points="' + linePts + '" fill="none" stroke="' + color +
            '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
        dots +
    '</svg>';
}

function calcRiskScore(sc) {
    if (!sc) return null;
    return (sc.high || 0) * 10 + (sc.medium || 0) * 3 + (sc.low || 0);
}

function buildHostTimeline(latest, prev, filteredManifests, profileData) {
    const score    = parseFloat(latest.score);
    const hasScore = !isNaN(score);
    const scoreDisplay = hasScore ? score.toFixed(1) + '%' : '—';
    const scoreClass   = hasScore
        ? (score >= 80 ? 'db-score-green' : score >= 50 ? 'db-score-yellow' : 'db-score-red')
        : 'db-score-grey';

    let deltaHtml = '';
    if (hasScore && prev && prev.score != null) {
        const prevScore = parseFloat(prev.score);
        if (!isNaN(prevScore) && Math.abs(score - prevScore) >= 0.05) {
            const delta = score - prevScore;
            const sign  = delta > 0 ? '+' : '';
            const cls   = delta > 0 ? 'db-delta-up' : 'db-delta-down';
            deltaHtml = '<span class="db-score-delta ' + cls + '">' +
                (delta > 0 ? '↑' : '↓') + ' ' + sign + delta.toFixed(1) + ' pts vs prior scan' +
            '</span>';
        }
    }

    const sc      = latest.severity_counts || {};
    const age     = latest.timestamp ? dbRelativeTime(latest.timestamp) : '—';
    const ageDays = dbAgeDays(latest.timestamp);
    const ageStaleClass = ageDays !== null && ageDays >= STALE_ERR_DAYS  ? ' db-age-err'
                        : ageDays !== null && ageDays >= STALE_WARN_DAYS ? ' db-age-warn'
                        : '';

    const sevParts = [];
    if (sc.high)   sevParts.push('<span class="db-sev-high">'   + sc.high   + ' high</span>');
    if (sc.medium) sevParts.push('<span class="db-sev-medium">' + sc.medium + ' med</span>');
    if (sc.low)    sevParts.push('<span class="db-sev-low">'    + sc.low    + ' low</span>');
    const sevHtml = sevParts.length
        ? '<div class="db-sev-row">' + sevParts.join('<span class="db-sev-dot">·</span>') + '</div>'
        : '';

    const scanCount = filteredManifests.length;
    const scanLabel = scanCount + ' scan' + (scanCount !== 1 ? 's' : '');

    return (
        /* Timeline chart card */
        '<div class="pf-v6-c-card db-timeline-card">' +
            '<div class="pf-v6-c-card__header db-timeline-header">' +
                '<div class="db-timeline-score-wrap">' +
                    '<span class="db-timeline-score ' + scoreClass + '">' + scoreDisplay + '</span>' +
                    deltaHtml +
                '</div>' +
                '<div class="db-timeline-meta">' +
                    '<span class="db-age' + ageStaleClass + '">Last scanned ' + escHtml(age) + '</span>' +
                    '<span class="db-timeline-scan-count">' + scanLabel + ' on record</span>' +
                '</div>' +
            '</div>' +
            '<div class="pf-v6-c-card__body db-timeline-body">' +
                buildScoreChart(filteredManifests, latest) +
            '</div>' +
            '<div class="pf-v6-c-card__footer db-timeline-footer">' +
                sevHtml +
                '<div class="db-timeline-actions">' +
                    '<button class="pf-v6-c-button pf-m-primary pf-m-sm" type="button" ' +
                            'data-quick-ts="' + escHtml(latest.timestamp) + '" ' +
                            'data-scan-type="host">Quick Scan</button>' +
                    '<button class="pf-v6-c-button pf-m-link" type="button" ' +
                            'data-view-ts="' + escHtml(latest.timestamp) + '" ' +
                            'data-scan-type="host">View Last Scan</button>' +
                '</div>' +
            '</div>' +
        '</div>' +

        /* Persistent failures card */
        buildPersistentFailuresSection(profileData)
    );
}

function buildPersistentFailuresSection(profileData) {
    const MIN_CONSECUTIVE = 3;
    const MAX_SHOWN       = 10;

    if (!profileData || !profileData.failures || !profileData.failures.length) {
        const msg = !profileData
            ? 'Run more scans to identify persistent failures.'
            : 'No rules have been failing for ' + MIN_CONSECUTIVE + '+ consecutive scans.';
        return (
            '<div class="pf-v6-c-card db-persist-card">' +
                '<div class="pf-v6-c-card__header db-persist-header">' +
                    '<h4 class="db-persist-title">Persistent Failures</h4>' +
                '</div>' +
                '<div class="pf-v6-c-card__body">' +
                    '<p class="db-persist-empty">' + escHtml(msg) + '</p>' +
                '</div>' +
            '</div>'
        );
    }

    const persistent = profileData.failures.filter(f => f.consecutive_scans >= MIN_CONSECUTIVE);
    if (!persistent.length) {
        return (
            '<div class="pf-v6-c-card db-persist-card">' +
                '<div class="pf-v6-c-card__header db-persist-header">' +
                    '<h4 class="db-persist-title">Persistent Failures</h4>' +
                '</div>' +
                '<div class="pf-v6-c-card__body">' +
                    '<p class="db-persist-empty">No rules failing ' + MIN_CONSECUTIVE + '+ scans in a row.</p>' +
                '</div>' +
            '</div>'
        );
    }

    const shown    = persistent.slice(0, MAX_SHOWN);
    const overflow = persistent.length - shown.length;

    const rows = shown.map(f => {
        const sevClass = f.severity === 'high' || f.severity === 'critical'
            ? 'ct-sev-high' : f.severity === 'medium' ? 'ct-sev-medium' : 'ct-sev-low';
        return (
            '<div class="db-persist-rule" data-persist-rule-id="' + escHtml(f.id) + '" ' +
                    'title="Click for details" tabindex="0" role="button">' +
                '<span class="db-persist-count" title="' + f.consecutive_scans + ' consecutive scans">' +
                    f.consecutive_scans +
                '</span>' +
                '<span class="ct-sev-badge ' + sevClass + '">' + escHtml(f.severity) + '</span>' +
                '<span class="db-persist-rule-title">' + escHtml(f.title || f.id) + '</span>' +
            '</div>'
        );
    }).join('');

    const moreHtml = overflow > 0
        ? '<p class="db-persist-more">+ ' + overflow + ' more</p>'
        : '';

    return (
        '<div class="pf-v6-c-card db-persist-card">' +
            '<div class="pf-v6-c-card__header db-persist-header">' +
                '<div>' +
                    '<h4 class="db-persist-title">Persistent Failures</h4>' +
                    '<p class="db-persist-subtitle">' + persistent.length + ' rule' +
                        (persistent.length !== 1 ? 's' : '') +
                        ' failing ' + MIN_CONSECUTIVE + '+ scans in a row</p>' +
                '</div>' +
                '<button class="pf-v6-c-button pf-m-secondary pf-m-sm" type="button" ' +
                        'data-open-persist-rem>' +
                    'Open in Remediation' +
                '</button>' +
            '</div>' +
            '<div class="pf-v6-c-card__body db-persist-body">' +
                '<div class="db-persist-list">' + rows + '</div>' +
                moreHtml +
            '</div>' +
        '</div>'
    );
}

function buildAttentionBanner(groups) {
    const regressed = [];
    const stale     = [];

    groups.forEach(group => {
        const m     = group[0];
        const prev  = group[1];
        const label = m.profile_title || m.profile_id || m.image_name || 'Unknown';
        const ageDays = dbAgeDays(m.timestamp);

        if (prev && prev.counts && prev.counts.fail != null && m.counts && m.counts.fail != null) {
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

    const counts  = manifest.counts || {};
    const pass    = counts.pass != null ? counts.pass : null;
    const fail    = counts.fail != null ? counts.fail : null;
    const age     = manifest.timestamp ? dbRelativeTime(manifest.timestamp) : '—';
    const ageDays = dbAgeDays(manifest.timestamp);

    const staleClass = ageDays !== null && ageDays >= STALE_ERR_DAYS ? 'db-stale-err'
                     : ageDays !== null && ageDays >= STALE_WARN_DAYS ? 'db-stale-warn'
                     : '';
    const staleBadge = staleClass
        ? '<span class="db-stale-badge ' + staleClass + '">Stale</span>'
        : '';

    const subtitleHtml = subtitle
        ? '<p class="db-card-subtitle">' + escHtml(subtitle) + '</p>'
        : '';

    const passHtml = pass !== null
        ? '<span class="db-stat-pass">' + escHtml(String(pass)) + ' passed</span>'
        : '';
    const failCls  = fail === 0 ? 'db-stat-fail db-stat-fail-zero' : 'db-stat-fail';
    const failHtml = fail !== null
        ? '<span class="' + failCls + '">' + escHtml(String(fail)) + ' failed</span>'
        : '';

    const sc  = manifest.severity_counts;
    let sevHtml = '';
    if (sc && (sc.high || sc.medium || sc.low)) {
        const parts = [];
        if (sc.high)   parts.push('<span class="db-sev-high">'   + sc.high   + ' high</span>');
        if (sc.medium) parts.push('<span class="db-sev-medium">' + sc.medium + ' med</span>');
        if (sc.low)    parts.push('<span class="db-sev-low">'    + sc.low    + ' low</span>');
        sevHtml = '<div class="db-sev-row">' + parts.join('<span class="db-sev-dot">·</span>') + '</div>';
    }

    const ageStaleClass = ageDays !== null && ageDays >= STALE_ERR_DAYS ? ' db-age-err'
                        : ageDays !== null && ageDays >= STALE_WARN_DAYS ? ' db-age-warn'
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
                    deltaHtml +
                '</div>' +
                '<div class="db-meta">' +
                    (passHtml || failHtml
                        ? '<div class="db-stats-row">' + passHtml + failHtml + '</div>'
                        : '') +
                    sevHtml +
                    '<p class="db-age' + ageStaleClass + '">Last scanned ' + escHtml(age) + '</p>' +
                '</div>' +
            '</div>' +
            '<div class="pf-v6-c-card__footer db-card-footer">' +
                '<button class="pf-v6-c-button pf-m-primary pf-m-sm" type="button" ' +
                        'data-quick-ts="' + escHtml(manifest.timestamp) + '">Quick Scan</button>' +
                '<button class="pf-v6-c-button pf-m-link" type="button" ' +
                        'data-view-ts="' + escHtml(manifest.timestamp) + '" ' +
                        'data-scan-type="' + escHtml(scanType) + '">View Last Scan</button>' +
            '</div>' +
        '</div>'
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
