# Direct Debit Setup — Stripe Payment Link + Apps Script Webhook

Architecture:

1. **Stripe Payment Link** (configured in Stripe Dashboard) is the only thing
   the donor interacts with. It collects:
   - Amount — donor types the pound value into the `quantity` field (price is
     £1/month, so quantity = monthly amount).
   - Name, email, billing address — collected automatically.
   - Bank details — sort code / account number / mandate signature.
   - **Preferred Collection Day** (custom field, 1–28 dropdown).
   - **Purpose** (custom field, dropdown).
2. **Website** has a single "Set Up Direct Debit" button pointing at the
   Payment Link URL — no form, no Apps Script in the donor's path.
3. **Apps Script webhook** receives `checkout.session.completed` events from
   Stripe:
   - Reads the custom fields, computes the next occurrence of the donor's
     preferred day, and updates the subscription's `trial_end` so the first
     and every future collection lands on that day.
   - Appends a row to the Google Sheet.
   - Emails `info@aldershotislamiccentre.org.uk`.

Bank account details never touch the masjid's systems.

---

## 1. Create the Stripe Payment Link

In Stripe Dashboard → **Payment Links → + New**:

- **Product**: create one called *"Aldershot Islamic Centre Monthly Donation"*.
  - Pricing model: **Standard pricing**.
  - Price: **£1.00 GBP**.
  - Billing period: **Recurring → Monthly**.
- **Type**: Subscription.
- **Quantity adjustable by customer**: ✅ enabled, minimum `1`, maximum `5000`
  (= £5,000/month upper bound; raise if you expect larger gifts).
- **Payment methods**: tick **BACS Direct Debit** (and untick card if you only
  want DD here — your existing Stripe card link covers card donations).
- **Custom fields → + Add custom field**:
  1. Field 1:
     - Key: `preferred_day`
     - Label: `Preferred Collection Day`
     - Type: **Dropdown**
     - Options: enter 28 entries — value `1`/label "1st of each month",
       value `2`/label "2nd of each month", … up to `28`. (Yes, this is
       tedious — paste them in once.)
     - Required: ✅
  2. Field 2:
     - Key: `purpose`
     - Label: `Purpose`
     - Type: **Dropdown**
     - Options:
       - `general` / "General"
       - `madrasa` / "Madrasa"
       - `building_fund` / "Building Fund"
       - `sadaqah` / "Sadaqah"
       - `zakat` / "Zakat"
     - Required: ✅
- **After payment**: redirect to
  `https://aldershotislamiccentre.org.uk/service-charity.html?dd=success`
- **Save**, then copy the resulting `https://buy.stripe.com/...` URL.

## 2. Paste the Payment Link URL into the website

Open [`../service-charity.html`](../service-charity.html), find:

```html
<a href="REPLACE_WITH_STRIPE_PAYMENT_LINK_URL" id="dd-cta-link" …>
```

and replace the placeholder with the URL from step 1. Re-upload via FileZilla.

## 3. Apps Script — paste the code

1. Open your Google Sheet → **Extensions → Apps Script**.
2. Replace `Code.gs` with the contents of [`direct-debit.gs`](direct-debit.gs).
3. Save.

## 4. Apps Script — set Script Properties

**⚙ Project Settings → Script Properties → + Add property** (twice):

| Name                | Value                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY` | `sk_test_…` (or `sk_live_…` when going live)                                            |
| `WEBHOOK_TOKEN`     | a long random string of your choice, e.g. from <https://generate-secret.vercel.app/32>  |

The webhook token is the bouncer for the endpoint — Stripe will include it in
the URL when calling the webhook. Without it, anyone with the Web App URL could
spoof events into your sheet.

## 5. Deploy as Web App

- **Deploy → New deployment → ⚙ → Web app**.
- Execute as: **Me**. Who has access: **Anyone**.
- Click **Deploy**, authorise the requested scopes.
- Copy the `https://script.google.com/macros/s/…/exec` URL.

## 6. Register the webhook in Stripe

Stripe Dashboard → **Developers → Webhooks → + Add endpoint**:

- **Endpoint URL**: paste your Apps Script `/exec` URL with `?token=<WEBHOOK_TOKEN>` appended, e.g.
  `https://script.google.com/macros/s/AKfy…/exec?token=YOUR_TOKEN`
- **Events to send**: just one — `checkout.session.completed`.
- **Add endpoint**.

(Stripe also offers signature verification via the `Stripe-Signature` header,
but Apps Script `doPost(e)` can't read arbitrary request headers, so we rely on
the URL token instead.)

## 7. Test in Stripe test mode

1. Make sure the Payment Link, webhook, and `STRIPE_SECRET_KEY` are all in
   **test mode**.
2. Visit `service-charity.html`, click **Set Up Direct Debit**.
3. On the Stripe page:
   - Quantity: `20` (= £20/month).
   - Custom fields: pick a day, pick a purpose.
   - Use the BACS test creds: sort `10-88-00`, account `00012345`, any name.
4. Submit. You should land back at `?dd=success`.
5. Verify:
   - Stripe Dashboard → Subscriptions: a `Monthly Donation × 20 = £20.00`
     subscription exists with `trial_end` set to your chosen day.
   - Google Sheet: a new row was appended with full donor details.
   - Email at info@: notification arrived.

## 8. Go live

1. Re-create the Payment Link in **live** mode (or switch the existing one).
2. Update `STRIPE_SECRET_KEY` in Apps Script to your `sk_live_…` key.
3. Register the webhook again in **live** mode (separate from test mode in
   Stripe).
4. Update the Payment Link URL in `service-charity.html` to the live URL and
   re-upload.

## Re-deploying after Apps Script code changes

**Deploy → Manage deployments → ✏ → Version: New version → Deploy.** The URL
stays the same — no need to update Stripe webhook config or the website.

## What this setup does NOT do

- It doesn't process refunds or cancellations — handle those in Stripe Dashboard.
- It doesn't resend the webhook to backfill — if the webhook fails and you
  miss a signup, Stripe will retry for 3 days. After that, you can manually
  resend from Stripe Dashboard → Webhooks → Events.
- It doesn't validate that `trial_end` is in the future (Stripe will reject
  past dates) — but `computeFirstCollectionDate_` always returns a date
  ≥ 5 days from now, so this should never fire.
