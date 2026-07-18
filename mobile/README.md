# Friendy iOS (Capacitor)

Native iOS wrapper around the Friendy web app, built for App Store review.
No Mac needed locally — Codemagic's macOS build agents do everything
(`cap add ios`, CocoaPods, signing, archive, TestFlight upload). See
`../codemagic.yaml` and `../APPLE_SUBMISSION_CHECKLIST.md`.

## Local dev (optional, Windows-friendly up to a point)
```bash
cd mobile
npm install
npm run build        # bundles native-bridge.js -> www/native-bridge.bundle.js
```
You can't run `cap add ios` / open Xcode on Windows — that step only
happens inside the Codemagic pipeline. To iterate on the web UI itself,
just open `mobile/www/index.html` in a browser (native purchase buttons
won't do anything outside the app — `FriendyNative.isNative()` is false).

## Folder map
- `src/native-bridge.js` — RevenueCat + Capacitor glue, bundled by esbuild.
- `www/index.html` — the app UI (based on the repo's root `index.html`,
  with native IAP + account deletion wired in).
- `scripts/build.js` — esbuild bundler (`npm run build`).
- `scripts/postcap.sh` — runs on Codemagic after `cap add ios`; writes
  `PrivacyInfo.xcprivacy` and sets export-compliance Info.plist keys.
- `capacitor.config.ts` — app ID `com.hsw365.friendy`.

The `ios/` platform folder is **not committed** — Codemagic generates it
fresh every build via `npx cap add ios`, which keeps this repo small and
avoids stale-Xcode-project drift.
