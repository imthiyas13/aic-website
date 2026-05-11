(function () {
    'use strict';

    // === Configure this ===
    // Paste your Google Apps Script Web App URL here after deploying.
    // It will look like: https://script.google.com/macros/s/AKfycb.../exec
    const ENDPOINT = 'REPLACE_WITH_APPS_SCRIPT_WEB_APP_URL';

    const form = document.getElementById('dd-form');
    if (!form) return;

    const submitBtn = document.getElementById('dd-submit');
    const statusEl = document.getElementById('dd-status');

    // Show a confirmation message when the donor returns from Stripe Checkout.
    if (window.location.search.indexOf('dd=success') !== -1) {
        const note = document.createElement('div');
        note.className = 'dd-status success';
        note.textContent = "Jazak Allah khair — your Direct Debit has been set up. You'll receive a confirmation email from Stripe and the first collection will appear in your bank within a few working days.";
        form.parentNode.insertBefore(note, form);
        form.hidden = true;
        return;
    }

    // Sensible defaults: start date one month from today
    const startDateInput = form.elements['startDate'];
    if (startDateInput && !startDateInput.value) {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        startDateInput.value = d.toISOString().slice(0, 10);
        startDateInput.min = new Date().toISOString().slice(0, 10);
    }

    function setStatus(message, kind) {
        if (!statusEl) return;
        statusEl.textContent = message;
        statusEl.className = 'dd-status ' + (kind || '');
        statusEl.hidden = false;
    }

    function clearStatus() {
        if (!statusEl) return;
        statusEl.hidden = true;
        statusEl.textContent = '';
        statusEl.className = 'dd-status';
    }

    function collect() {
        const data = {};
        const fd = new FormData(form);
        fd.forEach((value, key) => {
            data[key] = typeof value === 'string' ? value.trim() : value;
        });
        data.frequency = 'Monthly';
        data.submittedAt = new Date().toISOString();
        data.userAgent = navigator.userAgent;
        data.pageUrl = window.location.href;
        return data;
    }

    function validate(data) {
        const errors = [];
        if (!data.fullName) errors.push('Full Name');
        if (!data.address) errors.push('Address');
        if (!data.town) errors.push('Town/City');
        if (!data.postcode) errors.push('Postcode');
        if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('a valid Email');
        if (!data.phone) errors.push('Phone');
        if (!data.amount || Number(data.amount) < 1) errors.push('a valid Amount');
        if (!data.startDate) errors.push('Start Date');
        if (!data.purpose) errors.push('Purpose');
        return errors;
    }

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        clearStatus();

        const data = collect();
        const errors = validate(data);
        if (errors.length) {
            setStatus('Please complete: ' + errors.join(', ') + '.', 'error');
            return;
        }

        if (!ENDPOINT || ENDPOINT.indexOf('REPLACE_WITH') === 0) {
            setStatus('Form endpoint is not configured yet. Please contact the masjid.', 'error');
            return;
        }

        submitBtn.disabled = true;
        const originalLabel = submitBtn.textContent;
        submitBtn.textContent = 'Submitting…';

        try {
            // text/plain avoids CORS preflight; Apps Script reads JSON from e.postData.contents
            const res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(data)
            });
            const json = await res.json().catch(() => ({}));

            if (!res.ok || json.ok === false) {
                throw new Error(json.error || ('HTTP ' + res.status));
            }

            if (json.redirectUrl) {
                setStatus('Redirecting you to Stripe to enter your bank details…', 'success');
                window.location.href = json.redirectUrl;
                return;
            }

            setStatus(
                "Thank you! Your details have been received. We'll email you a secure payment link shortly to complete the Direct Debit setup.",
                'success'
            );
            form.reset();
            submitBtn.textContent = 'Submitted';
        } catch (err) {
            console.error('Direct Debit submission failed:', err);
            setStatus(
                "Sorry, we couldn't submit your details. Please try again, or email info@aldershotislamiccentre.org.uk.",
                'error'
            );
            submitBtn.disabled = false;
            submitBtn.textContent = originalLabel;
        }
    });
})();
