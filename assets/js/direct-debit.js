(function () {
    'use strict';

    // Show a confirmation note when the donor lands back from Stripe Checkout.
    // Stripe Payment Links append ?prefilled_email and may include other params,
    // so we drive this off our own ?dd=success marker added to the success URL.
    if (window.location.search.indexOf('dd=success') === -1) return;

    const section = document.getElementById('direct-debit');
    if (!section) return;

    const card = section.querySelector('.dd-card');
    if (!card) return;

    const note = document.createElement('div');
    note.className = 'dd-status success';
    note.style.margin = '20px';
    note.innerHTML =
        "<strong>Jazak Allah khair</strong> &mdash; your Direct Debit is being set up. " +
        "You'll receive a confirmation email from Stripe and the first collection " +
        "will appear in your bank within a few working days, on your chosen day of the month.";

    card.parentNode.insertBefore(note, card);
    card.style.display = 'none';
})();
