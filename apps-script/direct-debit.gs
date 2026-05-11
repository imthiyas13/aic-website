/**
 * Aldershot Islamic Centre - Monthly Direct Debit signup endpoint.
 *
 * Receives JSON from the website form, appends a row to a Google Sheet,
 * creates a Stripe Checkout Session (subscription mode, BACS Direct Debit,
 * donor-chosen amount), and returns the session URL so the frontend can
 * redirect the donor. The donor enters bank details on Stripe's hosted
 * Checkout page - they never touch our servers/sheet.
 *
 * Setup: see ./README.md
 */

const SHEET_ID = 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE';
const SHEET_NAME = 'Signups';

const SUCCESS_URL = 'https://aldershotislamiccentre.org.uk/service-charity.html?dd=success';
const CANCEL_URL  = 'https://aldershotislamiccentre.org.uk/service-charity.html#direct-debit';
const NOTIFY_EMAIL = 'info@aldershotislamiccentre.org.uk';

const HEADERS = [
  'Timestamp',
  'Title',
  'Full Name',
  'Address',
  'Town/City',
  'Postcode',
  'Email',
  'Phone',
  'Amount (£)',
  'Frequency',
  'Start Date',
  'Purpose',
  'Stripe Checkout Session ID',
  'User Agent',
  'Page URL'
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // Basic server-side validation
    const amount = parseFloat(data.amount);
    if (!data.fullName || !data.email || !amount || amount < 1 || !data.purpose) {
      return jsonResponse_({ ok: false, error: 'Missing required fields' });
    }

    const props = PropertiesService.getScriptProperties();
    const stripeKey = props.getProperty('STRIPE_SECRET_KEY');

    let sessionId = '';
    let redirectUrl = '';

    if (stripeKey) {
      try {
        const session = createStripeCheckoutSession_(stripeKey, data);
        sessionId = session.id;
        redirectUrl = session.url;
      } catch (stripeErr) {
        console.error('Stripe session create failed: ' + stripeErr.message);
        return jsonResponse_({ ok: false, error: 'Payment provider error. Please try again or email the masjid.' });
      }
    }

    // Append signup to sheet (always, even if Stripe fails)
    const sheet = getOrCreateSheet_();
    sheet.appendRow([
      new Date(),
      data.title || '',
      data.fullName || '',
      data.address || '',
      data.town || '',
      data.postcode || '',
      data.email || '',
      data.phone || '',
      data.amount || '',
      data.frequency || 'Monthly',
      data.startDate || '',
      data.purpose || '',
      sessionId,
      data.userAgent || '',
      data.pageUrl || ''
    ]);

    try {
      MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        subject: 'New Direct Debit signup: ' + (data.fullName || 'Unknown'),
        body:
          'A new Direct Debit signup has been submitted.\n\n' +
          'Name: ' + (data.fullName || '') + '\n' +
          'Email: ' + (data.email || '') + '\n' +
          'Phone: ' + (data.phone || '') + '\n' +
          'Address: ' + (data.address || '') + ', ' + (data.town || '') + ', ' + (data.postcode || '') + '\n\n' +
          'Amount: £' + (data.amount || '') + ' / month\n' +
          'Start Date: ' + (data.startDate || '') + '\n' +
          'Purpose: ' + (data.purpose || '') + '\n\n' +
          (sessionId
            ? 'Stripe Checkout session: ' + sessionId + '\n' +
              'The donor was redirected to Stripe to enter their bank details. ' +
              'Check the Stripe dashboard to confirm the subscription is active.'
            : 'Stripe is not configured - the donor saw an error. Send them a payment link manually.')
      });
    } catch (mailErr) {
      console.error('Email notify failed: ' + mailErr.message);
    }

    return jsonResponse_({ ok: true, redirectUrl: redirectUrl || null });
  } catch (err) {
    console.error(err);
    return jsonResponse_({ ok: false, error: err.message });
  }
}

function doGet() {
  return jsonResponse_({ ok: true, message: 'AIC Direct Debit endpoint is live.' });
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

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Creates a Stripe Checkout Session in subscription mode with BACS Direct Debit.
 * The donor's chosen amount becomes the monthly recurring price.
 * Docs: https://stripe.com/docs/api/checkout/sessions/create
 */
function createStripeCheckoutSession_(secretKey, data) {
  const amountPence = Math.round(parseFloat(data.amount) * 100);
  const purpose = data.purpose || 'General';
  const productName = 'Aldershot Islamic Centre — Monthly Donation (' + purpose + ')';

  const params = {
    'mode': 'subscription',
    'payment_method_types[0]': 'bacs_debit',
    'customer_email': data.email || '',
    'billing_address_collection': 'auto',
    'line_items[0][price_data][currency]': 'gbp',
    'line_items[0][price_data][product_data][name]': productName,
    'line_items[0][price_data][recurring][interval]': 'month',
    'line_items[0][price_data][unit_amount]': String(amountPence),
    'line_items[0][quantity]': '1',
    'success_url': SUCCESS_URL,
    'cancel_url': CANCEL_URL,
    'metadata[purpose]': purpose,
    'metadata[full_name]': data.fullName || '',
    'metadata[phone]': data.phone || '',
    'metadata[address]': data.address || '',
    'metadata[town]': data.town || '',
    'metadata[postcode]': data.postcode || '',
    'metadata[requested_start_date]': data.startDate || '',
    'subscription_data[metadata][purpose]': purpose,
    'subscription_data[metadata][full_name]': data.fullName || ''
  };

  // If the donor picked a future start date, delay the first charge via trial_end.
  // (BACS clearing also takes ~3 working days regardless.)
  if (data.startDate) {
    const ts = Math.floor(new Date(data.startDate).getTime() / 1000);
    const minTrial = Math.floor(Date.now() / 1000) + 48 * 60 * 60; // Stripe requires trial_end >= now + 48h
    if (ts > minTrial) {
      params['subscription_data[trial_end]'] = String(ts);
    }
  }

  const body = Object.keys(params)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');

  const res = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    headers: { Authorization: 'Bearer ' + secretKey },
    payload: body,
    muteHttpExceptions: true
  });

  if (res.getResponseCode() >= 300) {
    throw new Error('Stripe ' + res.getResponseCode() + ': ' + res.getContentText());
  }

  const session = JSON.parse(res.getContentText());
  return { id: session.id, url: session.url };
}
