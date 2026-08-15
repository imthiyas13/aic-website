(() => {
    'use strict';

    const state = {
        config: null,
        params: null,
        submitting: false,
    };

    const $ = (id) => document.getElementById(id);

    /* ---------- Helpers ---------- */
    const fmt = (n) => `£${Number(n).toFixed(2)}`;

    // UK postcode regex (HMRC-friendly): allows BFPO and standard formats.
    const POSTCODE_RE = /^([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|GIR\s*0AA|BFPO\s*\d{1,4})$/i;

    function show(view) {
        ['view-form', 'view-success', 'view-fatal'].forEach((v) => {
            $(v).hidden = (v !== view);
        });
    }

    function fatal(message) {
        if (message) $('ga-fatal-message').textContent = message;
        show('view-fatal');
    }

    function readParams() {
        const u = new URL(window.location.href);
        return {
            tx: u.searchParams.get('tx') || '',
            amount: parseFloat(u.searchParams.get('amount') || '') || 0,
            t: u.searchParams.get('t') || '',
        };
    }

    /* ---------- Init view ---------- */
    function applyAmounts() {
        const p = state.params;
        if (p.amount > 0) {
            const extra = p.amount * 0.25;
            const total = p.amount + extra;
            $('ga-donation').textContent = fmt(p.amount);
            $('ga-extra').textContent = `+ ${fmt(extra)}`;
            $('ga-total').textContent = fmt(total);
            $('ga-amounts').hidden = false;
            $('f-amount-text').textContent = fmt(p.amount);
        } else {
            $('f-amount-text').textContent = 'my donation';
        }
    }

    /* ---------- Validation ---------- */
    function validate(form) {
        const errors = [];
        const fields = ['firstName', 'lastName', 'address', 'postcode'];
        fields.forEach((name) => {
            const el = form.elements[name];
            const val = (el.value || '').trim();
            if (!val) {
                el.classList.add('is-invalid');
                errors.push(name);
            } else {
                el.classList.remove('is-invalid');
            }
        });

        const postcode = (form.elements.postcode.value || '').trim();
        if (postcode && !POSTCODE_RE.test(postcode)) {
            form.elements.postcode.classList.add('is-invalid');
            errors.push('postcode-format');
        }

        const email = (form.elements.email.value || '').trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            form.elements.email.classList.add('is-invalid');
            errors.push('email-format');
        } else {
            form.elements.email.classList.remove('is-invalid');
        }

        const decl = form.elements.declaration;
        const declLabel = decl.closest('.ga-check');
        if (!decl.checked) {
            declLabel.classList.add('is-invalid');
            errors.push('declaration');
        } else {
            declLabel.classList.remove('is-invalid');
        }

        return errors;
    }

    function errorMessage(errors) {
        if (errors.includes('declaration')) {
            return 'Please tick the Gift Aid declaration to continue.';
        }
        if (errors.includes('postcode-format')) {
            return 'That postcode doesn\'t look right. Please check and try again.';
        }
        if (errors.includes('email-format')) {
            return 'Please enter a valid email address (or leave it blank).';
        }
        return 'Please fill in the required fields marked with *.';
    }

    /* ---------- Submit ---------- */
    async function submitForm(form) {
        if (state.submitting) return;

        $('ga-error').hidden = true;

        const errors = validate(form);
        if (errors.length) {
            const msg = errorMessage(errors);
            $('ga-error').textContent = msg;
            $('ga-error').hidden = false;
            // Scroll the first invalid field into view.
            const firstInvalid = form.querySelector('.is-invalid');
            if (firstInvalid) firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        const ga = state.config?.giftAid || {};
        if (!ga.webhookUrl) {
            fatal('The Gift Aid form is not yet connected to a submission endpoint. Please ask a volunteer.');
            return;
        }

        const payload = {
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            txCode: state.params.tx,
            amount: state.params.amount,
            charity: ga.charity?.name || '',
            charityRegNumber: ga.charity?.registrationNumber || '',
            hmrcRef: ga.charity?.hmrcRef || '',
            title: form.elements.title.value.trim(),
            firstName: form.elements.firstName.value.trim(),
            lastName: form.elements.lastName.value.trim(),
            address: form.elements.address.value.trim(),
            postcode: form.elements.postcode.value.trim().toUpperCase().replace(/\s+/g, ' '),
            email: form.elements.email.value.trim(),
            declaration: form.elements.declaration.checked,
            declarationText: form.querySelector('.ga-check-text').innerText.trim(),
            userAgent: navigator.userAgent,
        };

        const submitBtn = $('ga-submit');
        submitBtn.classList.add('is-loading');
        submitBtn.disabled = true;
        state.submitting = true;

        try {
            // Send as text/plain to avoid CORS preflight on Apps Script webhooks.
            const res = await fetch(ga.webhookUrl, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                redirect: 'follow',
            });
            // Apps Script web apps return JSON when configured properly.
            // If we can read it, parse; if not (opaque), treat as success.
            let ok = res.ok !== false;
            try {
                const data = await res.json();
                if (data && data.ok === false) ok = false;
            } catch { /* ignore parse errors — Apps Script can return HTML on auth issues */ }

            if (!ok) throw new Error('Server rejected the submission.');

            $('ga-success-meta').textContent = state.params.tx
                ? `Reference: ${state.params.tx}`
                : '';
            show('view-success');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            console.error('Gift Aid submission failed:', err);
            $('ga-error').textContent = 'Could not send your details right now. Please check your connection and try again.';
            $('ga-error').hidden = false;
        } finally {
            submitBtn.classList.remove('is-loading');
            submitBtn.disabled = false;
            state.submitting = false;
        }
    }

    /* ---------- Bootstrap ---------- */
    async function loadConfig() {
        try {
            const res = await fetch('data/config.json', { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err) {
            console.warn('Could not load config.json:', err);
            return null;
        }
    }

    async function init() {
        state.params = readParams();
        state.config = await loadConfig();

        applyAmounts();

        // ?preview=success | form | fatal — jump straight to a view (handy for design review).
        const preview = new URL(window.location.href).searchParams.get('preview');
        if (preview === 'success') {
            $('ga-success-meta').textContent = state.params.tx
                ? `Reference: ${state.params.tx}`
                : 'Reference: PREVIEW-MODE';
            show('view-success');
            return;
        }
        if (preview === 'fatal') {
            fatal('This is a preview of the configuration-error view.');
            return;
        }

        // Live-clear invalid state on input.
        document.querySelectorAll('.ga-input').forEach((el) => {
            el.addEventListener('input', () => el.classList.remove('is-invalid'));
            el.addEventListener('blur', () => {
                if (el.required && !(el.value || '').trim()) {
                    el.classList.add('is-invalid');
                }
            });
        });

        const form = $('ga-form');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            submitForm(form);
        });

        // Friendly auto-formatting for postcodes (uppercase + single space before final 3 chars).
        const pc = $('f-postcode');
        pc.addEventListener('blur', () => {
            let v = (pc.value || '').toUpperCase().replace(/\s+/g, '');
            if (v.length >= 5) v = `${v.slice(0, -3)} ${v.slice(-3)}`;
            pc.value = v;
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
