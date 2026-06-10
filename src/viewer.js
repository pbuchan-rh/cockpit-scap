'use strict';

(function () {
    const req = indexedDB.open('cockpit-scap', 1);
    req.onupgradeneeded = function (e) {
        e.target.result.createObjectStore('reports');
    };
    req.onsuccess = function (e) {
        const db = e.target.result;
        const tx = db.transaction('reports', 'readwrite');
        const store = tx.objectStore('reports');
        const getReq = store.get('current');
        getReq.onsuccess = function () {
            const html = getReq.result;
            if (!html) { db.close(); return; }
            store.delete('current');
            tx.oncomplete = function () {
                db.close();
                document.open();
                document.write(html);
                document.close();
            };
        };
    };
}());
