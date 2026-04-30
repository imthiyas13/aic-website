// AIC Daily Reminder — manages the push notification subscription on the website.
// Hidden via CSS on desktop; the .notify-card element is shown on mobile only.

const NOTIFICATIONS_WORKER_URL = 'https://aic-notifications.aic-uk.workers.dev';

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
    return out;
}

async function getPushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
}

async function fetchVapidPublicKey() {
    const res = await fetch(`${NOTIFICATIONS_WORKER_URL}/vapid-public`);
    if (!res.ok) throw new Error('Could not fetch VAPID key');
    return (await res.text()).trim();
}

async function subscribeToPush() {
    const reg = await navigator.serviceWorker.ready;
    const vapidKey = await fetchVapidPublicKey();
    const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
    const res = await fetch(`${NOTIFICATIONS_WORKER_URL}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub),
    });
    if (!res.ok) throw new Error('Subscribe POST failed');
    return sub;
}

async function unsubscribeFromPush() {
    const sub = await getPushSubscription();
    if (!sub) return;
    await fetch(`${NOTIFICATIONS_WORKER_URL}/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
}

function setNotifyButtonState(btn, sub, state) {
    btn.dataset.state = state;
    if (state === 'enabled') {
        btn.textContent = 'Enabled · tap to disable';
        sub.textContent = "You'll get a morning alert when jama'ah times change.";
    } else if (state === 'denied') {
        btn.textContent = 'Blocked';
        btn.disabled = true;
        sub.textContent = 'Notification permission was blocked. Re-enable in your browser settings.';
    } else if (state === 'unsupported') {
        btn.textContent = 'Not supported';
        btn.disabled = true;
        sub.textContent = 'Prayer alerts are not available on this device. Install to home screen first.';
    } else if (state === 'busy') {
        btn.textContent = 'Working…';
        btn.disabled = true;
    } else {
        btn.textContent = 'Enable';
        btn.disabled = false;
        sub.textContent = "Get a morning alert when jama'ah times change.";
    }
}

async function setupNotificationToggle() {
    const card = document.querySelector('.notify-card');
    if (!card) return;
    const btn = document.getElementById('notify-btn');
    const sub = document.getElementById('notify-sub');

    if (!NOTIFICATIONS_WORKER_URL) { card.hidden = true; return; }
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        setNotifyButtonState(btn, sub, 'unsupported');
        return;
    }
    if (Notification.permission === 'denied') {
        setNotifyButtonState(btn, sub, 'denied');
        return;
    }

    const existing = await getPushSubscription();
    if (existing) {
        card.hidden = true;
        return;
    }
    setNotifyButtonState(btn, sub, 'idle');

    btn.addEventListener('click', async () => {
        const isEnabled = btn.dataset.state === 'enabled';
        setNotifyButtonState(btn, sub, 'busy');
        try {
            if (isEnabled) {
                await unsubscribeFromPush();
                setNotifyButtonState(btn, sub, 'idle');
            } else {
                if (Notification.permission !== 'granted') {
                    const perm = await Notification.requestPermission();
                    if (perm !== 'granted') {
                        setNotifyButtonState(btn, sub, perm === 'denied' ? 'denied' : 'idle');
                        return;
                    }
                }
                await subscribeToPush();
                card.hidden = true;
                return;
            }
        } catch (err) {
            console.error(err);
            setNotifyButtonState(btn, sub, 'idle');
            alert('Could not change notification settings. Please try again.');
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupNotificationToggle);
} else {
    setupNotificationToggle();
}
