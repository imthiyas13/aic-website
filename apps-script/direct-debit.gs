/**
 * Aldershot Islamic Centre - Direct Debit signup endpoint.
 *
 * Receives JSON from the website form and appends a row to a Google Sheet.
 * Optionally creates a GoCardless billing request flow and returns the
 * authorisation URL so the user can be redirected to authorise their bank.
 *
 * Setup:
 *  1. Create a Google Sheet (e.g. "AIC Direct Debit Signups").
 *  2. Copy its ID from the URL: docs.google.com/spreadsheets/d/<THIS_PART>/edit
 *  3. Paste it into SHEET_ID below.
 *  4. (Optional) Add a GoCardless access token in Script Properties:
 *        Project Settings -> Script Properties -> Add property
 *        Name:  GOCARDLESS_ACCESS_TOKEN
 *        Value: live_xxx or sandbox_xxx
 *     Also set GOCARDLESS_ENV to "live" or "sandbox" (defaults to "sandbox").
 *  5. Deploy -> New deployment -> Type: Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *     Copy the Web App URL.
 *  6. Paste that URL into ENDPOINT in assets/js/direct-debit.js.
 *
 * Notes:
 *  - The website only collects name/address/email/phone/amount/purpose/start date.
 *  - Bank account details (sort code / account number) are NEVER collected here -
 *    GoCardless captures them on their own hosted page, protected by the
 *    Direct Debit Guarantee.
 */

const SHEET_ID = 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE';
const SHEET_NAME = 'Signups';

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
  'GoCardless Billing Request ID',
  'User Agent',
  'Page URL'
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // Append to sheet
    const sheet = getOrCreateSheet_();
    const props = PropertiesService.getScriptProperties();
    const gcToken = props.getProperty('GOCARDLESS_ACCESS_TOKEN');
    const gcEnv = props.getProperty('GOCARDLESS_ENV') || 'sandbox';

    let billingRequestId = '';
    let redirectUrl = '';

    if (gcToken) {
      try {
        const flow = createGoCardlessFlow_(gcToken, gcEnv, data);
        billingRequestId = flow.billingRequestId;
        redirectUrl = flow.authorisationUrl;
      } catch (gcErr) {
        // Log and continue - we still save the row even if GC fails
        console.error('GoCardless flow failed: ' + gcErr.message);
      }
    }

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
      billingRequestId,
      data.userAgent || '',
      data.pageUrl || ''
    ]);

    // Email the masjid so they see signups in real time
    try {
      MailApp.sendEmail({
        to: 'info@aldershotislamiccentre.org.uk',
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
          (billingRequestId
            ? 'GoCardless billing request created: ' + billingRequestId + '\n'
            : 'GoCardless flow not created - send the donor a manual link.\n')
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
 * Creates a GoCardless Billing Request + Billing Request Flow.
 * Returns { billingRequestId, authorisationUrl }.
 * Docs: https://developer.gocardless.com/api-reference/#billing-requests-billing-requests
 */
function createGoCardlessFlow_(token, env, data) {
  const baseUrl = env === 'live'
    ? 'https://api.gocardless.com'
    : 'https://api-sandbox.gocardless.com';

  // 1. Create the billing request (mandate-only - donor authorises but no charge yet)
  const brBody = {
    billing_requests: {
      mandate_request: {
        currency: 'GBP',
        scheme: 'bacs',
        metadata: {
          purpose: data.purpose || 'General',
          amount: String(data.amount || ''),
          start_date: data.startDate || ''
        }
      }
    }
  };

  const brRes = UrlFetchApp.fetch(baseUrl + '/billing_requests', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      'GoCardless-Version': '2015-07-06',
      Accept: 'application/json'
    },
    payload: JSON.stringify(brBody),
    muteHttpExceptions: true
  });

  if (brRes.getResponseCode() >= 300) {
    throw new Error('Billing request create failed: ' + brRes.getContentText());
  }
  const br = JSON.parse(brRes.getContentText()).billing_requests;

  // 2. Create the flow (hosted authorisation page)
  const flowBody = {
    billing_request_flows: {
      redirect_uri: 'https://aldershotislamiccentre.org.uk/service-charity.html#direct-debit',
      exit_uri: 'https://aldershotislamiccentre.org.uk/service-charity.html',
      prefilled_customer: {
        given_name: (data.fullName || '').split(' ')[0],
        family_name: (data.fullName || '').split(' ').slice(1).join(' '),
        email: data.email || '',
        address_line1: data.address || '',
        city: data.town || '',
        postal_code: data.postcode || '',
        country_code: 'GB'
      },
      links: { billing_request: br.id }
    }
  };

  const flowRes = UrlFetchApp.fetch(baseUrl + '/billing_request_flows', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      'GoCardless-Version': '2015-07-06',
      Accept: 'application/json'
    },
    payload: JSON.stringify(flowBody),
    muteHttpExceptions: true
  });

  if (flowRes.getResponseCode() >= 300) {
    throw new Error('Billing request flow create failed: ' + flowRes.getContentText());
  }
  const flow = JSON.parse(flowRes.getContentText()).billing_request_flows;

  return {
    billingRequestId: br.id,
    authorisationUrl: flow.authorisation_url
  };
}
