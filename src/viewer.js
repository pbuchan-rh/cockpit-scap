'use strict';

// Same-origin report viewer. The oscap report is handed off via IndexedDB
// (not a blob: URL) because a blob: document opened with window.open()
// inherits a stripped-down CSP (default-src 'self', no unsafe-inline) that
// blocks the report's inline <style>/<script> — this page is a normal
// same-origin navigation, so it gets Cockpit's real page CSP instead, which
// does allow inline styles/scripts.
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
