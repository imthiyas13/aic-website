(() => {
    'use strict';

    const state = {
        config: null,
        affiliateKey: null,
        screen: 'amounts',
        customDigits: '',
        selectedAmount: 0,
        currentTxId: null,
        idleTimer: null,
        celebrationTimer: null,
        deeplinkFallbackTimer: null,
        mode: 'handheld',      // 'handheld' (admin phone) | 'kiosk' (wall tablet)
        flow: 'giftaid',       // 'giftaid' (payment taken in the SumUp app) | 'sumup' (we hand off)
        platform: 'other',     // 'ios' | 'android' | 'other'
        collector: '',         // who is holding the phone, for reconciliation
        appSwitched: false,    // did the page go hidden after we fired the deeplink?
    };

    const $ = (id) => document.getElementById(id);
    const screens = {};

    /* ---------- Device / mode detection ---------- */
    const STORE_MODE = 'aic.donate.mode';
    const STORE_FLOW = 'aic.donate.flow';
    const STORE_COLLECTOR = 'aic.donate.collector';
    const STORE_SETUP_DONE = 'aic.donate.setup';
    const STORE_PENDING = 'aic.donate.pending';

    const store = {
        get(key) {
            try { return localStorage.getItem(key); } catch { return null; }
        },
        set(key, value) {
            try { localStorage.setItem(key, value); } catch { /* private mode */ }
        },
        remove(key) {
            try { localStorage.removeItem(key); } catch { /* private mode */ }
        },
    };

    function detectPlatform() {
        const ua = navigator.userAgent || '';
        // iPadOS 13+ reports itself as a Mac, so check for touch as well.
        const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        if (/iPad|iPhone|iPod/.test(ua) || iPadOS) return 'ios';
        if (/Android/.test(ua)) return 'android';
        return 'other';
    }

    function detectMode() {
        // ?mode=kiosk|handheld wins and sticks, so a tablet only has to be told once.
        const asked = new URL(window.location.href).searchParams.get('mode');
        if (asked === 'kiosk' || asked === 'handheld') {
            store.set(STORE_MODE, asked);
            return asked;
        }
        return store.get(STORE_MODE) === 'kiosk' ? 'kiosk' : 'handheld';
    }

    function detectFlow(mode) {
        // ?flow=giftaid|sumup wins and sticks, same as mode.
        const asked = new URL(window.location.href).searchParams.get('flow');
        if (asked === 'giftaid' || asked === 'sumup') {
            store.set(STORE_FLOW, asked);
            return asked;
        }
        const stored = store.get(STORE_FLOW);
        if (stored === 'giftaid' || stored === 'sumup') return stored;
        // A phone has no card reader, so the volunteer takes the payment in the
        // SumUp app and this page only issues the Gift Aid QR. The wall tablet
        // has a reader, so it still hands off to SumUp itself.
        return mode === 'kiosk' ? 'sumup' : 'giftaid';
    }

    const isHandheld = () => state.mode === 'handheld';
    const isGiftAidOnly = () => state.flow === 'giftaid';

    const fmt = (amount) => {
        const sym = state.config?.currencySymbol ?? '£';
        return Number.isInteger(amount) ? `${sym}${amount}` : `${sym}${amount.toFixed(2)}`;
    };

    const uuid = () => {
        if (crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
    };

    /* ---------- Screen routing ---------- */
    function show(name) {
        Object.entries(screens).forEach(([k, el]) => {
            if (k === name) {
                el.hidden = false;
                requestAnimationFrame(() => el.classList.add('is-active'));
            } else {
                el.classList.remove('is-active');
                el.hidden = true;
            }
        });
        // Any move off the amounts screen means a new donor has started interacting,
        // so the previous donor's celebration banner should clear.
        if (name !== 'amounts' && state.screen === 'amounts') {
            hideCelebration();
        }
        state.screen = name;
        resetIdle();
    }

    function clearTimers() {
        clearTimeout(state.idleTimer);
        clearTimeout(state.celebrationTimer);
        clearTimeout(state.deeplinkFallbackTimer);
    }

    function resetIdle() {
        clearTimeout(state.idleTimer);
        // Don't time out of the amounts screen (nothing to reset) or the setup
        // screen (the volunteer is mid-typing).
        if (state.screen === 'amounts' || state.screen === 'setup') return;
        const seconds = state.config?.idleResetSeconds ?? 30;
        state.idleTimer = setTimeout(goHome, seconds * 1000);
    }

    function goHome() {
        clearTimers();
        state.customDigits = '';
        state.selectedAmount = 0;
        state.currentTxId = null;
        renderCustom();
        show('amounts');
    }

    /* ---------- Amounts screen ---------- */
    function renderAmounts() {
        const grid = $('amounts-grid');
        grid.innerHTML = '';
        (state.config.amounts || []).forEach((amount) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'amount-tile';
            btn.innerHTML = `<span class="tile-amount">${fmt(amount)}</span>`;
            btn.addEventListener('click', () => choose(amount));
            grid.appendChild(btn);
        });
    }

    function choose(amount) {
        state.selectedAmount = amount;

        // Gift-Aid-only flow: the volunteer has already taken the payment in
        // the SumUp app, so there is nothing to hand off — go straight to the
        // thank-you and the Gift Aid QR for this amount.
        if (isGiftAidOnly()) {
            state.customDigits = '';
            renderCustom();
            show('amounts');
            showCelebration('success', null, { txCode: '', amount });
            return;
        }

        if (!state.affiliateKey) {
            showError('Payment not configured. Please contact a volunteer.');
            return;
        }
        $('pay-amount').textContent = fmt(amount);
        show('pay');
        // Give the screen one frame to paint before navigating away.
        requestAnimationFrame(() => launchSumUp(amount));
    }

    /* ---------- Custom keypad ---------- */
    function customValue() {
        if (!state.customDigits) return 0;
        const padded = state.customDigits.padStart(3, '0');
        const pounds = padded.slice(0, -2);
        const pence = padded.slice(-2);
        return parseFloat(`${pounds}.${pence}`);
    }

    function renderCustom() {
        const v = customValue();
        $('custom-value').textContent = v.toFixed(2);
        const min = state.config?.minCustom ?? 1;
        const max = state.config?.maxCustom ?? 1000;
        $('btn-custom-confirm').disabled = !(v >= min && v <= max);
    }

    function pressKey(key) {
        if (key === 'clear') {
            state.customDigits = '';
        } else if (key === 'back') {
            state.customDigits = state.customDigits.slice(0, -1);
        } else if (/^[0-9]$/.test(key)) {
            if (state.customDigits.length === 0 && key === '0') return;
            if (state.customDigits.length >= 7) return;
            state.customDigits += key;
        }
        renderCustom();
        resetIdle();
    }

    /* ---------- SumUp app-switch ---------- */
    function buildCallbackUrl(result) {
        // Strip any existing smp-* params and use this page as the return target.
        const u = new URL(window.location.href);
        for (const k of [...u.searchParams.keys()]) {
            if (k.startsWith('smp-') || k === 'foreign-tx-id' || k === 'from' || k === 'r') {
                u.searchParams.delete(k);
            }
        }
        u.searchParams.set('from', 'sumup');
        // iOS uses two separate callback URLs and does not always echo a failure
        // cause, so we mark which one we came back through ourselves.
        if (result) u.searchParams.set('r', result);
        return u.toString();
    }

    // The amount and collector don't survive the app-switch on their own — iOS in
    // particular may return into a fresh tab — so stash them before handing off.
    function stashPending(txId, amount) {
        store.set(STORE_PENDING, JSON.stringify({
            txId,
            amount,
            collector: state.collector || '',
            ts: Date.now(),
        }));
    }

    function readPending() {
        try {
            const raw = store.get(STORE_PENDING);
            if (!raw) return null;
            const p = JSON.parse(raw);
            // Anything older than 15 minutes is a stale leftover, not this donation.
            if (!p || typeof p.ts !== 'number' || Date.now() - p.ts > 15 * 60 * 1000) {
                store.remove(STORE_PENDING);
                return null;
            }
            return p;
        } catch {
            return null;
        }
    }

    function launchSumUp(amount) {
        const cfg = state.config.sumup || {};
        const txId = uuid();
        state.currentTxId = txId;
        state.appSwitched = false;
        stashPending(txId, amount);

        // Tag the transaction with whoever is collecting, so takings can be
        // reconciled per person in the SumUp dashboard.
        let title = cfg.transactionTitle || 'AIC Donation';
        if (state.collector) title += ` — ${state.collector}`;

        const params = new URLSearchParams();
        params.set('affiliate-key', state.affiliateKey);
        params.set('currency', state.config.currency || 'GBP');
        params.set('title', title);
        params.set('foreign-tx-id', txId);
        if (cfg.skipScreenSuccess) params.set('skip-screen-success', 'true');

        if (state.platform === 'ios') {
            // iOS scheme: `amount`, plus separate success/failure callback URLs.
            // There is no `app-id` and no single `callback` parameter.
            params.set('amount', amount.toFixed(2));
            params.set('callbacksuccess', buildCallbackUrl('ok'));
            params.set('callbackfail', buildCallbackUrl('fail'));
        } else {
            // Android scheme: `total`, `app-id` and one `callback` for both outcomes.
            params.set('total', amount.toFixed(2));
            params.set('app-id', cfg.appId || 'org.aldershotic.donate.kiosk');
            params.set('callback', buildCallbackUrl());
        }

        // Plain custom scheme works across Chrome and kiosk WebViews (Fully Kiosk etc.).
        // The `intent://` form was Chrome-only and silently failed inside Fully Kiosk's WebView.
        const deeplink = `sumupmerchant://pay/1.0?${params.toString()}`;

        // Fallback: if SumUp app doesn't take over within N seconds, show an error.
        // iOS puts an "Open in SumUp?" confirmation in the way first, so allow longer.
        const fallback = state.platform === 'ios'
            ? (cfg.deeplinkFallbackSecondsIos ?? 20)
            : (cfg.deeplinkFallbackSeconds ?? 8);
        clearTimeout(state.deeplinkFallbackTimer);
        state.deeplinkFallbackTimer = setTimeout(() => {
            // If the page was ever backgrounded the hand-off worked, whatever
            // happened next — don't accuse the volunteer of a missing app.
            if (state.appSwitched) return;
            if (state.screen === 'pay' && document.visibilityState === 'visible') {
                showError("Couldn't open SumUp. Please make sure the SumUp app is installed and signed in.");
            }
        }, fallback * 1000);

        // Navigating triggers the OS handler for the deeplink/intent URI.
        window.location.href = deeplink;
    }

    /* ---------- Return-from-SumUp handler ---------- */
    function handleReturn() {
        const params = new URLSearchParams(window.location.search);
        const status = params.get('smp-status');
        // iOS returns through a success- or failure-specific URL and may omit
        // smp-status entirely, so our own `r` marker is the backstop.
        const marker = params.get('r');
        if (!status && !marker) return false;

        const txCode = params.get('smp-tx-code') || '';
        const message = params.get('smp-message') || '';
        const cause = params.get('smp-failure-cause') || '';
        const returnedTxId = params.get('foreign-tx-id') || '';

        // Clean the URL so a refresh doesn't re-trigger the result screen.
        const clean = new URL(window.location.href);
        for (const k of [...clean.searchParams.keys()]) {
            if (k.startsWith('smp-') || k === 'foreign-tx-id' || k === 'from' || k === 'r') {
                clean.searchParams.delete(k);
            }
        }
        history.replaceState({}, '', clean.toString());

        // iOS doesn't echo smp-amount, so fall back to what we stashed before
        // handing off. Only trust the stash if it belongs to this transaction.
        const pending = readPending();
        const pendingMatches = pending && (!returnedTxId || pending.txId === returnedTxId);
        const amount = parseFloat(params.get('smp-amount') || '')
            || (pendingMatches ? pending.amount : 0)
            || state.selectedAmount
            || 0;
        store.remove(STORE_PENDING);

        // Always return to the amounts screen so the next person in the queue can tap.
        show('amounts');

        const succeeded = status ? status === 'success' : marker === 'ok';
        if (succeeded) {
            showCelebration('success', null, { txCode, amount });
        } else {
            const friendly = {
                'transaction-failed': 'Card declined. Please try again.',
                'geolocation-required': 'Location services required. Please enable and retry.',
                'invalid-param': 'Configuration error. Please contact a volunteer.',
                'invalid-token': 'Configuration error. Please contact a volunteer.',
            }[cause]
                || message
                || (status === 'invalidstate' ? 'SumUp was busy with another payment. Please try again.' : '')
                || 'Payment not completed. Please try again.';
            showCelebration('error', friendly);
        }
        return true;
    }

    /* ---------- Celebration overlay (sits over amounts screen) ---------- */
    const STARS_COUNT = 14;

    function buildStars() {
        const wrap = $('stars');
        if (!wrap || wrap.childElementCount > 0) return;
        const starSvg = '<svg viewBox="0 0 24 24"><path d="M12 1.5l3.09 6.26L22 8.77l-5 4.87 1.18 6.86L12 17.27l-6.18 3.23L7 13.64 2 8.77l6.91-1.01L12 1.5z"/></svg>';
        for (let i = 0; i < STARS_COUNT; i++) {
            const star = document.createElement('span');
            star.className = 'star';
            const angle = (i / STARS_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
            const distance = 180 + Math.random() * 140;
            const tx = Math.cos(angle) * distance;
            const ty = Math.sin(angle) * distance;
            const rot = (Math.random() * 720 - 360).toFixed(0);
            const size = 16 + Math.random() * 18;
            const delay = (Math.random() * 0.25).toFixed(2);
            star.style.setProperty('--tx', `${tx.toFixed(0)}px`);
            star.style.setProperty('--ty', `${ty.toFixed(0)}px`);
            star.style.setProperty('--rot', `${rot}deg`);
            star.style.width = `${size.toFixed(0)}px`;
            star.style.height = `${size.toFixed(0)}px`;
            star.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
            star.style.animationDelay = `${delay}s`;
            star.innerHTML = starSvg;
            wrap.appendChild(star);
        }
    }

    function showCelebration(kind, message, ctx) {
        clearTimeout(state.celebrationTimer);
        const el = $('celebration');
        const t = state.config?.thanksMessage || {};
        if (kind === 'success') {
            $('celebration-arabic').textContent = t.arabic || 'جَزَاكَ ٱللَّٰهُ خَيْرًا';
            $('celebration-title').textContent = t.english || 'JazakAllah Khair';
            $('celebration-sub').textContent = t.sub || 'May Allah reward you with goodness.';
        } else {
            $('celebration-title').textContent = 'Donation not completed';
            $('celebration-sub').textContent = message || 'Please try again.';
        }
        el.dataset.kind = kind;
        el.setAttribute('aria-hidden', 'false');

        // Render Gift Aid QR on success if enabled and we have a tx code.
        const ga = state.config?.giftAid;
        // In the Gift-Aid-only flow there is no SumUp transaction code to key
        // off, so the amount alone is enough to warrant showing the QR.
        const showGiftAid = kind === 'success'
            && ga?.enabled
            && typeof qrcode !== 'undefined'
            && (ctx?.txCode || (isGiftAidOnly() && ctx?.amount > 0));
        if (showGiftAid) {
            renderGiftAidQr(ctx);
            el.dataset.giftaid = 'true';
        } else {
            el.removeAttribute('data-giftaid');
            $('qr-code').innerHTML = '';
        }

        // Force reflow so the star animations restart on consecutive donations.
        el.classList.remove('is-visible');
        // eslint-disable-next-line no-unused-expressions
        void el.offsetWidth;
        el.classList.add('is-visible');

        let seconds;
        if (kind === 'success') {
            seconds = showGiftAid
                ? (ga?.successDisplaySeconds ?? 25)
                : (state.config?.thanksSeconds ?? 4);
        } else {
            seconds = state.config?.errorSeconds ?? 5;
        }
        state.celebrationTimer = setTimeout(hideCelebration, seconds * 1000);
    }

    function renderGiftAidQr(ctx) {
        try {
            const ga = state.config.giftAid;
            const base = window.location.href.split('?')[0].split('#')[0].replace(/[^/]*$/, '');
            const formUrl = new URL(base + (ga.formPath || 'gift-aid.html'));
            if (ctx.txCode) formUrl.searchParams.set('tx', ctx.txCode);
            formUrl.searchParams.set('amount', String(ctx.amount));
            formUrl.searchParams.set('t', String(Date.now()));

            // qrcode-generator: type 0 = auto, 'M' = ~15% error correction
            const qr = qrcode(0, 'M');
            qr.addData(formUrl.toString());
            qr.make();
            $('qr-code').innerHTML = qr.createSvgTag({ scalable: true, margin: 0 });
        } catch (err) {
            console.warn('QR render failed:', err);
            $('qr-code').innerHTML = '';
            $('celebration').removeAttribute('data-giftaid');
        }
    }

    // Was called in two failure paths but never defined — a ReferenceError
    // instead of a message. Errors reuse the celebration banner.
    function showError(message) {
        show('amounts');
        showCelebration('error', message);
    }

    function hideCelebration() {
        const el = $('celebration');
        el.classList.remove('is-visible');
        el.setAttribute('aria-hidden', 'true');
    }

    /* ---------- Device behaviour ---------- */
    function keepScreenAwake() {
        let wakeLock = null;
        const requestWake = async () => {
            try {
                if ('wakeLock' in navigator) {
                    wakeLock = await navigator.wakeLock.request('screen');
                }
            } catch { /* ignored */ }
        };
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') requestWake();
        });
        requestWake();
    }

    function applyDeviceBehaviour() {
        // Useful in both modes: the screen shouldn't sleep mid-collection.
        keepScreenAwake();

        // The rest is kiosk lockdown — forcing fullscreen and swallowing
        // long-press/double-tap is hostile on someone's personal phone.
        if (isHandheld()) return;

        document.addEventListener('contextmenu', (e) => e.preventDefault());
        document.addEventListener('gesturestart', (e) => e.preventDefault());
        document.addEventListener('dblclick', (e) => e.preventDefault());

        const goFs = () => {
            const el = document.documentElement;
            if (!document.fullscreenElement && el.requestFullscreen) {
                el.requestFullscreen().catch(() => {});
            }
            document.removeEventListener('click', goFs);
        };
        document.addEventListener('click', goFs, { once: true });
    }

    /* ---------- Collector identity (handheld only) ---------- */
    function applyCollector() {
        const badge = $('collector-badge');
        if (!badge) return;
        // Shown on a phone — it doubles as the way back into setup. Pointless
        // in the Gift-Aid-only flow, where we never create the SumUp
        // transaction: attribution comes from the volunteer's employee login.
        badge.hidden = !isHandheld() || isGiftAidOnly();
        badge.classList.toggle('is-unset', !state.collector);
        $('collector-name').textContent = state.collector || 'Set name';
    }

    function saveCollector(name) {
        const clean = (name || '').trim().slice(0, 32);
        state.collector = clean;
        if (clean) store.set(STORE_COLLECTOR, clean);
        else store.remove(STORE_COLLECTOR);
        // Remember that we asked, so leaving the name blank doesn't re-prompt
        // on every reload.
        store.set(STORE_SETUP_DONE, '1');
        applyCollector();
    }

    /* ---------- Bootstrap ---------- */
    const FALLBACK_CONFIG = {
        amounts: [5, 10, 20, 50, 100, 500],
        currency: 'GBP',
        currencySymbol: '£',
        minCustom: 1,
        maxCustom: 1000,
        campaign: {
            title: 'Aldershot Islamic Centre',
            subtitle: 'Your sadaqah keeps the masjid running — every contribution counts.',
        },
        thanksMessage: {
            arabic: 'جَزَاكَ ٱللَّٰهُ خَيْرًا',
            english: 'JazakAllah Khair',
            sub: 'May Allah reward you with goodness.',
        },
        sumup: {
            appId: 'org.aldershotic.donate.kiosk',
            transactionTitle: 'AIC Donation',
            skipScreenSuccess: true,
            deeplinkFallbackSeconds: 8,
        },
        giftAid: {
            enabled: true,
            formPath: 'gift-aid.html',
            successDisplaySeconds: 25,
            charity: { name: 'Aldershot Islamic Centre', hmrcRef: '1214576' },
            webhookUrl: '',
        },
        idleResetSeconds: 30,
        thanksSeconds: 4,
        errorSeconds: 5,
    };

    async function loadConfig() {
        try {
            const res = await fetch('data/config.json', { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const cfg = await res.json();
            if (!Array.isArray(cfg.amounts) || cfg.amounts.length === 0) {
                console.warn('config.json has no amounts; using fallback amounts');
                cfg.amounts = FALLBACK_CONFIG.amounts;
            }
            return cfg;
        } catch (err) {
            console.warn('Could not load data/config.json, using fallback. Reason:', err.message);
            return FALLBACK_CONFIG;
        }
    }

    async function loadKey() {
        try {
            const res = await fetch('data/key.txt', { cache: 'no-store' });
            if (!res.ok) return null;
            const text = (await res.text()).trim();
            if (!text || text.startsWith('REPLACE_ME')) return null;
            if (!text.startsWith('sup_afk_')) {
                console.warn('Key in data/key.txt does not look like a SumUp affiliate key (sup_afk_...)');
            }
            return text;
        } catch (err) {
            console.warn('Failed to load key:', err);
            return null;
        }
    }

    function applyCopy() {
        const c = state.config.campaign || {};
        if (c.title) $('campaign-title').textContent = c.title;
        if (c.subtitle) $('campaign-sub').textContent = c.subtitle;
        // The amounts screen is read by the volunteer, not the donor, when the
        // payment has already been taken in the SumUp app.
        if (isGiftAidOnly()) {
            $('amounts-prompt').textContent = 'How much was donated?';
        }
        if (c.registrationNumber) {
            $('campaign-ref').textContent = `Registered Charity · ${c.registrationNumber}`;
        }
        // Thanks-message copy is applied in showCelebration() per-event
        // so the success and error states can override the same elements.
    }

    async function init() {
        ['amounts', 'custom', 'pay', 'setup'].forEach((n) => {
            screens[n] = $(`screen-${n}`);
        });
        buildStars();

        state.platform = detectPlatform();
        state.mode = detectMode();
        state.flow = detectFlow(state.mode);
        state.collector = store.get(STORE_COLLECTOR) || '';

        // ?collector=Name provisions a phone in one tap — send each volunteer
        // their own link rather than talking them through the setup screen.
        const provisionUrl = new URL(window.location.href);
        const asked = provisionUrl.searchParams.get('collector');
        if (asked !== null) {
            saveCollector(asked);
            // Drop it from the address bar so the name isn't re-applied on every
            // reload and doesn't ride along in the SumUp callback URL.
            provisionUrl.searchParams.delete('collector');
            history.replaceState({}, '', provisionUrl.toString());
        }

        document.body.dataset.mode = state.mode;
        document.body.dataset.flow = state.flow;
        document.body.dataset.platform = state.platform;

        state.config = await loadConfig();
        state.affiliateKey = await loadKey();
        applyCopy();
        applyCollector();
        renderAmounts();
        renderCustom();

        // Handheld setup: ask once who's collecting, then remember it.
        $('btn-setup-save').addEventListener('click', () => {
            saveCollector($('setup-name').value);
            goHome();
        });
        $('setup-form').addEventListener('submit', (e) => {
            e.preventDefault();
            saveCollector($('setup-name').value);
            goHome();
        });
        $('collector-badge').addEventListener('click', () => {
            $('setup-name').value = state.collector;
            show('setup');
        });

        $('btn-custom').addEventListener('click', () => {
            state.customDigits = '';
            renderCustom();
            show('custom');
        });

        $('keypad').addEventListener('click', (e) => {
            const btn = e.target.closest('.key');
            if (!btn) return;
            pressKey(btn.dataset.key);
        });

        $('btn-custom-cancel').addEventListener('click', goHome);
        $('btn-custom-confirm').addEventListener('click', () => {
            const v = customValue();
            if (v <= 0) return;
            choose(v);
        });

        $('btn-pay-cancel').addEventListener('click', goHome);

        document.addEventListener('click', resetIdle);

        // On a phone the volunteer wants to move on at their own pace, so let
        // them dismiss the thank-you banner instead of waiting it out.
        $('celebration').addEventListener('click', () => {
            if (isHandheld()) hideCelebration();
        });

        // Track the app-switch so the "SumUp didn't open" fallback can tell a
        // missing app apart from a slow one.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && state.screen === 'pay') {
                state.appSwitched = true;
            }
        });

        // When the browser comes back to the foreground after SumUp closed:
        //  - if the URL has callback params, handleReturn() will fire on the next load
        //  - if it doesn't, the user cancelled out of SumUp without paying — go home
        //    immediately rather than wait for the deeplink fallback timer to expire.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible' || state.screen !== 'pay') return;
            clearTimeout(state.deeplinkFallbackTimer);
            // Brief grace window so a real callback navigation has a chance to fire first.
            setTimeout(() => {
                if (state.screen !== 'pay') return;
                const search = window.location.search;
                if (!search.includes('smp-status') && !search.includes('r=')) {
                    store.remove(STORE_PENDING);
                    goHome();
                }
            }, 800);
        });

        applyDeviceBehaviour();

        // If the page loaded with SumUp callback params, overlay the result on
        // amounts. Otherwise a phone with no collector name set goes to setup.
        show('amounts');
        if (!handleReturn() && isHandheld() && !isGiftAidOnly() && !store.get(STORE_SETUP_DONE)) {
            show('setup');
        }
    }

    function showFatal(message) {
        const grid = $('amounts-grid');
        if (grid) {
            grid.innerHTML = `<div style="grid-column:1/-1;padding:24px;text-align:center;color:#c0392b;font-family:var(--serif);font-size:18px;">⚠ ${message}</div>`;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        init().catch((err) => {
            console.error('Kiosk init failed:', err);
            showFatal(`Kiosk failed to start: ${err.message}. Check the browser console.`);
        });
    });
})();
