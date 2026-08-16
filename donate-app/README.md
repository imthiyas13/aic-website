# AIC Donate — phone version

Shows a donor their **Gift Aid QR code** after a volunteer has taken a card
payment. Built for admin phones on collection rounds, at the door, or at events.

**Live URL:** <https://aldershotislamiccentre.org.uk/donate-app/>

## Why it works this way

The volunteer takes the payment in the **SumUp app** using Tap to Pay, then
taps the matching amount here to show the donor a Gift Aid QR for that exact
figure.

Two constraints forced this shape:

1. **SumUp's deeplink cannot start a Tap to Pay payment.** Tap to Pay is only
   available through SumUp's native iOS/Android SDKs, not the URL scheme a web
   page can use (see
   [ios#19](https://github.com/sumup/sumup-ios-url-scheme/issues/19),
   [android#38](https://github.com/sumup/sumup-android-url-scheme/issues/38)).
   Driving the payment from this page would mean carrying a card reader.
2. **Volunteers must not have the main SumUp login.** The SumUp Business app
   exposes the charity's balance, account and card details, and Send money.
   Each volunteer gets a restricted **employee account** instead (free, up to
   10, created at sumup.me → Employees): they can take payments and see their
   own sales history, but cannot log into sumup.me, change account settings,
   or view or move funds.

Gift Aid is the one thing the SumUp app doesn't capture, and it is worth 25%
on top — which is the entire reason this page exists.

## Deploying

The site is **not** deployed from this repo automatically — the host is plain
nginx and files are uploaded by hand (FileZilla/FTP). Pushing to `main`
publishes nothing.

| Upload | To | Why |
| --- | --- | --- |
| `donate-app/` (whole folder) | web root, next to `index.html` | the app |
| `service-worker.js` | web root | excludes `/donate-app/` from caching — without it phones can run a stale copy |

## Setting up a volunteer's phone

1. Create them a SumUp **employee account** at <https://me.sumup.com/> →
   Employees → Add new employee.
2. On their phone: install the **SumUp** app, sign in with *those* credentials
   (never the main login), and enable Tap to Pay.
3. Open <https://aldershotislamiccentre.org.uk/donate-app/> and Add to Home
   Screen.

## Taking a donation

1. **SumUp app:** enter the amount, take the tap payment.
2. **This app:** tap the matching amount (or *Other amount*).
3. The Gift Aid QR appears — hold the screen up for the donor to scan. It opens
   the form pre-filled with that amount.
4. Tap the message to clear it, ready for the next donor.

This page has no way to confirm the payment actually succeeded — it shows
whatever amount the volunteer taps. It is a Gift Aid prompt, not a receipt.

## Modes

Both stick per device once set, and both are set by URL:

| URL | Effect |
| --- | --- |
| `?flow=giftaid` | no payment hand-off; tapping an amount shows the Gift Aid QR. **Default on phones.** |
| `?flow=sumup` | hands off to the SumUp app to take the payment. Needs a paired card reader **and** `data/key.txt` restored (removed — see below). Default in kiosk mode. |
| `?mode=kiosk` | large tablet layout, forced fullscreen, long-press/double-tap blocked |
| `?mode=handheld` | phone layout. Default. |
| `?collector=Name` | pre-sets the volunteer name (only used by `flow=sumup`) |

## Notes

- **`data/key.txt` has been removed from this folder.** The SumUp affiliate key
  is only needed by `flow=sumup`, which is not in use, so there is no reason to
  publish it. Restore it from `../../DonationApp/data/key.txt` if you ever
  switch this build back to taking payments itself.
- **The wall tablet is separate.** It runs the older kiosk build at `/donate/`,
  sourced from `../../DonationApp/` (not in any git repo, uploaded by FTP).
  `/donate-app/?mode=kiosk` could replace it — but change the tablet's start URL
  **before** uploading, or it will come up in phone mode.
- **The iPhone hand-off for `flow=sumup` has never been tested live.** Both
  platforms are implemented and the return handling is verified, but no one has
  run a real payment from an iPhone. Irrelevant while `flow=giftaid` is in use.
- **Amounts and copy** live in `data/config.json`.
