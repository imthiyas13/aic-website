# Direct Debit Form — Backend Setup

The form on `service-charity.html` (`#direct-debit`) submits to a Google Apps
Script web app. The script:

1. Appends each signup to a Google Sheet (audit log).
2. Calls the Stripe API to create a **Checkout Session** in subscription
   mode with **BACS Direct Debit** at the donor's chosen monthly amount.
3. Returns the session URL — the frontend redirects the donor to Stripe.
4. The donor enters their sort code / account number on Stripe's hosted
   page. Stripe creates the customer, mandate, and monthly subscription.
5. Stripe collects the subscription each month automatically (no further
   action needed from the masjid).

Bank account details never touch our servers or the Google Sheet.

## 1. Create the Google Sheet

1. Go to <https://sheets.new> and call it **AIC Direct Debit Signups**.
2. Copy the sheet ID from the URL — it's the part between `/d/` and `/edit`.

## 2. Create the Apps Script project

1. From the sheet: **Extensions → Apps Script**.
2. Delete `Code.gs` and paste in the contents of
   [`direct-debit.gs`](direct-debit.gs).
3. Replace `PASTE_YOUR_GOOGLE_SHEET_ID_HERE` with the sheet ID from step 1.
4. Save (disk icon).

## 3. Enable BACS Direct Debit in Stripe

1. Log into the Stripe Dashboard.
2. Go to **Settings → Payments → Payment methods**.
3. Enable **BACS Direct Debit**.
4. Complete the verification Stripe asks for (charity name, address,
   service user number is assigned automatically).
5. Note: BACS DD subscriptions only work in GBP and only for UK customers.

## 4. Add the Stripe secret key to Apps Script

1. In Stripe Dashboard: **Developers → API keys** → copy your **secret key**
   (`sk_live_…` for production, `sk_test_…` for testing).
2. In Apps Script: **⚙ Project Settings → Script Properties → Add property**:
   - Name: `STRIPE_SECRET_KEY`
   - Value: `sk_test_…` (start in test mode)
3. Save.

## 5. Deploy as web app

1. **Deploy → New deployment → ⚙ → Web app**.
2. Settings:
   - **Execute as:** Me
   - **Who has access:** Anyone
3. Click **Deploy**, authorise when prompted.
4. Copy the **Web app URL** (ends in `/exec`).

## 6. Paste the URL into the website

Open [`../assets/js/direct-debit.js`](../assets/js/direct-debit.js) and replace
`REPLACE_WITH_APPS_SCRIPT_WEB_APP_URL` (line 8) with the URL from step 5.

## 7. Test in Stripe test mode

1. Open `service-charity.html`, scroll to the form.
2. Fill in test details, set amount to e.g. £5, choose a purpose, submit.
3. You should be redirected to Stripe Checkout.
4. Use Stripe's test BACS DD details:
   - Sort code: `10-88-00`
   - Account number: `00012345`
   - Name on account: anything
5. Complete checkout. You should land back on `service-charity.html?dd=success`.
6. Check the Stripe Dashboard → Customers / Subscriptions — the subscription
   should be listed with status `active` (or `incomplete` until the BACS
   mandate clears, usually 3 working days).
7. Check the Google Sheet — a new row should be present.
8. Check `info@aldershotislamiccentre.org.uk` for the notification email.

Test card / DD references: <https://stripe.com/docs/testing#bacs-direct-debit>

## 8. Go live

1. In Stripe Dashboard, toggle from test to live mode.
2. Generate a live secret key (`sk_live_…`) and update the Apps Script
   `STRIPE_SECRET_KEY` property.
3. **Deploy → Manage deployments → ✏ → Version: New version → Deploy**
   (URL stays the same).

## Re-deploying after code changes

After editing `direct-debit.gs`: **Deploy → Manage deployments → ✏ →
Version: New version → Deploy**. The URL doesn't change.

## What the form does NOT collect

Page fields: title, name, address, town, postcode, email, phone, amount,
start date, purpose.

It does **not** collect sort code or account number — Stripe captures them
on their hosted Checkout page, protected by the Direct Debit Guarantee.
This keeps the masjid out of scope for sensitive bank data handling.

## Notes

- **Start date**: if the donor picks a future start date, the script sets
  `subscription_data[trial_end]` so the first collection is delayed until
  that date. BACS clearing also takes ~3 working days on top.
- **Fees**: Stripe BACS DD is currently 1% + 20p per payment, capped at £4.
  Check <https://stripe.com/gb/pricing> for the latest.
- **Refunds / cancellations**: handle these in the Stripe Dashboard.
  Customers can also cancel the Direct Debit at any time with their bank.
