/**
 * Aldershot Islamic Centre — Stripe webhook receiver for Direct Debit signups.
 *
 * Stripe POSTs subscription events here. We:
 *   1. Verify a shared-secret token in the URL (Apps Script can't read the
 *      Stripe-Signature header from doPost, so we use a URL token instead).
 *   2. On `checkout.session.completed`, append the signup to a Google Sheet,
 *      read the donor's "Preferred Collection Day" custom field, and update
 *      the subscription's `trial_end` so future collections anchor to that
 *      day of the month.
 *   3. Email info@ with a notification.
 *
 * Setup: see ./README.md
 */

const SHEET_ID = '1cldNpxCNU45Wj_0BefcBL24eBSsCZ8tkDrSFzHFwaFU';
const SHEET_NAME = 'Signups';
const NOTIFY_EMAIL = 'info@aldershotislamiccentre.org.uk';

const HEADERS = [
  'Timestamp',
  'Stripe Event ID',
  'Customer Name',
  'Email',
  'Address',
  'City',
  'Postcode',
  'Country',
  'Amount (£/month)',
  'Purpose',
  'Preferred Collection Day',
  'First Collection Date',
  'Subscription ID',
  'Customer ID'
];

function doPost(e) {
  try {
    // Token-based auth: Stripe webhook URL must include ?token=<your-token>
    const props = PropertiesService.getScriptProperties();
    const expected = props.getProperty('WEBHOOK_TOKEN');
    const provided = e && e.parameter ? e.parameter.token : '';
    if (!expected || provided !== expected) {
      return jsonResponse_({ ok: false, error: 'Unauthorised' }, 401);
    }

    const event = JSON.parse(e.postData.contents);

    // We only care about completed checkouts for now.
    if (event.type !== 'checkout.session.completed') {
      return jsonResponse_({ ok: true, ignored: event.type });
    }

    handleCheckoutCompleted_(event);
    return jsonResponse_({ ok: true });
  } catch (err) {
    console.error(err);
    return jsonResponse_({ ok: false, error: err.message });
  }
}

function doGet() {
  return jsonResponse_({ ok: true, message: 'AIC Direct Debit webhook receiver is live.' });
}

function handleCheckoutCompleted_(event) {
  const session = event.data.object;

  // Idempotency: skip if we've already logged this event
  if (alreadyLogged_(event.id)) return;

  const props = PropertiesService.getScriptProperties();
  const stripeKey = props.getProperty('STRIPE_SECRET_KEY');

  const preferredDay = readPreferredDay_(session);
  const purpose = readPurpose_(session) || 'General';

  // Update the subscription's trial_end so the first (and every future)
  // collection lands on the donor's preferred day.
  let firstCollectionDate = null;
  if (stripeKey && session.subscription && preferredDay) {
    firstCollectionDate = computeFirstCollectionDate_(preferredDay);
    try {
      updateSubscriptionTrialEnd_(stripeKey, session.subscription, firstCollectionDate, purpose);
    } catch (err) {
      console.error('Failed to update subscription trial_end: ' + err.message);
    }
  }

  // Pull amount from line items (quantity hack: unit_amount * quantity = pounds in pence)
  let amountPounds = '';
  try {
    const lineItems = fetchLineItems_(stripeKey, session.id);
    if (lineItems && lineItems.length) {
      const li = lineItems[0];
      amountPounds = (li.amount_total / 100).toFixed(2);
    }
  } catch (err) {
    console.error('Failed to fetch line items: ' + err.message);
  }

  const details = session.customer_details || {};
  const addr = details.address || {};

  const sheet = getOrCreateSheet_();
  sheet.appendRow([
    new Date(),
    event.id,
    details.name || '',
    details.email || '',
    [addr.line1, addr.line2].filter(Boolean).join(', '),
    addr.city || '',
    addr.postal_code || '',
    addr.country || '',
    amountPounds,
    purpose,
    preferredDay || '',
    firstCollectionDate
      ? Utilities.formatDate(firstCollectionDate, 'Europe/London', 'yyyy-MM-dd')
      : '',
    session.subscription || '',
    session.customer || ''
  ]);

  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: 'New Direct Debit signup: ' + (details.name || details.email || 'Unknown'),
      body:
        'A new Direct Debit signup has completed Stripe Checkout.\n\n' +
        'Name: ' + (details.name || '') + '\n' +
        'Email: ' + (details.email || '') + '\n' +
        'Address: ' + (addr.line1 || '') + ', ' + (addr.city || '') + ', ' + (addr.postal_code || '') + '\n\n' +
        'Amount: £' + amountPounds + ' / month\n' +
        'Purpose: ' + purpose + '\n' +
        'Preferred collection day: ' + (preferredDay || 'not set') + '\n' +
        'First collection date: ' +
          (firstCollectionDate
            ? Utilities.formatDate(firstCollectionDate, 'Europe/London', 'd MMM yyyy')
            : 'Stripe default (after BACS mandate clears)') + '\n\n' +
        'Subscription: ' + (session.subscription || '') + '\n' +
        'Customer: ' + (session.customer || '') + '\n'
    });
  } catch (mailErr) {
    console.error('Email notify failed: ' + mailErr.message);
  }
}

// -- Helpers ----------------------------------------------------------------

function readPreferredDay_(session) {
  const fields = session.custom_fields || [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const key = (f.key || '').toLowerCase();
    const label = (f.label && (f.label.custom || '')).toLowerCase();
    const looksLikeDay =
      key.indexOf('day') !== -1 || key.indexOf('date') !== -1 ||
      label.indexOf('collection day') !== -1 || label.indexOf('preferred date') !== -1 ||
      label.indexOf('preferred day') !== -1;
    if (looksLikeDay) {
      const v = f.dropdown ? f.dropdown.value : (f.text ? f.text.value : '');
      // parseInt picks up leading digits, so "1st_of_each_month" -> 1
      const day = parseInt(v, 10);
      if (day >= 1 && day <= 28) return day;
    }
  }
  return null;
}

function readPurpose_(session) {
  const fields = session.custom_fields || [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const key = (f.key || '').toLowerCase();
    const label = (f.label && (f.label.custom || '')).toLowerCase();
    if (key.indexOf('purpose') !== -1 || label.indexOf('purpose') !== -1) {
      return f.dropdown ? f.dropdown.value : (f.text ? f.text.value : '');
    }
  }
  return '';
}

function computeFirstCollectionDate_(preferredDay) {
  const LEAD_DAYS = 5;
  const earliest = new Date();
  earliest.setDate(earliest.getDate() + LEAD_DAYS);

  const target = new Date(earliest.getFullYear(), earliest.getMonth(), preferredDay, 12, 0, 0);
  while (target.getTime() < earliest.getTime()) {
    target.setMonth(target.getMonth() + 1);
  }
  return target;
}

function updateSubscriptionTrialEnd_(secretKey, subscriptionId, firstCollectionDate, purpose) {
  const ts = Math.floor(firstCollectionDate.getTime() / 1000);
  const params = {
    'trial_end': String(ts),
    'proration_behavior': 'none',
    'metadata[purpose]': purpose || ''
  };
  const body = Object.keys(params)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');

  const res = UrlFetchApp.fetch('https://api.stripe.com/v1/subscriptions/' + subscriptionId, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    headers: { Authorization: 'Bearer ' + secretKey },
    payload: body,
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('Stripe ' + res.getResponseCode() + ': ' + res.getContentText());
  }
}

function fetchLineItems_(secretKey, sessionId) {
  if (!secretKey) return [];
  const res = UrlFetchApp.fetch(
    'https://api.stripe.com/v1/checkout/sessions/' + sessionId + '/line_items?limit=10',
    {
      headers: { Authorization: 'Bearer ' + secretKey },
      muteHttpExceptions: true
    }
  );
  if (res.getResponseCode() >= 300) {
    throw new Error('Stripe ' + res.getResponseCode() + ': ' + res.getContentText());
  }
  return JSON.parse(res.getContentText()).data || [];
}

function alreadyLogged_(eventId) {
  if (!eventId) return false;
  const sheet = getOrCreateSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const ids = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === eventId) return true;
  }
  return false;
}

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonResponse_(obj, _statusCodeUnused) {
  // Apps Script web apps can't actually set HTTP status codes, but Stripe is
  // tolerant - it considers any 2xx body as success and retries on errors.
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
