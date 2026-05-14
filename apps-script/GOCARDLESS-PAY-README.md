# QR Donation Page — GoCardless Instant Bank Pay Proxy

## What this does

`donate-qr.html` shows four QR codes (£5, £10, £15, £20) intended to be
printed and pinned on the masjid notice board. When a donor scans one:

1. Phone opens the URL inside the QR (your Apps Script Web App URL with
   `?amount=5` or similar).
2. Apps Script calls the GoCardless API to create a fresh **Billing
   Request + Billing Request Flow** for an Instant Bank Pay one-off
   payment of that amount.
3. Apps Script redirects the donor to GoCardless's hosted authorisation
   page.
4. GoCardless detects the donor's phone, asks which bank they use, and
   **deep-links into their banking app** with the payment already
   pre-filled.
5. Donor confirms in their banking app → money lands in the masjid's
   bank account, usually within seconds via Faster Payments.

The reason for the proxy: GoCardless authorisation URLs are **single-use**,
so you can't encode them directly into a static printed QR — only the
first scanner would be able to use it. The proxy mints a fresh URL per
scan.

## 1. Enable Instant Bank Pay on GoCardless

This is a paid GoCardless add-on, separate from BACS Direct Debit.

1. Log into the GoCardless Dashboard.
2. Navigate to **Add-ons** or **Settings → Pricing** — look for
   *"Instant Bank Pay"* (sometimes called *"Open Banking"* internally).
3. If it isn't already enabled, request activation. GoCardless typically
   needs to know you'll be using it for charity donations.
4. Pricing (as of writing): **1% + 20p per transaction**, no monthly fee.
   For a £10 donation, that's ~30p — but the donor sees the full £10
   debited from their bank in real time, and the masjid gets the funds
   the same day.

You can verify Instant Bank Pay is enabled by trying to create a Billing
Request with `scheme: faster_payments` via the API — if it returns
`scheme_not_enabled`, raise a support ticket with GoCardless.

## 2. Get a GoCardless access token

1. GoCardless Dashboard → **Developers → Access tokens**.
2. **Create** a new access token.
   - Name: `AIC Apps Script proxy`
   - Scope: leave at **Read-write** (it needs to create billing requests).
   - Mode: **Sandbox** for testing, then create a separate **Live** token
     when you're confident it works.
3. Copy the token shown — it starts with `live_…` or `sandbox_…`. Save it
   somewhere safe **immediately**; GoCardless only shows it once.

## 3. Create the Apps Script project

If you already have an Apps Script project for AIC (the Direct Debit
signup one), you can add the proxy to that. Otherwise create a new one:

1. Open <https://script.google.com/> → **New project**.
2. Rename it to something like *"AIC GoCardless Pay Proxy"*.
3. Delete the placeholder `Code.gs` and paste in the contents of
   [`gocardless-pay.gs`](gocardless-pay.gs).
4. Save (disk icon).

## 4. Set Script Properties

**⚙ Project Settings → Script Properties → + Add property** (twice):

| Name                       | Value                                          |
| -------------------------- | ---------------------------------------------- |
| `GOCARDLESS_ACCESS_TOKEN`  | `sandbox_…` (test mode) or `live_…` (live)     |
| `GOCARDLESS_ENV`           | `sandbox` (test mode) or `live`                |

Save.

## 5. Deploy as Web App

1. **Deploy → New deployment → ⚙ → Web app**.
2. Settings:
   - **Execute as:** Me
   - **Who has access:** Anyone
3. Click **Deploy**, authorise the scopes when prompted (the script needs
   `UrlFetchApp` to call GoCardless).
4. Copy the **Web app URL** — it ends in `/exec`.

## 6. Paste the URL into the website

Open [`../donate-qr.html`](../donate-qr.html), find:

```js
var GOCARDLESS_PROXY_URL = 'REPLACE_WITH_APPS_SCRIPT_URL';
```

…and replace the placeholder with your `/exec` URL (no `?amount=` —
the page appends that per QR code). Re-upload `donate-qr.html` via FileZilla.

The page detects whether the proxy URL is configured: if the placeholder
is still there, QRs fall back to Donorbox prefilled URLs so the page
still works (just without the direct-to-bank-app experience).

## 7. Test on a phone

1. With everything in **sandbox mode**, open `donate-qr.html` in your
   browser and try scanning the £5 QR with your phone.
2. Your phone opens the Apps Script URL → it should redirect (a brief
   "Opening your bank…" loading screen) to GoCardless's hosted
   authorisation page.
3. GoCardless's sandbox lets you pick a fake bank and simulate a
   successful authorisation without actually moving money.
4. After confirming, you should land back on
   `donate-qr.html?status=success`.

If anything errors, check the Apps Script logs: **Executions** in the
left sidebar of the Apps Script editor.

## 8. Go live

1. Swap `GOCARDLESS_ACCESS_TOKEN` to your `live_…` token.
2. Set `GOCARDLESS_ENV` to `live`.
3. **Deploy → Manage deployments → ✏ → Version: New version → Deploy.**
   The URL stays the same — no change needed in the website.
4. Do one real £5 test scan from your own phone. If you'd rather not
   actually pay yourself, just scan, get to the GoCardless authorisation
   page, then close the tab without confirming in your bank app.
   Nothing is debited until you confirm in your bank.

## Re-deploying after code changes

**Deploy → Manage deployments → ✏ → Version: New version → Deploy.**
URL stays the same.

## Cost summary

- **GoCardless Instant Bank Pay**: 1% + 20p per transaction (e.g. ~30p
  on £10, ~40p on £20). No monthly fee.
- **Apps Script Web App**: free up to 20,000 UrlFetch calls per day
  (each scan uses 2 calls, so up to ~10,000 scans/day, comfortably
  enough for a masjid).
- **No other recurring costs.**

## Why not Crezco (which is free for charities)?

Crezco offers a similar Open Banking Pay-by-Bank experience at 0% fees
for charities. Trade-off is a separate signup + KYC verification process
(1–2 days). Since AIC already has GoCardless wired up, this proxy uses
that. If transaction fees become a concern as donation volume grows,
Crezco is worth revisiting — the `donate-qr.html` HTML wouldn't need to
change; only the Apps Script proxy would.
