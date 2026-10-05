// friendy-api — the single backend for the Friendy web app.
//
// Deployed to Supabase project ucgymjcenpddqshokybj with verify_jwt = false
// (this function does its own auth: password accounts + signed session tokens).
//
// Secrets (Supabase dashboard → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY       required — without it chat returns 503
//   STRIPE_WEBHOOK_SECRET   optional — turns on automatic activation for card payments
//   FRIENDY_CASHTAG         optional — defaults to $hsw365
//
// The session-signing secret lives in the private table public.friendy_config
// (generated once by the migration), so no JWT secret needs to be set by hand.

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const CASHTAG = Deno.env.get("FRIENDY_CASHTAG") || "$hsw365";
const SUPPORT_EMAIL = "hsw365media@gmail.com";

const OWNER_EMAILS = ["hsw365media@gmail.com", "hoodstarent365@gmail.com"];

const PLANS: Record<string, { cents: number; rank: number; friends: string[]; label: string }> = {
  basic: { cents: 800, rank: 1, friends: ["Maya", "Dre"], label: "Basic" },
  plus: { cents: 1200, rank: 2, friends: ["Maya", "Dre", "Sage", "Kai"], label: "Plus" },
  premium: { cents: 1500, rank: 3, friends: ["Maya", "Dre", "Sage", "Kai", "Nova"], label: "Premium" },
};

const STRIPE_LINKS: Record<string, string> = {
  basic: "https://buy.stripe.com/fZu7sLb9tgZ0g2W9ZV3VC04",
  plus: "https://buy.stripe.com/fZu3cv4L5bEG4keb3Z3VC05",
  premium: "https://buy.stripe.com/eVq14n6Td2461823Bx3VC06",
};

const MODEL_STANDARD = Deno.env.get("FRIENDY_MODEL") || "claude-haiku-4-5-20251001";
const MODEL_PREMIUM = Deno.env.get("FRIENDY_MODEL_PREMIUM") || "claude-sonnet-4-6";

const PERIOD_DAYS = 30; // one payment = 30 days of access
const DAILY_MESSAGE_CAP = 400; // fair-use ceiling per account per 24h
const MAX_MESSAGE_CHARS = 2000;

// ── HTTP helpers ──────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
const fail = (status: number, error: string, code?: string) => json({ error, ...(code ? { code } : {}) }, status);

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : {};
  } catch {
    return {};
  }
}

// ── crypto ────────────────────────────────────────────────────────
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function sha256Hex(s: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
}

const PBKDF2_ITERATIONS = 100_000;
async function hashPassword(password: string, saltB64?: string) {
  const salt = saltB64 ? unb64url(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return { hash: b64url(new Uint8Array(bits)), salt: b64url(salt) };
}

let signingKey: CryptoKey | null = null;
async function getSigningKey(): Promise<CryptoKey> {
  if (signingKey) return signingKey;
  const { data, error } = await db.from("friendy_config").select("value").eq("key", "jwt_secret").maybeSingle();
  if (error || !data?.value) throw new Error("Signing secret missing — run the friendy_web_app migration.");
  signingKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(data.value),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return signingKey;
}

async function signToken(userId: string): Promise<string> {
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify({
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  })));
  const sig = await crypto.subtle.sign("HMAC", await getSigningKey(), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

async function verifyToken(token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await getSigningKey(),
      unb64url(parts[2]) as BufferSource,
      enc.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(unb64url(parts[1])));
    if (!payload.sub || !payload.exp || payload.exp < Date.now() / 1000) return null;
    return String(payload.sub);
  } catch {
    return null;
  }
}

// ── users ─────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
type User = Record<string, any>;

function isOwner(u: User): boolean {
  return u.is_owner === true && OWNER_EMAILS.includes(String(u.email).toLowerCase());
}

/** The plan the account can actually use right now, or null. */
function activePlan(u: User): string | null {
  if (isOwner(u)) return "premium";
  if (u.plan_status !== "active" || !PLANS[u.plan]) return null;
  if (u.plan_expires_at && new Date(u.plan_expires_at).getTime() < Date.now()) return null;
  return u.plan;
}

async function publicUser(u: User) {
  const plan = activePlan(u);
  const expired = !plan && !!PLANS[u.plan] && !!u.plan_expires_at &&
    new Date(u.plan_expires_at).getTime() < Date.now();
  const { data: pending } = await db.from("friendy_orders")
    .select("id, plan, amount_cents, method, order_code, payer_handle, status, created_at")
    .eq("user_id", u.id).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return {
    id: u.id,
    email: u.email,
    name: u.display_name || null,
    plan,
    planStatus: plan ? "active" : expired ? "expired" : "inactive",
    lastPlan: PLANS[u.plan] ? u.plan : null,
    planExpiresAt: isOwner(u) ? null : u.plan_expires_at,
    paymentMethod: u.payment_method || null,
    isOwner: isOwner(u),
    friends: plan ? PLANS[plan].friends : [],
    pendingOrder: pending ? orderView(pending) : null,
  };
}

async function authenticate(req: Request): Promise<User | null> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const userId = await verifyToken(auth.slice(7));
  if (!userId) return null;
  const { data } = await db.from("users").select("*").eq("id", userId).maybeSingle();
  return data || null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
function cleanEmail(v: unknown): string | null {
  const e = String(v ?? "").trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

// ── orders ────────────────────────────────────────────────────────
function newOrderCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "FR-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

// deno-lint-ignore no-explicit-any
function orderView(o: any) {
  const dollars = (o.amount_cents / 100).toFixed(o.amount_cents % 100 ? 2 : 0);
  return {
    id: o.id,
    plan: o.plan,
    amount: o.amount_cents / 100,
    method: o.method,
    code: o.order_code,
    payerHandle: o.payer_handle || null,
    status: o.status,
    createdAt: o.created_at,
    cashapp: {
      cashtag: CASHTAG,
      note: o.order_code,
      url: `https://cash.app/${CASHTAG}/${dollars}`,
    },
  };
}

/** Turn on a plan for a user: extends from the current expiry when renewing the same tier. */
async function grantPlan(user: User, plan: string, method: string, days = PERIOD_DAYS, extra: User = {}) {
  const now = Date.now();
  const currentEnd = user.plan_expires_at ? new Date(user.plan_expires_at).getTime() : 0;
  const stillActive = user.plan_status === "active" && user.plan === plan && currentEnd > now;
  const base = stillActive ? currentEnd : now;
  const expires = new Date(base + days * 86400_000).toISOString();
  const { error } = await db.from("users").update({
    plan,
    plan_status: "active",
    plan_expires_at: expires,
    payment_method: method,
    plan_activated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...extra,
  }).eq("id", user.id);
  if (error) throw new Error(error.message);
  return expires;
}

// ── personas ──────────────────────────────────────────────────────
const SAFETY = `
ABOUT YOU AND THIS APP
- You are an AI companion on Friendy, not a human and not a therapist, doctor, or lawyer. Stay in character as a friend, but if the person sincerely asks whether you are a real person or an AI, tell them plainly that you are an AI.
- Never claim to have a body, a past, or a life offline, and never claim you can do things outside this chat (call someone, meet up, remember things you were not told).
- Do not diagnose, prescribe, or tell anyone to start, stop, or change medication. For medical, legal, or money decisions with real stakes, be supportive and point them to a qualified professional.
- Keep it non-romantic and non-sexual. You are a friend. Members are adults; if someone indicates they are under 18, be kind, keep it brief, and tell them Friendy is for adults and to talk to a trusted adult.

WHEN SOMEONE MAY BE IN DANGER — this overrides every style rule above
If the person mentions suicide, wanting to die, self-harm, harming someone else, abuse, or being unsafe: stop reframing and stop the hype. Do not put a positive spin on it and do not move on. Take it seriously, tell them you are glad they said it, and ask directly and gently whether they are safe right now. Encourage them to reach a person who can help: in the US, call or text 988 (Suicide and Crisis Lifeline) any time, or 911 if they are in immediate danger; outside the US, their local emergency number or crisis line. Encourage reaching out to someone they trust. Stay with them in the conversation. Never give information about methods of self-harm.

HONESTY
Encouragement must be true. Do not tell someone a plan that could hurt them or others is a good idea. A real friend says the hard thing kindly.

FORMAT
Plain conversational text only. No markdown, no bullet lists, no headings, no emojis.`;

const PERSONAS: Record<string, string> = {
  Maya: `You are Maya, a warm, genuine, ride-or-die friend on the Friendy app. You talk like a real friend texting: casual, caring, present.
HOW YOU SHOW UP
1. Listen first. Reflect back what you heard before you offer anything, so they feel understood.
2. Then help them find the positive that is actually there: what they did right, what this could be teaching them, what is still in their control.
3. Use CBT-style reframing and strength-based thinking naturally, as conversation, never as a lecture.
4. End with something empowering, a fresh angle, or one small concrete next step.
5. Keep it to 2-4 sentences. Warm, never fake.`,

  Dre: `You are Dre, a loyal, no-BS friend on the Friendy app. You keep it real because you care.
HOW YOU SHOW UP
1. Hear them out, then be direct. Call out self-defeating thinking plainly: "Nah, that's fear talking. Here's what I actually see."
2. Direct but never cold or mocking. Honesty is how you show loyalty.
3. Casual, natural language. Never forced slang.
4. Short and punchy, 2-3 sentences. End with a challenge or a push forward they can act on today.`,

  Sage: `You are Sage, a calm, deeply thoughtful friend on the Friendy app. You help people see what they have been missing.
HOW YOU SHOW UP
1. Slow things down. Acknowledge what is hard before anything else.
2. Help them find meaning and growth in the difficulty without minimizing it.
3. Weave in mindfulness, acceptance, and perspective gently.
4. Calm and unhurried, 2-4 sentences. Sometimes a single well-chosen question is the whole reply.
5. Leave them grounded, clearer, and hopeful.`,

  Kai: `You are Kai, the hype friend on the Friendy app. You make people feel capable.
HOW YOU SHOW UP
1. Match their moment first, then bring the energy. Hype that ignores what they said feels hollow.
2. Strength-based: point at what they DID, what they CAN do, and the proof they are giving you right now.
3. High energy but genuine, 2-3 sentences.
4. End with something that makes them want to take one step right now.`,

  Nova: `You are Nova, a brilliant friend with a deep understanding of psychology on the Friendy app.
HOW YOU SHOW UP
1. Listen closely and reflect the pattern underneath what they said.
2. Reframe using evidence-based ideas (CBT, ACT, positive psychology) delivered as real conversation.
3. Name thinking traps gently when you see them: "That sounds like all-or-nothing thinking. Let's look at the whole picture."
4. Offer one concrete tool as a suggestion, never an instruction.
5. Thoughtful, 3-5 sentences. End with a perspective that genuinely shifts how they see it.`,
};

function systemPrompt(friend: string, user: User): string {
  const who = user.display_name ? `\nThe person you are talking with goes by ${String(user.display_name).slice(0, 40)}.` : "";
  return `${PERSONAS[friend]}${who}\n${SAFETY}`;
}

type Msg = { role: "user" | "assistant"; content: string };

/** Anthropic requires alternating turns that start with the user. */
function normalizeTurns(rows: Msg[]): Msg[] {
  const out: Msg[] = [];
  for (const r of rows) {
    if (!r.content?.trim()) continue;
    if (out.length === 0 && r.role !== "user") continue;
    const last = out[out.length - 1];
    if (last && last.role === r.role) last.content += "\n\n" + r.content;
    else out.push({ role: r.role, content: r.content });
  }
  return out;
}

async function callClaude(model: string, system: string, messages: Msg[], maxTokens = 600): Promise<string> {
  const attempt = async (m: string) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: m, max_tokens: maxTokens, system, messages }),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  };
  let { res, data } = await attempt(model);
  // If a configured model id is unknown to the account, fall back to the standard one.
  if (res.status === 404 && model !== MODEL_STANDARD) ({ res, data } = await attempt(MODEL_STANDARD));
  if (!res.ok) {
    console.error("anthropic_error", res.status, JSON.stringify(data).slice(0, 500));
    throw new Error(`AI provider error (${res.status})`);
  }
  // deno-lint-ignore no-explicit-any
  const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  if (!text) throw new Error("Empty AI response");
  return text;
}

// ── Stripe webhook (signature verified by hand; no secret API key needed) ──
async function verifyStripeSignature(payload: string, header: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((p) => {
    const i = p.indexOf("=");
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }));
  const t = parts["t"];
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`))));
  return header.split(",").some((p) => p.trim().startsWith("v1=") && safeEqual(p.trim().slice(3), expected));
}

function planFromAmount(cents: number | null | undefined): string | null {
  for (const [k, v] of Object.entries(PLANS)) if (v.cents === cents) return k;
  return null;
}

async function handleStripeWebhook(req: Request) {
  if (!STRIPE_WEBHOOK_SECRET) return fail(503, "Card webhook not configured");
  const payload = await req.text();
  const sig = req.headers.get("stripe-signature") || "";
  if (!(await verifyStripeSignature(payload, sig))) return fail(400, "Bad signature");
  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return fail(400, "Bad payload");
  }
  const obj = event?.data?.object || {};

  if (event.type === "checkout.session.completed" && obj.payment_status === "paid") {
    const email = cleanEmail(obj.customer_details?.email || obj.customer_email);
    // deno-lint-ignore no-explicit-any
    let order: any = null;
    if (obj.client_reference_id) {
      const { data } = await db.from("friendy_orders").select("*").eq("id", obj.client_reference_id).maybeSingle();
      order = data;
    }
    const plan = planFromAmount(obj.amount_subtotal) || planFromAmount(obj.amount_total) || order?.plan || "basic";

    let user: User | null = null;
    if (order?.user_id) {
      const { data } = await db.from("users").select("*").eq("id", order.user_id).maybeSingle();
      user = data;
    }
    if (!user && email) {
      const { data } = await db.from("users").select("*").eq("email", email).maybeSingle();
      user = data;
    }

    if (user) {
      await grantPlan(user, plan, "card", PERIOD_DAYS + 3, {
        stripe_customer_id: obj.customer || user.stripe_customer_id,
        stripe_subscription_id: obj.subscription || user.stripe_subscription_id,
      });
    }
    if (order) {
      await db.from("friendy_orders").update({
        status: user ? "approved" : "paid_unclaimed",
        plan,
        stripe_session_id: obj.id,
        reviewed_at: new Date().toISOString(),
        reviewed_by: "stripe",
      }).eq("id", order.id);
    } else if (email) {
      // Paid through the raw link without an account yet: hold it for that email.
      await db.from("friendy_orders").upsert({
        user_id: user?.id ?? null,
        email,
        plan,
        amount_cents: obj.amount_total ?? PLANS[plan].cents,
        method: "card",
        order_code: newOrderCode(),
        status: user ? "approved" : "paid_unclaimed",
        stripe_session_id: obj.id,
        note: JSON.stringify({ customer: obj.customer, subscription: obj.subscription }),
        reviewed_at: new Date().toISOString(),
        reviewed_by: "stripe",
      }, { onConflict: "stripe_session_id" });
    }
  }

  if (event.type === "invoice.paid" && obj.customer && obj.billing_reason !== "subscription_create") {
    const { data: user } = await db.from("users").select("*").eq("stripe_customer_id", obj.customer).maybeSingle();
    if (user && PLANS[user.plan]) await grantPlan(user, user.plan, "card", PERIOD_DAYS + 3);
  }

  if (event.type === "invoice.payment_failed" && obj.customer) {
    await db.from("users").update({ plan_status: "past_due", updated_at: new Date().toISOString() })
      .eq("stripe_customer_id", obj.customer).eq("payment_method", "card");
  }

  if (event.type === "customer.subscription.deleted") {
    await db.from("users").update({ plan_status: "inactive", updated_at: new Date().toISOString() })
      .eq("stripe_subscription_id", obj.id).eq("payment_method", "card");
  }

  return json({ received: true });
}

// ── router ────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/friendy-api/, "").replace(/\/+$/, "") || "/";
  const method = req.method;

  try {
    if (path === "/health") {
      return json({
        status: "ok",
        app: "Friendy",
        version: 2,
        anthropic_configured: !!ANTHROPIC_KEY,
        stripe_configured: !!STRIPE_WEBHOOK_SECRET,
      });
    }

    if (path === "/config" && method === "GET") {
      return json({
        cashtag: CASHTAG,
        supportEmail: SUPPORT_EMAIL,
        chatReady: !!ANTHROPIC_KEY,
        cardAutoActivation: !!STRIPE_WEBHOOK_SECRET,
        plans: Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, {
          price: v.cents / 100,
          friends: v.friends,
          label: v.label,
        }])),
      });
    }

    if (path === "/webhook" && method === "POST") return await handleStripeWebhook(req);

    // ── signup ──
    if (path === "/auth/signup" && method === "POST") {
      const b = await readBody(req);
      const email = cleanEmail(b.email);
      const password = String(b.password ?? "");
      const name = String(b.name ?? "").trim().replace(/\s+/g, " ").slice(0, 40) || null;
      if (!email) return fail(400, "Enter a valid email address.");
      if (password.length < 8 || password.length > 200) return fail(400, "Password must be at least 8 characters.");
      if (b.adult !== true) return fail(400, "You must confirm you are 18 or older.");

      const { data: existing } = await db.from("users").select("*").eq("email", email).maybeSingle();
      const { hash, salt } = await hashPassword(password);

      let user: User;
      if (existing) {
        if (existing.password_hash) return fail(409, "An account with this email already exists. Sign in instead.", "EXISTS");
        // A row without a password is a reserved account (owner). It can only be claimed with its one-time setup code.
        if (!existing.setup_code_hash) return fail(409, "This account needs to be set up by support.", "RESERVED");
        const code = String(b.setupCode ?? "").trim();
        if (!code || !safeEqual(await sha256Hex(code), existing.setup_code_hash)) {
          return fail(403, "This email is reserved. Use your one-time setup link to claim it.", "SETUP_CODE_REQUIRED");
        }
        const { data, error } = await db.from("users").update({
          password_hash: hash,
          password_salt: salt,
          setup_code_hash: null,
          display_name: name || existing.display_name,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id).select("*").single();
        if (error) throw new Error(error.message);
        user = data;
      } else {
        const { data, error } = await db.from("users").insert({
          email,
          password_hash: hash,
          password_salt: salt,
          display_name: name,
          plan: "none",
          plan_status: "inactive",
        }).select("*").single();
        if (error) {
          if (error.code === "23505") return fail(409, "An account with this email already exists. Sign in instead.", "EXISTS");
          throw new Error(error.message);
        }
        user = data;

        // A card payment made with this email before the account existed.
        const { data: unclaimed } = await db.from("friendy_orders").select("*")
          .eq("email", email).eq("status", "paid_unclaimed")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (unclaimed) {
          let extra: User = {};
          try {
            const n = JSON.parse(unclaimed.note || "{}");
            extra = { stripe_customer_id: n.customer || null, stripe_subscription_id: n.subscription || null };
          } catch { /* note was not JSON */ }
          await grantPlan(user, unclaimed.plan, "card", PERIOD_DAYS + 3, extra);
          await db.from("friendy_orders").update({ status: "approved", user_id: user.id }).eq("id", unclaimed.id);
          const { data: fresh } = await db.from("users").select("*").eq("id", user.id).single();
          user = fresh;
        }
      }
      return json({ token: await signToken(user.id), user: await publicUser(user) });
    }

    // ── login ──
    if (path === "/auth/login" && method === "POST") {
      const b = await readBody(req);
      const email = cleanEmail(b.email);
      const password = String(b.password ?? "");
      if (!email || !password) return fail(400, "Enter your email and password.");
      const { data: user } = await db.from("users").select("*").eq("email", email).maybeSingle();
      if (!user) {
        await hashPassword(password); // keep timing similar whether or not the account exists
        return fail(401, "Wrong email or password.");
      }
      if (!user.password_hash) {
        return fail(403, "This account has no password yet. Use your setup link to finish creating it.", "SETUP_REQUIRED");
      }
      if (user.lock_until && new Date(user.lock_until).getTime() > Date.now()) {
        return fail(429, "Too many attempts. Try again in a few minutes.", "LOCKED");
      }
      const { hash } = await hashPassword(password, user.password_salt);
      if (!safeEqual(hash, user.password_hash)) {
        const fails = (user.failed_logins || 0) + 1;
        await db.from("users").update({
          failed_logins: fails,
          lock_until: fails >= 8 ? new Date(Date.now() + 10 * 60_000).toISOString() : null,
        }).eq("id", user.id);
        return fail(401, "Wrong email or password.");
      }
      await db.from("users").update({ failed_logins: 0, lock_until: null, last_seen_at: new Date().toISOString() })
        .eq("id", user.id);
      return json({ token: await signToken(user.id), user: await publicUser(user) });
    }

    if (path === "/auth/verify-payment") {
      return fail(410, "Sign in with your email and password. Card payments activate on your account automatically.");
    }

    // ── everything below needs a session ──
    const adminPath = path.startsWith("/admin");
    const needsAuth = adminPath || path.startsWith("/auth/") || path.startsWith("/orders") ||
      path.startsWith("/chat") || path === "/insights" || path === "/account";
    if (!needsAuth) return fail(404, "Not found");

    const user = await authenticate(req);
    if (!user) return fail(401, "Session expired. Please sign in again.", "UNAUTHORIZED");

    if (path === "/auth/me" && method === "GET") {
      db.from("users").update({ last_seen_at: new Date().toISOString() }).eq("id", user.id).then(() => {});
      return json(await publicUser(user));
    }

    if (path === "/auth/profile" && method === "POST") {
      const b = await readBody(req);
      const name = String(b.name ?? "").trim().replace(/\s+/g, " ").slice(0, 40) || null;
      await db.from("users").update({ display_name: name, updated_at: new Date().toISOString() }).eq("id", user.id);
      return json(await publicUser({ ...user, display_name: name }));
    }

    if (path === "/auth/password" && method === "POST") {
      const b = await readBody(req);
      const current = String(b.current ?? "");
      const next = String(b.next ?? "");
      if (next.length < 8 || next.length > 200) return fail(400, "New password must be at least 8 characters.");
      const check = await hashPassword(current, user.password_salt);
      if (!user.password_hash || !safeEqual(check.hash, user.password_hash)) return fail(401, "Current password is wrong.");
      const { hash, salt } = await hashPassword(next);
      await db.from("users").update({ password_hash: hash, password_salt: salt, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      return json({ ok: true });
    }

    if (path === "/account" && method === "DELETE") {
      const b = await readBody(req);
      const check = await hashPassword(String(b.password ?? ""), user.password_salt);
      if (!user.password_hash || !safeEqual(check.hash, user.password_hash)) return fail(401, "Password is wrong.");
      if (isOwner(user)) return fail(400, "Owner accounts can't be deleted from the app.");
      const { error } = await db.from("users").delete().eq("id", user.id); // chat_messages cascade
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }

    // ── orders ──
    if (path === "/orders" && method === "POST") {
      const b = await readBody(req);
      const plan = String(b.plan ?? "");
      const payMethod = String(b.method ?? "");
      if (!PLANS[plan]) return fail(400, "Unknown plan.");
      if (payMethod !== "cashapp" && payMethod !== "card") return fail(400, "Choose Cash App or card.");
      if (isOwner(user)) return fail(400, "Owner accounts already have full access.");
      let handle = String(b.payerHandle ?? "").trim().slice(0, 40) || null;
      if (handle && !handle.startsWith("$")) handle = "$" + handle;

      await db.from("friendy_orders").update({
        status: "rejected",
        note: "superseded by a newer order",
        reviewed_at: new Date().toISOString(),
        reviewed_by: "system",
      }).eq("user_id", user.id).eq("status", "pending");

      const { data: order, error } = await db.from("friendy_orders").insert({
        user_id: user.id,
        email: user.email,
        plan,
        amount_cents: PLANS[plan].cents,
        method: payMethod,
        order_code: newOrderCode(),
        payer_handle: handle,
      }).select("*").single();
      if (error) throw new Error(error.message);

      const view = orderView(order);
      const cardUrl = payMethod === "card"
        ? `${STRIPE_LINKS[plan]}?prefilled_email=${encodeURIComponent(user.email)}&client_reference_id=${order.id}`
        : null;
      return json({ order: view, cardUrl, cardAutoActivation: !!STRIPE_WEBHOOK_SECRET });
    }

    const orderAction = path.match(/^\/orders\/([0-9a-f-]{36})\/(sent|cancel)$/);
    if (orderAction && method === "POST") {
      const [, id, action] = orderAction;
      const { data: order } = await db.from("friendy_orders").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
      if (!order || order.status !== "pending") return fail(404, "Order not found.");
      if (action === "cancel") {
        await db.from("friendy_orders").update({
          status: "rejected",
          note: "cancelled by member",
          reviewed_at: new Date().toISOString(),
          reviewed_by: "member",
        }).eq("id", id);
        return json({ ok: true });
      }
      const b = await readBody(req);
      let handle = String(b.payerHandle ?? "").trim().slice(0, 40) || order.payer_handle;
      if (handle && !handle.startsWith("$")) handle = "$" + handle;
      await db.from("friendy_orders").update({ payer_handle: handle, note: "member marked as sent" }).eq("id", id);
      return json({ ok: true });
    }

    // ── chat ──
    if (path === "/chat/history" && (method === "GET" || method === "DELETE")) {
      const friend = url.searchParams.get("friend") || "";
      if (!PERSONAS[friend]) return fail(400, "Unknown friend.");
      if (method === "DELETE") {
        await db.from("chat_messages").delete().eq("user_id", user.id).eq("friend", friend);
        return json({ ok: true });
      }
      const { data } = await db.from("chat_messages").select("role, content, created_at")
        .eq("user_id", user.id).eq("friend", friend)
        .order("created_at", { ascending: false }).limit(120);
      return json({ messages: (data || []).reverse() });
    }

    if (path === "/chat" && method === "POST") {
      const plan = activePlan(user);
      if (!plan) return fail(403, "You need an active plan to chat.", "SUBSCRIPTION_REQUIRED");
      const b = await readBody(req);
      const friend = String(b.friend ?? "");
      const text = String(b.message ?? "").trim();
      if (!PERSONAS[friend]) return fail(400, "Unknown friend.");
      if (!PLANS[plan].friends.includes(friend)) {
        return fail(403, `${friend} is not on your ${PLANS[plan].label} plan. Upgrade to unlock.`, "UPGRADE_REQUIRED");
      }
      if (!text) return fail(400, "Say something first.");
      if (text.length > MAX_MESSAGE_CHARS) return fail(400, `Keep messages under ${MAX_MESSAGE_CHARS} characters.`);
      if (!ANTHROPIC_KEY) return fail(503, "Your friends are being set up and will be online shortly.", "AI_NOT_CONFIGURED");

      const since = new Date(Date.now() - 86400_000).toISOString();
      const { count } = await db.from("chat_messages").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).eq("role", "user").gte("created_at", since);
      if ((count || 0) >= DAILY_MESSAGE_CAP) {
        return fail(429, "You've hit today's message limit. It resets on a rolling 24 hours.", "RATE_LIMIT");
      }

      // Memory: Plus and Premium friends carry the whole recent story; Basic keeps the current day.
      const remembers = PLANS[plan].rank >= 2;
      let q = db.from("chat_messages").select("role, content, created_at")
        .eq("user_id", user.id).eq("friend", friend)
        .order("created_at", { ascending: false }).limit(remembers ? 60 : 16);
      if (!remembers) q = q.gte("created_at", since);
      const { data: prior } = await q;
      const history = normalizeTurns([
        ...((prior || []).reverse() as Msg[]),
        { role: "user", content: text },
      ]);

      const { data: saved } = await db.from("chat_messages")
        .insert({ user_id: user.id, friend, role: "user", content: text }).select("id").single();

      let reply: string;
      try {
        reply = await callClaude(plan === "premium" ? MODEL_PREMIUM : MODEL_STANDARD, systemPrompt(friend, user), history);
      } catch (e) {
        if (saved?.id) await db.from("chat_messages").delete().eq("id", saved.id);
        console.error("chat_failed", (e as Error).message);
        return fail(502, "Your friend couldn't reply just now. Try again.", "AI_ERROR");
      }

      await db.from("chat_messages").insert({ user_id: user.id, friend, role: "assistant", content: reply });
      return json({ reply });
    }

    // ── growth check-in (Plus+) and growth plan (Premium) ──
    if (path === "/insights" && method === "POST") {
      const plan = activePlan(user);
      if (!plan) return fail(403, "You need an active plan.", "SUBSCRIPTION_REQUIRED");
      const b = await readBody(req);
      const type = b.type === "plan" ? "plan" : "checkin";
      if (type === "checkin" && PLANS[plan].rank < 2) return fail(403, "Weekly check-ins are part of Plus.", "UPGRADE_REQUIRED");
      if (type === "plan" && PLANS[plan].rank < 3) return fail(403, "Growth plans are part of Premium.", "UPGRADE_REQUIRED");
      if (!ANTHROPIC_KEY) return fail(503, "Your friends are being set up and will be online shortly.", "AI_NOT_CONFIGURED");

      const days = type === "plan" ? 30 : 7;
      const { data: rows } = await db.from("chat_messages").select("friend, role, content, created_at")
        .eq("user_id", user.id).gte("created_at", new Date(Date.now() - days * 86400_000).toISOString())
        .order("created_at", { ascending: false }).limit(160);
      const mine = (rows || []).filter((r) => r.role === "user");
      if (mine.length < 3) {
        return json({
          type,
          text: type === "plan"
            ? "There isn't enough here yet to build a plan that's actually about you. Talk with your friends a few more times this month and come back."
            : "There isn't enough from this week to reflect on yet. Have a couple of conversations and check in again.",
          thin: true,
        });
      }
      const transcript = (rows || []).reverse()
        .map((r) => `[${String(r.created_at).slice(0, 10)}] ${r.role === "user" ? "Member" : r.friend}: ${r.content}`)
        .join("\n").slice(-24000);

      const system = type === "plan"
        ? `You are Nova on the Friendy app, writing a personal growth plan for a member based only on their own conversations from the last 30 days. Write in second person, warm and specific. Structure, in plain text with short labeled paragraphs (no markdown, no bullets, no emojis): "Where you are" (2-3 sentences naming real patterns you saw), "What's working" (their actual strengths, with evidence from what they said), "Focus for the next 30 days" (three concrete, small, realistic commitments), "When it gets hard" (one practical tool that fits them). Under 260 words. Use only what is in the conversations; never invent events. You are an AI companion, not a clinician: no diagnoses. If the conversations show risk of self-harm or danger, set the plan aside and instead gently encourage them to reach out to 988 (call or text, US) or local emergency services and to someone they trust.`
        : `You are a caring friend on the Friendy app writing a short weekly check-in for a member based only on their own conversations from the last 7 days. Second person, warm, specific. Plain text, no markdown, no bullets, no emojis. Cover: what they carried this week, one real win or strength you noticed (with evidence from what they said), one pattern worth watching, and one small thing to try in the week ahead. Under 150 words. Use only what is in the conversations; never invent events. No diagnoses. If the conversations show risk of self-harm or danger, set the check-in aside and gently encourage them to reach out to 988 (call or text, US) or local emergency services and to someone they trust.`;

      try {
        const text = await callClaude(
          plan === "premium" ? MODEL_PREMIUM : MODEL_STANDARD,
          system,
          [{ role: "user", content: `Here are my conversations:\n\n${transcript}` }],
          700,
        );
        return json({ type, text });
      } catch {
        return fail(502, "Couldn't put that together just now. Try again.", "AI_ERROR");
      }
    }

    // ── owner panel ──
    if (adminPath) {
      if (!isOwner(user)) return fail(403, "Not allowed.");

      if (path === "/admin/overview" && method === "GET") {
        const [{ data: orders }, { data: users }, { count: msgs24 }, { count: msgsAll }] = await Promise.all([
          db.from("friendy_orders").select("*").order("created_at", { ascending: false }).limit(200),
          db.from("users")
            .select("id, email, display_name, plan, plan_status, plan_expires_at, payment_method, is_owner, created_at, last_seen_at")
            .order("created_at", { ascending: false }).limit(500),
          db.from("chat_messages").select("id", { count: "exact", head: true })
            .eq("role", "user").gte("created_at", new Date(Date.now() - 86400_000).toISOString()),
          db.from("chat_messages").select("id", { count: "exact", head: true }).eq("role", "user"),
        ]);
        const members = (users || []).map((u) => ({
          id: u.id,
          email: u.email,
          name: u.display_name,
          plan: activePlan(u),
          lastPlan: PLANS[u.plan] ? u.plan : null,
          expiresAt: u.is_owner ? null : u.plan_expires_at,
          method: u.payment_method,
          isOwner: isOwner(u),
          createdAt: u.created_at,
          lastSeenAt: u.last_seen_at,
        }));
        const paying = members.filter((m) => m.plan && !m.isOwner);
        const approved = (orders || []).filter((o) => o.status === "approved");
        return json({
          health: { chatReady: !!ANTHROPIC_KEY, cardAutoActivation: !!STRIPE_WEBHOOK_SECRET, cashtag: CASHTAG },
          stats: {
            members: members.length,
            paying: paying.length,
            monthlyRevenue: paying.reduce((s, m) => s + PLANS[m.plan!].cents, 0) / 100,
            collected: approved.reduce((s, o) => s + o.amount_cents, 0) / 100,
            pending: (orders || []).filter((o) => o.status === "pending").length,
            messages24h: msgs24 || 0,
            messagesAll: msgsAll || 0,
          },
          orders: (orders || []).map((o) => ({ ...orderView(o), email: o.email, reviewedAt: o.reviewed_at, note: o.note })),
          members,
        });
      }

      const review = path.match(/^\/admin\/orders\/([0-9a-f-]{36})\/(approve|reject)$/);
      if (review && method === "POST") {
        const [, id, action] = review;
        const { data: order } = await db.from("friendy_orders").select("*").eq("id", id).maybeSingle();
        if (!order) return fail(404, "Order not found.");
        if (order.status !== "pending") return fail(409, `Order is already ${order.status}.`);
        if (action === "approve") {
          const { data: member } = await db.from("users").select("*").eq("id", order.user_id).maybeSingle();
          if (!member) return fail(404, "That member's account no longer exists.");
          const expires = await grantPlan(member, order.plan, order.method);
          await db.from("friendy_orders").update({
            status: "approved",
            reviewed_at: new Date().toISOString(),
            reviewed_by: user.email,
          }).eq("id", id);
          return json({ ok: true, expiresAt: expires });
        }
        await db.from("friendy_orders").update({
          status: "rejected",
          note: "payment not found",
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.email,
        }).eq("id", id);
        return json({ ok: true });
      }

      const memberAction = path.match(/^\/admin\/members\/([0-9a-f-]{36})\/(grant|revoke)$/);
      if (memberAction && method === "POST") {
        const [, id, action] = memberAction;
        const { data: member } = await db.from("users").select("*").eq("id", id).maybeSingle();
        if (!member) return fail(404, "Member not found.");
        if (isOwner(member)) return fail(400, "Owner accounts always have full access.");
        if (action === "grant") {
          const b = await readBody(req);
          const plan = String(b.plan ?? "");
          const days = Math.min(Math.max(Number(b.days) || PERIOD_DAYS, 1), 366);
          if (!PLANS[plan]) return fail(400, "Unknown plan.");
          const expires = await grantPlan(member, plan, member.payment_method || "comp", days);
          return json({ ok: true, expiresAt: expires });
        }
        await db.from("users").update({ plan_status: "inactive", updated_at: new Date().toISOString() }).eq("id", id);
        return json({ ok: true });
      }
    }

    return fail(404, "Not found");
  } catch (e) {
    console.error("friendy_api_error", path, (e as Error).message);
    return fail(500, "Something went wrong on our side. Try again.");
  }
});
