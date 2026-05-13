# Direct Debit Setup — Stripe Payment Links + Apps Script Webhook

Architecture:

1. **Five Stripe Payment Links** (configured in Stripe Dashboard), one per
   monthly amount tier: **£5, £10, £20, £50, £100**. Each is a recurring
   monthly subscription with BACS Direct Debit enabled. Each collects:
   - Name, email, billing address — automatically.
   - Bank details — sort code / account number / mandate signature.
   - **Preferred Collection Day** (custom field, 1–28 dropdown).
   - **Purpose** (custom field, dropdown).
2. **Website** shows the five tiers as a row of buttons on
   `service-charity.html` — each links to its Payment Link. There's also a
   secondary link to your existing one-off Stripe donation page for donors
   who want a different amount or a single gift.
3. **Apps Script webhook** receives `checkout.session.completed` events from
   Stripe (one webhook endpoint, all five Payment Links fire to it):
   - Reads the custom fields, computes the next occurrence of the donor's
     preferred day, and updates the subscription's `trial_end` so the first
     and every future collection lands on that day.
   - Appends a row to the Google Sheet with the donor's amount, address,
     and chosen day.
   - Emails `info@aldershotislamiccentre.org.uk`.

Bank account details never touch the masjid's systems.

---

## Why Payment Links and not a custom form?

Stripe Payment Links don't support donor-chosen amounts for *subscriptions*
(only one-off payments). So we use a fixed price per tier. Five tiers covers
the typical range of charity donations; donors wanting unusual amounts use the
existing one-off Stripe link.

## 1. Create five products + prices in Stripe

Easiest: one product with five prices.

1. **Product catalogue → Add product** (or edit the existing
   *Aldershot Islamic Centre - Monthly Donation* product).
2. Add five prices on that product, all **Recurring → Monthly**:
   £5.00, £10.00, £20.00, £50.00, £100.00.

(Or create five separate products if you prefer — the donor doesn't see the
internal grouping.)

## 2. Create five Payment Links

For each of the five amounts (£5, £10, £20, £50, £100):

1. **Payment Links → + Create**.
2. **Select type**: Products or subscriptions.
3. **Product**: pick *Aldershot Islamic Centre - Monthly Donation* at this
   specific price tier (e.g. £5/month for the £5 link).
4. **Options** (tick):
   - **Collect customer addresses** ✓
5. **Advanced options** → **Add custom fields**:
   - Field 1: key `preferred_day`, label "Preferred Collection Day", type
     **Dropdown**, required ✓. Add 28 options — value `1`/label "1st of each
     month", value `2`/label "2nd of each month", … up to `28`.
   - Field 2: key `purpose`, label "Purpose", type **Dropdown**, required ✓.
     Options: `general`/General, `madrasa`/Madrasa, `building_fund`/Building
     Fund, `sadaqah`/Sadaqah, `zakat`/Zakat.
6. **Adaptive Pricing**: untick.
7. **Call to action**: `Donate` (or `Subscribe`).
8. **After payment** tab → **Don't show confirmation page → Redirect customers
   to your website** → URL:
   `https://aldershotislamiccentre.org.uk/service-charity.html?dd=success`
9. **Create link** → copy the `https://buy.stripe.com/...` URL.

**Shortcut**: create the first link fully, then use Stripe's *Duplicate* on
the Payment Links list page for the other four — just change the price each
time. Saves re-entering custom fields and address settings.

## 3. Paste the five URLs into the website

Open [`../service-charity.html`](../service-charity.html) and replace each
placeholder with its matching Stripe URL:

| Placeholder | Replace with |
| --- | --- |
| `REPLACE_WITH_STRIPE_LINK_5`   | £5 Payment Link URL  |
| `REPLACE_WITH_STRIPE_LINK_10`  | £10 Payment Link URL |
| `REPLACE_WITH_STRIPE_LINK_20`  | £20 Payment Link URL |
| `REPLACE_WITH_STRIPE_LINK_50`  | £50 Payment Link URL |
| `REPLACE_WITH_STRIPE_LINK_100` | £100 Payment Link URL |

Then re-upload `service-charity.html` via FileZilla.

## 4. Apps Script — paste the code

1. Open your Google Sheet → **Extensions → Apps Script**.
2. Replace `Code.gs` with the contents of [`direct-debit.gs`](direct-debit.gs).
3. Save.

## 5. Apps Script — Script Properties

**⚙ Project Settings → Script Properties → + Add property** (two entries):

| Name                | Value                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY` | `sk_test_…` (or `sk_live_…` when going live)                                           |
| `WEBHOOK_TOKEN`     | a long random string of your choice, e.g. from <https://generate-secret.vercel.app/32> |

## 6. Deploy as Web App

- **Deploy → New deployment → ⚙ → Web app**.
- Execute as: **Me**. Who has access: **Anyone**.
- Click **Deploy**, authorise the requested scopes.
- Copy the `https://script.google.com/macros/s/…/exec` URL.

## 7. Register the webhook in Stripe

Stripe Dashboard → **Developers → Webhooks → + Add endpoint**:

- **Endpoint URL**: paste your Apps Script `/exec` URL with `?token=<WEBHOOK_TOKEN>` appended.
- **Events to send**: just `checkout.session.completed`.
- **Add endpoint**.

This webhook fires for *all* Payment Links on the account, so you only need to
register it once — not per link.

## 8. Test in test mode

1. Make sure the Payment Links, webhook, and `STRIPE_SECRET_KEY` are all in
   **test mode**.
2. Visit `service-charity.html`, click any amount tier.
3. On the Stripe page:
   - Custom fields: pick a day, pick a purpose.
   - BACS test creds: sort `10-88-00`, account `00012345`, any name.
4. Submit. You should land back at `?dd=success`.
5. Verify:
   - Stripe Dashboard → Subscriptions: subscription exists with `trial_end`
     set to your chosen day.
   - Google Sheet: a new row was appended.
   - Email at info@: notification arrived.

## 9. Go live

1. Recreate the products, prices, Payment Links, and webhook in **live mode**.
2. Update `STRIPE_SECRET_KEY` in Apps Script to your `sk_live_…` key.
3. Update the five Payment Link URLs in `service-charity.html` to the live
   `https://buy.stripe.com/...` URLs and re-upload.

## Re-deploying after Apps Script code changes

**Deploy → Manage deployments → ✏ → Version: New version → Deploy.** The URL
stays the same — no need to update Stripe webhook config or the website.
