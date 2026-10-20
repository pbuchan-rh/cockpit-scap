'use strict';

// Same-origin report viewer: writes the oscap report (handed off via
// IndexedDB by lib/reportViewer.js) into this page. The page has Cockpit's
// origin and gets this package's CSP: Cockpit's default (default-src 'self',
// no script-src) plus manifest.json's style-src 'self' 'unsafe-inline'. So
// the report's inline <style> applies, but its inline <script> and on*
// handlers (rule search, filters, expand/collapse) are blocked, and must
// stay blocked: the report is built from the datastream, which can be
// user-uploaded content, and script here would run with the user's Cockpit
// session. Download the HTML report for the interactive version. (A
// sandboxed iframe does not help: srcdoc, blob: and data: frames inherit
// this CSP, checked in Chromium and Firefox, L9.)
(function () {
    const req = indexedDB.open('cockpit-scap', 1);
    req.onupgradeneeded = function (e) {
        e.target.result.createObjectStore('reports');
    };
    req.onerror = function () {
        document.body.textContent = 'Failed to load report.';
    };
    req.onsuccess = function (e) {
        const db = e.target.result;
        const tx = db.transaction('reports', 'readwrite');
        const store = tx.objectStore('reports');
        const getReq = store.get('current');
        getReq.onsuccess = function () {
            const blob = getReq.result;
            if (!blob) {
                db.close();
                document.body.textContent = 'No report data found.';
                return;
            }
            store.delete('current');
            tx.oncomplete = function () {
                db.close();
                blob.text().then(function (html) {
                    document.open();
                    document.write(html);
                    document.close();
                });
            };
        };
    };
}());
