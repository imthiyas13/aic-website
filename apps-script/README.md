# Direct Debit Form — Backend Setup

The form on `service-charity.html` (`#direct-debit`) submits to a Google Apps
Script web app that writes each signup to a Google Sheet and (optionally)
creates a GoCardless billing request flow.

## 1. Create the Google Sheet

1. Go to <https://sheets.new> and call it **AIC Direct Debit Signups**.
2. Copy the sheet ID from the URL — it's the part between `/d/` and `/edit`.

## 2. Create the Apps Script project

1. From the sheet: **Extensions → Apps Script**.
2. Delete the placeholder `Code.gs` and paste in the contents of
   [`direct-debit.gs`](direct-debit.gs).
3. Replace `PASTE_YOUR_GOOGLE_SHEET_ID_HERE` with the sheet ID from step 1.
4. Save (disk icon).

## 3. (Optional) Wire up GoCardless auto-redirect

If you skip this, the form still works — signups land in the sheet and an
email goes to `info@aldershotislamiccentre.org.uk`. You then send the donor
a GoCardless link manually.

To auto-create a GoCardless billing request flow and redirect the donor:

1. Get a GoCardless access token: <https://manage.gocardless.com/developers/access-tokens>
   (start with **sandbox** for testing).
2. In Apps Script: **Project Settings (⚙) → Script Properties → Add property**:
   - `GOCARDLESS_ACCESS_TOKEN` = `sandbox_xxx…` (or `live_xxx…`)
   - `GOCARDLESS_ENV` = `sandbox` (or `live`)

## 4. Deploy as web app

1. **Deploy → New deployment → ⚙ → Web app**.
2. Settings:
   - **Execute as:** Me
   - **Who has access:** Anyone
3. Click **Deploy**, authorise when prompted.
4. Copy the **Web app URL** (ends in `/exec`).

## 5. Paste the URL into the website

Open [`../assets/js/direct-debit.js`](../assets/js/direct-debit.js) and replace
`REPLACE_WITH_APPS_SCRIPT_WEB_APP_URL` with the URL from step 4.

## 6. Test

1. Open `service-charity.html` in a browser, scroll to the form.
2. Submit with test data.
3. Check the sheet — a new row should appear.
4. Check `info@aldershotislamiccentre.org.uk` — a notification email should arrive.
5. If GoCardless is wired up, you'll be redirected to their hosted page.

## Re-deploying after changes

After editing `direct-debit.gs`: **Deploy → Manage deployments → ✏ (edit) →
Version: New version → Deploy**. The URL stays the same.

## What the form does NOT collect

The page collects: title, name, address, email, phone, amount, start date, purpose.

It does **not** collect sort code or account number — those are captured on
GoCardless's hosted page, protected by the Direct Debit Guarantee. This keeps
the masjid out of scope for sensitive bank data handling.
