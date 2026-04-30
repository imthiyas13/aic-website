// PWA install banner — surfaces a custom Install button when the browser
// fires beforeinstallprompt. Hidden by default; never shown when already
// installed (display-mode: standalone) or after the user dismisses it.

(function () {
    const card = document.getElementById('install-card');
    const btn = document.getElementById('install-btn');
    const dismissBtn = document.getElementById('install-dismiss');
    if (!card || !btn) return;

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    if (isStandalone) return;
    if (sessionStorage.getItem('aic-install-dismissed') === '1') return;

    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        card.hidden = false;
    });

    btn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        btn.disabled = true;
        deferredPrompt.prompt();
        try { await deferredPrompt.userChoice; } catch (err) { console.warn(err); }
        deferredPrompt = null;
        card.hidden = true;
    });

    if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
            card.hidden = true;
            sessionStorage.setItem('aic-install-dismissed', '1');
        });
    }

    window.addEventListener('appinstalled', () => {
        card.hidden = true;
        deferredPrompt = null;
    });
})();
