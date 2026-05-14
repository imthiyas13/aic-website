/**
 * Aldershot Islamic Centre — GoCardless Instant Bank Pay proxy.
 *
 * Each scan of a printed QR code (e.g. /exec?amount=5) creates a fresh
 * GoCardless Billing Request + Billing Request Flow via the API and
 * redirects the user to the resulting authorisation_url. On mobile,
 * GoCardless deep-links from there into the donor's banking app via
 * Open Banking — confirming the payment is one tap inside their bank.
 *
 * Why proxy: GoCardless authorisation URLs are single-use, so they can't
 * be encoded directly into a static printed QR. The QR points at this
 * proxy, which mints a fresh URL per scan.
 *
 * Setup: see ./GOCARDLESS-PAY-README.md
 */

const GC_REDIRECT_URI = 'https://aldershotislamiccentre.org.uk/donate-qr.html?status=success';
const GC_EXIT_URI = 'https://aldershotislamiccentre.org.uk/donate-qr.html?status=cancel';
const GC_PAYMENT_DESCRIPTION = 'Donation to Aldershot Islamic Centre';
const MIN_AMOUNT_GBP = 1;
const MAX_AMOUNT_GBP = 5000;

function doGet(e) {
  try {
    const amount = parseFloat(e && e.parameter && e.parameter.amount);
    if (!amount || isNaN(amount) || amount < MIN_AMOUNT_GBP || amount > MAX_AMOUNT_GBP) {
      return errorPage_('Please enter a donation amount between £' + MIN_AMOUNT_GBP + ' and £' + MAX_AMOUNT_GBP + '.');
    }

    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('GOCARDLESS_ACCESS_TOKEN');
    if (!token) {
      return errorPage_('GoCardless is not configured on the server. Please contact the masjid.');
    }
    const env = (props.getProperty('GOCARDLESS_ENV') || 'sandbox').toLowerCase();
    const baseUrl = env === 'live'
      ? 'https://api.gocardless.com'
      : 'https://api-sandbox.gocardless.com';

    // Step 1: create the Billing Request (one-off Instant Bank Pay via faster_payments)
    const brBody = {
      billing_requests: {
        payment_request: {
          amount: Math.round(amount * 100), // pence
          currency: 'GBP',
          description: GC_PAYMENT_DESCRIPTION,
          scheme: 'faster_payments'
        }
      }
    };

    const brRes = gcFetch_(baseUrl + '/billing_requests', 'post', token, brBody);
    if (brRes.getResponseCode() >= 300) {
      console.error('Billing request create failed: ' + brRes.getContentText());
      return errorPage_('Sorry, the payment provider returned an error. Please try again.');
    }
    const br = JSON.parse(brRes.getContentText()).billing_requests;

    // Step 2: create the Billing Request Flow (hosted Open Banking page)
    const flowBody = {
      billing_request_flows: {
        redirect_uri: GC_REDIRECT_URI,
        exit_uri: GC_EXIT_URI,
        links: { billing_request: br.id }
      }
    };

    const flowRes = gcFetch_(baseUrl + '/billing_request_flows', 'post', token, flowBody);
    if (flowRes.getResponseCode() >= 300) {
      console.error('Billing request flow create failed: ' + flowRes.getContentText());
      return errorPage_('Sorry, the payment provider returned an error. Please try again.');
    }
    const flow = JSON.parse(flowRes.getContentText()).billing_request_flows;

    return redirectPage_(flow.authorisation_url, amount);
  } catch (err) {
    console.error(err);
    return errorPage_('Unexpected error. Please try again or scan another QR code.');
  }
}

function gcFetch_(url, method, token, body) {
  return UrlFetchApp.fetch(url, {
    method: method,
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      'GoCardless-Version': '2015-07-06',
      Accept: 'application/json'
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
}

function redirectPage_(url, amount) {
  // Apps Script web apps wrap output in their own iframe, so we use
  // window.top.location to break out and navigate the parent frame.
  // A fallback <a> tag handles the rare case where the JS redirect is blocked.
  const safeUrl = String(url).replace(/[<>"]/g, '');
  const amountText = '£' + Number(amount).toFixed(2);
  const html =
    '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Opening your bank…</title>' +
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center;padding:60px 24px;color:#1f2933;background:#faf6ec;margin:0;}' +
    'h1{font-size:22px;margin:0 0 8px;color:#0a3f25;}' +
    'p{font-size:16px;line-height:1.55;margin:0 0 16px;}' +
    '.amount{font-size:32px;font-weight:700;color:#0e5c36;margin:12px 0 24px;}' +
    '.spinner{width:48px;height:48px;margin:0 auto 24px;border:4px solid rgba(14,92,54,.18);border-top-color:#0e5c36;border-radius:50%;animation:spin 1s linear infinite;}' +
    '@keyframes spin{to{transform:rotate(360deg);}}' +
    '.fallback{margin-top:32px;display:inline-block;background:#0e5c36;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;}' +
    '</style></head><body>' +
    '<div class="spinner" aria-hidden="true"></div>' +
    '<div class="amount">' + amountText + '</div>' +
    '<h1>Opening your bank…</h1>' +
    '<p>You\'ll authorise this donation inside your banking app. Your bank covers fraud and payment protection as normal.</p>' +
    '<a class="fallback" href="' + safeUrl + '" target="_top" rel="noopener">Tap here if nothing happens</a>' +
    '<script>' +
    'try{window.top.location.href=' + JSON.stringify(safeUrl) + ';}' +
    'catch(e){window.location.href=' + JSON.stringify(safeUrl) + ';}' +
    '</script>' +
    '</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle('Opening your bank…')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function errorPage_(message) {
  const safe = String(message).replace(/[<>"]/g, '');
  const html =
    '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Donation error</title>' +
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center;padding:60px 24px;color:#1f2933;background:#faf6ec;margin:0;}' +
    'h1{font-size:22px;margin:0 0 12px;color:#0a3f25;}' +
    'p{font-size:16px;line-height:1.55;margin:0 0 16px;}' +
    '.back{display:inline-block;margin-top:18px;background:#0e5c36;color:#fff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:600;}' +
    '</style></head><body>' +
    '<h1>Something went wrong</h1>' +
    '<p>' + safe + '</p>' +
    '<a class="back" href="https://aldershotislamiccentre.org.uk/donate-qr.html" target="_top">Back to donate page</a>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html);
}
