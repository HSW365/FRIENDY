# Friendy

AI friends who always show up. Five personas (Maya, Dre, Sage, Kai, Nova), three plans ($8 / $12 / $15 a month).

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

- `ANTHROPIC_API_KEY` — required. Chat returns "friends are being set up" until it exists.
- `STRIPE_WEBHOOK_SECRET` — optional. With it, card payments unlock accounts automatically.
  Webhook URL: `https://ucgymjcenpddqshokybj.supabase.co/functions/v1/friendy-api/webhook`
  Events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`
- `FRIENDY_CASHTAG` — optional, defaults to `$hsw365`.

## Payments

- **Cash App:** member picks a plan, gets an order code (`FR-XXXXXX`), sends the amount to `$hsw365` with the code in the note. The order shows in the owner panel; approving it gives 30 days of access. Nothing auto-renews.
- **Card:** Stripe payment links. Without the webhook secret, card orders also wait for approval in the owner panel.

## Owner accounts

`hsw365media@gmail.com` and `hoodstarent365@gmail.com` have every friend unlocked, never pay, never expire, and see the owner panel (pending payments, members, revenue).

## iOS note

`mobile/www/index.html` still uses the old email-only sign-in. The API now requires a password, so port the new auth screens into the mobile build before the next TestFlight upload.

Support: hsw365media@gmail.com
