# Friendy — Path to App Store Approval

What I built into this repo, then everything that's left — all steps I
can't do for you (they need your Apple/RevenueCat/Codemagic logins).

## What's in the repo now

- `mobile/` — Capacitor iOS shell around the existing Friendy web app
  (`mobile/www/index.html`), with a native bridge (`mobile/src/native-bridge.js`)
  that swaps Stripe checkout for RevenueCat/StoreKit purchases **only when
  running as the native iOS app** — the web version at hsw365.github.io
  keeps working with Stripe exactly as before.
- Account deletion button (nav, when signed in) — required by
  **Apple Guideline 5.1.1(v)**.
- Restore Purchases button (native only).
- `mobile/scripts/postcap.sh` — auto-generates `PrivacyInfo.xcprivacy` and
  sets `ITSAppUsesNonExemptEncryption=false` on every build (Apple has
  required a privacy manifest since May 2024 — missing one is an automatic
  rejection).
- `codemagic.yaml` — full pipeline: installs deps → adds the iOS platform →
  injects the privacy manifest → CocoaPods → auto code-signs via your App
  Store Connect API key → builds → uploads to TestFlight.
- `supabase/functions/friendy-account/index.ts` — a **new, separate** Edge
  Function (doesn't touch your working `friendy-api`) that activates
  accounts after a RevenueCat purchase, deletes accounts, and receives
  RevenueCat's webhook.
- `supabase/migrations/20260718120000_friendy_account_iap.sql` — adds the
  one column (`revenuecat_app_user_id`) the new function needs; safe to run
  even if `users` already exists.

## What only you can do (in order)

### 1. App Store Connect (5 min)
- Create the app record: Bundle ID `com.hsw365.friendy`, name "Friendy".
- Add an **App Privacy** ("nutrition label") entry — matches the data types
  declared in `PrivacyInfo.xcprivacy`: email address, user ID, customer
  support data, none of it used for tracking.
- Age rating questionnaire (this is a chat/companion app — expect 12+ or 17+
  depending on how you answer the "mature/suggestive" questions; answer
  honestly since Maya/Dre/Sage/Kai/Nova give emotional-support advice, not
  clinical/medical advice — do **not** market it as therapy).
- Create 3 **auto-renewable subscription** products under one Subscription
  Group ("Friendy Plans"):
  - `com.hsw365.friendy.basic.monthly` — $6/mo (matches current Basic price — check your live price)
  - `com.hsw365.friendy.plus.monthly` — $12/mo
  - `com.hsw365.friendy.premium.monthly` — $15/mo
  - Fill in the required subscription display name + description for each
    (App Store rejects submissions with incomplete subscription metadata).
- App icon (1024×1024, no transparency) + at least one 6.7" iPhone
  screenshot set — I can generate these with Canva if you want, just say so.
- Support URL + Marketing URL (`https://hsw365.github.io/FRIENDY/` works for
  both) and a **privacy policy URL** (required — must describe data
  collection, and that this is not a substitute for professional mental
  health care).

### 2. RevenueCat dashboard (10 min)
- Create/open your RevenueCat project, add the iOS app with bundle ID
  `com.hsw365.friendy`.
- Copy the **Apple public API key** into
  `mobile/src/native-bridge.js` → `REVENUECAT_PUBLIC_API_KEY` (replace the
  placeholder), then push — Codemagic rebuilds it into the bundle
  automatically.
- Import the 3 App Store Connect products, create matching **Entitlements**
  named exactly `basic`, `plus`, `premium`, and 3 **Offerings** named
  `basic`, `plus`, `premium`, each with one Monthly package tied to the
  matching product.
- Integrations → Webhooks → add:
  `https://ucgymjcenpddqshokybj.supabase.co/functions/v1/friendy-account/revenuecat-webhook`
  with an Authorization header value — save that same string as the
  `REVENUECAT_WEBHOOK_AUTH` Supabase secret (command below).

### 3. Deploy the new Supabase pieces (2 min, needs Supabase CLI)
```bash
supabase link --project-ref ucgymjcenpddqshokybj
supabase db push                      # runs the migration
supabase secrets set JWT_SECRET=<same value friendy-api already uses>
supabase secrets set REVENUECAT_WEBHOOK_AUTH=<the string you put in RevenueCat's webhook header>
supabase functions deploy friendy-account --no-verify-jwt
```
⚠️ Before running `db push`, run `select * from users limit 1;` in the
Supabase SQL editor — if your real table's columns don't match
`supabase/migrations/20260718120000_friendy_account_iap.sql`, tell me and
I'll adjust the migration + function to match instead of guessing.

### 4. Codemagic (5 min)
- Team → Integrations → App Store Connect → add your API key
  (issuer `d2aeeca9-68b4-480e-96e0-edced6996d56`, key ID `AC7T7RNVVR` — same
  one SpeekZone already uses), name the integration exactly
  `friendy_ios_asc_key` (matches `codemagic.yaml`).
- Confirm/create the `friendy_ios` environment variable group — it doesn't
  need any secret vars for this workflow (signing comes from the
  integration), but keep it there since `codemagic.yaml` references it.
- Add app `HSW365/FRIENDY` in Codemagic if not already there.
- Start the **"Friendy — iOS TestFlight Release"** workflow manually. First
  run will take longer (CocoaPods cache cold). Check the build log if it
  fails on `app-store-connect fetch-signing-files` — that means the bundle
  ID `com.hsw365.friendy` doesn't exist in App Store Connect yet (do step 1
  first).

### 5. After TestFlight succeeds
- Test the real purchase flow on a TestFlight build with a **Sandbox Apple
  ID** (App Store Connect → Users and Access → Sandbox Testers) — verify
  the Restore Purchases button and Delete Account button both work.
- Run the **"Friendy — Submit for App Store Review"** workflow when ready
  to submit (it sets `submit_to_app_store: true`).

## Things Apple will likely flag if skipped
- **No external payment link visible/reachable from the app** — I removed
  the only path to Stripe on native, but double-check no other button in
  `mobile/www/index.html` still points at `buy.stripe.com`.
- **Subscription terms not disorderly** — Apple wants price, duration, and
  auto-renewal terms visible before purchase. The pricing modal already
  shows price + "per month"; consider adding one line about auto-renewal
  and where to cancel (Settings → Apple ID → Subscriptions) right above the
  Subscribe button in the new IAP modal.
- **Guideline 1.4.1 (mental health apps)** — since Friendy positions itself
  as emotional support, add a one-line disclaimer + crisis-resource link
  (e.g. 988 in the US) somewhere reachable in the app; reviewers check for
  this on companion/wellness apps.
