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
    const rawAmount = e && e.parameter && e.parameter.amount;
    // If no amount in URL, show the amount-entry form. The form posts back
    // to this same URL with ?amount=N&email=… and we fall through to the
    // GoCardless flow on the next request.
    if (!rawAmount) {
      return amountEntryPage_();
    }
    const amount = parseFloat(rawAmount);
    if (!amount || isNaN(amount) || amount < MIN_AMOUNT_GBP || amount > MAX_AMOUNT_GBP) {
      return errorPage_('Please enter a donation amount between £' + MIN_AMOUNT_GBP + ' and £' + MAX_AMOUNT_GBP + '.');
    }
    const email = String((e.parameter.email || '')).trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return errorPage_('Please enter a valid email address.');
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

    // Step 1: create the Billing Request (one-off Instant Bank Pay via faster_payments).
    // Customer details (email) go on the flow's prefilled_customer, not here -
    // GoCardless rejects customer_details as an unknown key on billing_requests.
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
      const errText = brRes.getContentText();
      console.error('Billing request create failed: ' + errText);
      return errorPage_('Payment provider error: ' + errText.substring(0, 200));
    }
    const br = JSON.parse(brRes.getContentText()).billing_requests;

    // Step 2: create the Billing Request Flow (hosted Open Banking page).
    // customer_details_captured: true tells GoCardless we've already collected
    // the donor's details on our side, so its customer-collection screen is
    // skipped entirely - the donor goes straight from our amount page to the
    // bank-pick step.
    const flowBody = {
      billing_request_flows: {
        redirect_uri: GC_REDIRECT_URI,
        exit_uri: GC_EXIT_URI,
        prefilled_customer: { email: email },
        customer_details_captured: true,
        links: { billing_request: br.id }
      }
    };

    const flowRes = gcFetch_(baseUrl + '/billing_request_flows', 'post', token, flowBody);
    if (flowRes.getResponseCode() >= 300) {
      const errText = flowRes.getContentText();
      console.error('Billing request flow create failed: ' + errText);
      // Surface a short hint in the user message for easier debugging
      return errorPage_('Payment provider error: ' + errText.substring(0, 200));
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

function amountEntryPage_() {
  // The form posts back to this same Apps Script /exec URL with ?amount=N.
  // We use ScriptApp.getService().getUrl() so the form works regardless of
  // which deployment of the script is being served.
  const scriptUrl = ScriptApp.getService().getUrl();
  const html =
    '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Donate to the Masjid</title>' +
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#faf6ec;color:#1f2933;margin:0;padding:40px 20px;text-align:center;}' +
    'h1{font-family:Lora,Georgia,serif;font-size:58px;color:#0a3f25;margin:0 0 16px;font-weight:700;line-height:1.1;}' +
    '.arabic{font-family:Amiri,serif;direction:rtl;font-size:42px;color:#0e5c36;margin:14px 0 22px;}' +
    '.intro{font-size:32px;color:#6b7480;margin:0 auto 42px;line-height:1.4;padding:0 12px;}' +
    '.card{max-width:780px;margin:0 auto;background:#fff;border:3px solid #0e5c36;border-radius:28px;padding:52px 40px;box-shadow:0 10px 28px rgba(14,92,54,0.12);}' +
    '.input-wrap{position:relative;margin-bottom:26px;}' +
    '.input-wrap .prefix{position:absolute;left:34px;top:50%;transform:translateY(-50%);font-size:62px;color:#6b7480;font-weight:500;pointer-events:none;}' +
    'input[type="number"]{font-family:inherit;font-size:72px;font-weight:700;padding:32px 32px 32px 106px;width:100%;border:2px solid rgba(14,92,54,0.18);border-radius:20px;text-align:center;box-sizing:border-box;-webkit-appearance:none;appearance:none;min-height:146px;color:#1f2933;}' +
    'input[type="email"]{font-family:inherit;font-size:36px;font-weight:400;padding:28px;width:100%;border:2px solid rgba(14,92,54,0.18);border-radius:20px;text-align:center;box-sizing:border-box;-webkit-appearance:none;appearance:none;min-height:110px;color:#1f2933;}' +
    'input:focus{outline:none;border-color:#0e5c36;box-shadow:0 0 0 5px rgba(14,92,54,0.10);}' +
    'button{font-family:inherit;width:100%;padding:34px 42px;background:#0e5c36;color:#fff;border:0;border-radius:20px;font-size:32px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;cursor:pointer;min-height:120px;margin-top:10px;}' +
    'button:hover,button:focus{background:#0a3f25;}' +
    '.hint{font-size:24px;color:#6b7480;line-height:1.5;margin:30px 0 0;padding:0 8px;}' +
    '.error{color:#c0392b;font-size:26px;margin-top:22px;display:none;}' +
    '.error.visible{display:block;}' +
    'footer{margin-top:52px;font-size:24px;color:#8a8f99;line-height:1.6;}' +
    '</style></head><body>' +
    '<h1>Donate to the Masjid</h1>' +
    '<p class="arabic">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</p>' +
    '<p class="intro">Enter any amount, then authorise the payment in your banking app.</p>' +
    '<div class="card">' +
    '<form id="amount-form" novalidate>' +
    '<div class="input-wrap">' +
    '<span class="prefix" aria-hidden="true">£</span>' +
    '<input type="number" id="amount-input" name="amount" min="1" max="5000" step="1" inputmode="decimal" aria-label="Donation amount in pounds" required autofocus>' +
    '</div>' +
    '<div class="input-wrap input-wrap-plain">' +
    '<input type="email" id="email-input" name="email" placeholder="your@email.com" inputmode="email" autocomplete="email" aria-label="Your email address" required>' +
    '</div>' +
    '<button type="submit">Donate now</button>' +
    '<p class="error" id="amount-error" role="alert"></p>' +
    '<p class="hint">Pay directly from your bank account · protected by your bank\'s usual security</p>' +
    '</form>' +
    '</div>' +
    '<footer>Aldershot Islamic Centre · Registered Charity 1214576</footer>' +
    '<script>' +
    'var SCRIPT_URL=' + JSON.stringify(scriptUrl) + ';' +
    'var EMAIL_RE=/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;' +
    'document.getElementById("amount-form").addEventListener("submit",function(ev){' +
    'ev.preventDefault();' +
    'var amtInput=document.getElementById("amount-input");' +
    'var emailInput=document.getElementById("email-input");' +
    'var err=document.getElementById("amount-error");' +
    'var amt=parseFloat(amtInput.value);' +
    'var email=(emailInput.value||"").trim();' +
    'err.classList.remove("visible");' +
    'if(isNaN(amt)||amt<1||amt>5000){err.textContent="Please enter an amount between £1 and £5,000.";err.classList.add("visible");amtInput.focus();return;}' +
    'if(!email||!EMAIL_RE.test(email)){err.textContent="Please enter a valid email address.";err.classList.add("visible");emailInput.focus();return;}' +
    'var sep=SCRIPT_URL.indexOf("?")===-1?"?":"&";' +
    'var url=SCRIPT_URL+sep+"amount="+encodeURIComponent(amt)+"&email="+encodeURIComponent(email);' +
    'try{window.top.location.href=url;}catch(e){window.location.href=url;}' +
    '});' +
    '</script>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('Donate to the Masjid')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
