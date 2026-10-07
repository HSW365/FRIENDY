# Friendy

Someone to talk to, always there. Five friends (Maya, Dre, Sage, Kai, Nova), three plans ($8 / $12 / $15 a month, or $57.99 / $86.99 / $107.99 a year), and a 3-day free trial of Plus.

**Live web app:** https://hsw365.github.io/FRIENDY/ (GitHub Pages, served from `index.html` on `main`)

## How it's put together

| Piece | Where |
| --- | --- |
| Web app (landing, signup, checkout, chat, account, owner panel) | `index.html` |
| Backend API | `supabase/functions/friendy-api/index.ts` → Supabase project `ucgymjcenpddqshokybj` |
| Database schema | `supabase/migrations/` (`users`, `chat_messages`, `friendy_orders`, `friendy_config`) |
| iOS shell (Capacitor) | `mobile/`, see `APPLE_SUBMISSION_CHECKLIST.md` |

`server.js` at the repo root is an old Express draft. It is not deployed and nothing uses it.

## Secrets

Set in Supabase → project `friendy` → Edge Functions → Secrets:

- `GEMINI_API_KEY` — chat runs on Google Gemini when this is set (the current setup).
- `ANTHROPIC_API_KEY` — used when `GEMINI_API_KEY` is not set. One of the two is required, or chat returns "friends are being set up".
- `STRIPE_WEBHOOK_SECRET` — optional. With it, card payments unlock accounts automatically.
  Webhook URL: `https://ucgymjcenpddqshokybj.supabase.co/functions/v1/friendy-api/webhook`
  Events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`
- `FRIENDY_CASHTAG` — optional, defaults to `$hsw365`.

## Payments

- **Cash App:** member picks a plan, gets an order code (`FR-XXXXXX`), sends the amount to `$hsw365` with the code in the note. The order shows in the owner panel; approving it gives 30 days of access. Nothing auto-renews.
- **Card:** Stripe payment links. Without the webhook secret, card orders also wait for approval in the owner panel.

## Free trial and yearly plans

- **Trial:** a new account can start 3 free days of Plus once, with no payment details. `users.trial_used_at` records it, `payment_method` is `trial` while it runs, and trial accounts are capped at 80 messages a day. The owner panel counts them as "On free trial", not as paying members.
- **Yearly:** Cash App only for now. The order carries `billing = annual` and approving it gives 365 days. Yearly by card needs three yearly Stripe payment links added to `STRIPE_LINKS`.
- The landing page leads with "friend", not "AI friends". The plain statement that the friends are AI stays in the FAQ, the sign-up checkbox, the chat footer and the Terms. Keep it there.

## Owner accounts

`hsw365media@gmail.com` and `hoodstarent365@gmail.com` have every friend unlocked, never pay, never expire, and see the owner panel (pending payments, members, revenue).

## iOS note

`mobile/www/index.html` still uses the old email-only sign-in. The API now requires a password, so port the new auth screens into the mobile build before the next TestFlight upload.

Support: hsw365media@gmail.com
