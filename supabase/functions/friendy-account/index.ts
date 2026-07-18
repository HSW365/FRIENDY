// friendy-account
//
// A SECOND, standalone edge function (deliberately separate from the
// existing `friendy-api` function so nothing about your working web/Stripe
// flow gets touched). Handles the three things the iOS app needs that
// friendy-api doesn't have yet:
//
//   POST   /friendy-account/activate-iap   → create/link account after a
//                                             RevenueCat/StoreKit purchase,
//                                             returns the same
//                                             { token, user } shape as
//                                             friendy-api's /auth/login
//   DELETE /friendy-account/delete         → permanently delete the
//                                             signed-in user's account
//                                             (Apple Guideline 5.1.1(v))
//   POST   /friendy-account/revenuecat-webhook → RevenueCat server webhook,
//                                             keeps plan/plan_status in
//                                             sync on renewals & cancels
//
// ── DEPLOY ───────────────────────────────────────────────────────────
//   supabase functions deploy friendy-account --project-ref ucgymjcenpddqshokybj --no-verify-jwt
//   supabase secrets set JWT_SECRET=<same value friendy-api uses> --project-ref ucgymjcenpddqshokybj
//   supabase secrets set REVENUECAT_WEBHOOK_AUTH=<a random string you also paste into
//     RevenueCat → Project Settings → Integrations → Webhooks → Authorization header> --project-ref ucgymjcenpddqshokybj
//
// ⚠️ JWT_SECRET MUST be the exact same value friendy-api already uses to
// sign tokens, or tokens minted here won't pass friendy-api's /auth/me.
//
// ⚠️ Column names assume the migration in
// supabase/migrations/20260718120000_friendy_account_iap.sql. If your real
// `users` table differs, adjust the SQL below to match.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { create, verify, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('JWT_SECRET') ?? '';
const REVENUECAT_WEBHOOK_AUTH = Deno.env.get('REVENUECAT_WEBHOOK_AUTH') ?? '';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}

async function getKey() {
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signToken(payload: Record<string, unknown>) {
  const key = await getKey();
  return await create(
    { alg: 'HS256', typ: 'JWT' },
    { ...payload, exp: getNumericDate(60 * 60 * 24 * 30) }, // 30 days
    key
  );
}

async function verifyToken(token: string) {
  const key = await getKey();
  return await verify(token, key);
}

const ENTITLEMENT_RANK: Record<string, number> = { basic: 1, plus: 2, premium: 3 };

function highestPlan(plans: string[]): string {
  return plans.sort((a, b) => (ENTITLEMENT_RANK[b] ?? 0) - (ENTITLEMENT_RANK[a] ?? 0))[0] ?? 'none';
}

async function upsertUserPlan(email: string, plan: string, appUserId?: string) {
  const normalizedEmail = email.toLowerCase().trim();
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('email', normalizedEmail)
    .maybeSingle();

  const row = {
    email: normalizedEmail,
    plan,
    plan_status: 'active',
    revenuecat_app_user_id: appUserId ?? existing?.revenuecat_app_user_id ?? normalizedEmail,
    updated_at: new Date().toISOString()
  };

  if (existing) {
    await supabase.from('users').update(row).eq('email', normalizedEmail);
    return { ...existing, ...row };
  } else {
    const { data: created } = await supabase.from('users').insert(row).select().single();
    return created;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  // Supabase invokes this as /friendy-account/<path>
  const path = url.pathname.replace(/^\/friendy-account\/?/, '');

  try {
    // ── POST /activate-iap ──────────────────────────────────────────
    if (path === 'activate-iap' && req.method === 'POST') {
      const { email, plan, appUserId } = await req.json();
      if (!email || !plan) return json({ error: 'email and plan are required' }, 400);
      if (!ENTITLEMENT_RANK[plan]) return json({ error: `Unknown plan "${plan}"` }, 400);

      const user = await upsertUserPlan(email, plan, appUserId);
      const token = await signToken({ userId: user.id, email: user.email, plan: user.plan });

      return json({
        token,
        user: { email: user.email, plan: user.plan, planStatus: 'active' }
      });
    }

    // ── DELETE /delete ───────────────────────────────────────────────
    if (path === 'delete' && req.method === 'DELETE') {
      const authHeader = req.headers.get('Authorization') || '';
      const token = authHeader.replace('Bearer ', '');
      if (!token) return json({ error: 'Missing token' }, 401);

      let payload;
      try {
        payload = await verifyToken(token);
      } catch {
        return json({ error: 'Invalid or expired token' }, 401);
      }

      const email = (payload as Record<string, unknown>).email as string | undefined;
      if (!email) return json({ error: 'Token missing email' }, 400);

      await supabase.from('users').delete().eq('email', email.toLowerCase());
      // If you store chat history in a separate table, delete it here too, e.g.:
      // await supabase.from('messages').delete().eq('email', email.toLowerCase());

      return json({ deleted: true });
    }

    // ── POST /revenuecat-webhook ─────────────────────────────────────
    // Configure this URL in RevenueCat → Project Settings → Integrations →
    // Webhooks, with the same secret as Authorization header value.
    if (path === 'revenuecat-webhook' && req.method === 'POST') {
      if (REVENUECAT_WEBHOOK_AUTH) {
        const auth = req.headers.get('Authorization') || '';
        if (auth !== REVENUECAT_WEBHOOK_AUTH) return json({ error: 'Unauthorized' }, 401);
      }

      const body = await req.json();
      const event = body?.event;
      if (!event) return json({ received: true });

      const appUserId: string | undefined = event.app_user_id;
      const entitlements: string[] = event.entitlement_ids ?? [];
      const type: string = event.type; // INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, ...

      if (appUserId) {
        const emailGuess = appUserId.includes('@') ? appUserId : null;
        if (emailGuess) {
          if (['CANCELLATION', 'EXPIRATION'].includes(type)) {
            await supabase.from('users').update({
              plan_status: 'inactive',
              updated_at: new Date().toISOString()
            }).eq('email', emailGuess.toLowerCase());
          } else if (entitlements.length) {
            await upsertUserPlan(emailGuess, highestPlan(entitlements), appUserId);
          }
        }
      }

      return json({ received: true });
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    console.error('friendy-account error:', err);
    return json({ error: 'Server error' }, 500);
  }
});
