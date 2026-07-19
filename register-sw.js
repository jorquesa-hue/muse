/* Register the service worker AND auto-apply new versions. The SW is cache-first (so the app works
 * fully offline), which means a fresh deploy would otherwise keep serving the OLD cached app.js until
 * the user manually reloaded — twice. Here we let a new version take over by itself:
 *   - the SW calls skipWaiting() on install + clients.claim() on activate, so a new worker becomes the
 *     controller as soon as it's installed;
 *   - when that happens `controllerchange` fires and we reload ONCE to pick up the new assets.
 * Guards: `hadController` skips the very first install (no reload on first-ever visit); `refreshing`
 * prevents a reload loop. Result: deploys apply on the next visit with no manual cache-clearing. */
if ('serviceWorker' in navigator) {
  var hadController = !!navigator.serviceWorker.controller;
  var refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (refreshing) return;
    if (!hadController) { hadController = true; return; } // first install — nothing to refresh into
    refreshing = true;
    window.location.reload();
  });
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      if (reg && typeof reg.update === 'function') { try { reg.update(); } catch (e) {} } // check for a newer SW now
    }).catch(function (e) { console.warn('SW registration failed', e); });
  });
}
