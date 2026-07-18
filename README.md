# FRIENDY
need someone to just listen and be a friend. Then friendy is here for you.

## iOS App Store build
The live app talks to the Supabase Edge Function `friendy-api`
(`https://ucgymjcenpddqshokybj.supabase.co/functions/v1/friendy-api`), **not**
`server.js` at the repo root — that Express server is an earlier, currently
non-functional draft (missing `models/User.js` / `middleware/auth.js`) and
isn't deployed anywhere. Leaving it as-is; don't wire anything new to it.

For the iOS app: see `mobile/` (Capacitor shell) and
`APPLE_SUBMISSION_CHECKLIST.md` for the full path to TestFlight/App Store
submission via Codemagic.

