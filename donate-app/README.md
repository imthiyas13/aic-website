# AIC Donate — phone version

The donation screen from the masjid kiosk, running on the admin team's own
phones so donations can be taken anywhere — at the door, at events, on
collection rounds.

**Live URL:** <https://aldershotislamiccentre.org.uk/donate-app/>

## Deploying

The site is **not** deployed from this repo automatically — the host is plain
nginx and the files are uploaded by hand (FileZilla/FTP). Pushing to `main`
changes nothing on the live site.

To publish or update the phone app, upload to the web root, keeping the folder
structure:

| Upload | To | Why |
| --- | --- | --- |
| `donate-app/` (whole folder) | web root, next to `index.html` | the app itself |
| `service-worker.js` | web root | excludes `/donate-app/` from caching — without it, phones can run a stale copy |

Volunteers' phones load the page fresh each time, so a re-upload reaches
everyone without them doing anything.

---

## How it works

The page itself never touches card details. Tapping an amount hands off to the
**SumUp app** via a deeplink, SumUp takes the payment, and then it sends the
phone back here with the result. This page shows the thank-you message and the
Gift Aid QR code.

That means each phone needs the SumUp app installed and signed in — the web
page on its own cannot take money.

---

## Setting up a volunteer's phone

1. **Install SumUp** from the App Store / Play Store and sign in to the AIC
   merchant account.
2. **Pair a card reader** (Air or Solo) over Bluetooth, or enable Tap to Pay if
   that phone supports it. A reader can only be paired to one phone at a time,
   so a phone and a reader travel together.
3. **Open the donation page.** Send the volunteer their own link with their
   name in it, which sets them up in one tap:

   ```text
   https://aldershotislamiccentre.org.uk/donate-app/?collector=Yusuf
   ```

   Without the `?collector=` part the page just asks for their name on first
   run instead.
4. **Add to Home Screen** so it's one tap to open:
   - **Android (Chrome):** ⋮ menu → *Add to Home screen*
   - **iPhone (Safari):** Share → *Add to Home Screen*

### Why the name matters

Whatever name is set gets attached to every SumUp transaction that phone takes
(as the transaction title, e.g. `AIC Donation — Yusuf`, and on the internal
reference). That's what lets the takings be reconciled per person afterwards in
the SumUp dashboard. Tap the name badge in the top-right of the screen to
change it.

---

## Taking a donation

1. Tap an amount, or *Other amount* for anything else.
2. SumUp opens — take the payment as normal.
3. The phone comes back here and shows *JazakAllah Khair* plus a **Gift Aid QR
   code**. Hold the screen up for the donor to scan with their own phone; it
   opens the Gift Aid form pre-filled with their donation amount.
4. Tap the message to clear it and take the next donation.

If the card is declined or the donor backs out, the screen says so and returns
to the amounts — nothing else to do.

---

## Kiosk mode

The same page can run the wall-mounted tablet. Open it once with:

```text
https://aldershotislamiccentre.org.uk/donate-app/?mode=kiosk
```

The setting sticks on that device. Kiosk mode restores the large tablet
layout, forces fullscreen, and blocks long-press and double-tap. `?mode=handheld`
switches back.

The tablet currently runs its own local copy from `../../DonationApp/`. That copy
still works and has not been changed except for one bug fix; move it over to this
hosted version whenever convenient, rather than maintaining both.

Note that `DonationApp/` is not in any git repo, so fixes made there have to be
copied to the tablet by hand as well.

---

## Notes and things to watch

- **iPhone needs a real-world test before the team relies on it.** SumUp's iOS
  deeplink takes different parameters from Android (`amount` rather than
  `total`, and separate success/failure return URLs). Both are implemented and
  the return handling is tested, but the hand-off into the SumUp iOS app itself
  could not be tested here. Do one £1 donation on an iPhone and refund it.
- **iOS stays in Safari on purpose.** `apple-mobile-web-app-capable` is
  deliberately not set: in standalone mode iOS returns the SumUp result into
  Safari instead of the installed app, so the thank-you screen would appear
  somewhere the volunteer isn't looking.
- **The affiliate key in `data/key.txt` is public.** It only identifies the
  integration; money always goes to whichever SumUp account is signed in on the
  device, so an outsider cannot use it to collect on our behalf. The page is
  `noindex` and unlinked, but treat the URL as guessable.
- **The site service worker deliberately skips `/donate-app/`** (see
  `../service-worker.js`) so a volunteer's phone can never run a cached copy
  with stale amounts or an old key.
- **Amounts and copy** live in `data/config.json`, same as the kiosk.
