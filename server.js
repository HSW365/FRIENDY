require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const jwt = require('jsonwebtoken');
const Anthropic = require('@anthropic-ai/sdk');

const User = require('./models/User');
const authMiddleware = require('./middleware/auth');

const app = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── CORS ──────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'https://hsw365.github.io',
    'http://localhost:3000',
    'http://127.0.0.1:5500'
  ],
  credentials: true
}));

// ── STRIPE WEBHOOK (raw body BEFORE json parser) ──────────────────
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const PLAN_MAP = {
    [process.env.STRIPE_PRICE_BASIC]:   'basic',
    [process.env.STRIPE_PRICE_PLUS]:    'plus',
    [process.env.STRIPE_PRICE_PREMIUM]: 'premium'
  };

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const email = session.customer_details?.email;
      const customerId = session.customer;
      const subscriptionId = session.subscription;

      if (!email) break;

      // Get subscription to find price/plan
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId = subscription.items.data[0]?.price?.id;
      const plan = PLAN_MAP[priceId] || 'basic';

      let user = await User.findOne({ email });
      if (!user) user = new User({ email });

      user.stripeCustomerId = customerId;
      user.stripeSubscriptionId = subscriptionId;
      user.plan = plan;
      user.planStatus = 'active';
      user.planActivatedAt = new Date();
      await user.save();

      console.log(`✅ New subscriber: ${email} → ${plan}`);
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const user = await User.findOne({ stripeCustomerId: customerId });
      if (user) {
        user.planStatus = 'active';
        await user.save();
        console.log(`✅ Payment renewed: ${user.email}`);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const user = await User.findOne({ stripeCustomerId: customerId });
      if (user) {
        user.planStatus = 'past_due';
        await user.save();
        console.log(`⚠️ Payment failed: ${user.email}`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const user = await User.findOne({ stripeSubscriptionId: subscription.id });
      if (user) {
        user.plan = 'none';
        user.planStatus = 'inactive';
        await user.save();
        console.log(`❌ Subscription cancelled: ${user.email}`);
      }
      break;
    }
  }

  res.json({ received: true });
});

// ── JSON parser (after webhook) ───────────────────────────────────
app.use(express.json());

// ── HEALTH CHECK ──────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', app: 'Friendy' }));

// ── AUTH: Login / Register after Stripe payment ───────────────────
// Called from frontend after Stripe redirects back with ?session_id=
app.post('/auth/verify-payment', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'No session ID' });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not completed' });
    }

    const email = session.customer_details?.email;
    if (!email) return res.status(400).json({ error: 'No email found' });

    const user = await User.findOne({ email });
    if (!user || user.planStatus !== 'active') {
      return res.status(403).json({ error: 'No active subscription found' });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email, plan: user.plan },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: { email: user.email, plan: user.plan, planStatus: user.planStatus }
    });
  } catch (err) {
    console.error('verify-payment error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── AUTH: Check existing token / subscription status ──────────────
app.get('/auth/me', authMiddleware, (req, res) => {
  res.json({
    email: req.user.email,
    plan: req.user.plan,
    planStatus: req.user.planStatus
  });
});

// ── AUTH: Login with email (sends magic link or just returns token) ─
app.post('/auth/login', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'No account found. Please subscribe first.' });
    if (user.planStatus !== 'active') return res.status(403).json({ error: 'No active subscription', code: 'SUBSCRIPTION_REQUIRED' });

    const token = jwt.sign(
      { userId: user._id, email: user.email, plan: user.plan },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: { email: user.email, plan: user.plan, planStatus: user.planStatus }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── CHAT: Protected AI endpoint ───────────────────────────────────
const FRIEND_PERSONAS = {
  Maya: `You are Maya, a warm, genuine, ride-or-die best friend on the Friendy app. You communicate like a real friend texting — casual, real, caring.
RULES — always follow these:
1. ALWAYS reframe negatives into positives. If they say "I can't do this" → "You already did the hardest part by showing up. Most people don't even get that far."
2. Use proven psychology naturally — CBT reframing, cognitive restructuring, strength-based approaches — but deliver it like a conversation, never a lecture.
3. End every response with something empowering, a fresh perspective, or a concrete next step.
4. Keep it real: 2–4 sentences. Warm but not fake. Genuine not performative.
5. If they're being hard on themselves, challenge it with evidence and compassion.`,

  Dre: `You are Dre, a loyal, no-BS best friend on the Friendy app. You keep it real, always.
RULES — always follow these:
1. ALWAYS flip the negative. Call out self-defeating thoughts directly — "Nah, that's fear talking. Here's what I actually see in you."
2. Be direct but never cold. Honest because you genuinely care.
3. Casual language — real talk, I got you, facts — but earned, never forced.
4. Short and punchy. 2–3 sentences. End with a challenge or a push forward.`,

  Sage: `You are Sage, a calm, deeply wise friend on the Friendy app. You help people see what they've been missing.
RULES — always follow these:
1. ALWAYS transform hardship into growth. "What if this difficult moment is exactly what's shaping you into who you need to become?"
2. Use mindfulness, acceptance, positive psychology — gently woven into conversation.
3. Calm, thoughtful, 2–4 sentences. Sometimes ask a single powerful question.
4. Leave them feeling grounded, clear, and hopeful.`,

  Kai: `You are Kai, the ultimate hype friend on the Friendy app. You make people feel unstoppable.
RULES — always follow these:
1. ALWAYS amplify the positive and demolish the negative with energy.
2. Strength-based psychology: focus on what they DID, what they CAN do, what makes them powerful.
3. High energy but genuine — never hollow. 2–3 sentences.
4. End with something that makes them want to move RIGHT NOW.`,

  Nova: `You are Nova, a brilliant friend with deep psychological expertise on the Friendy app.
RULES — always follow these:
1. ALWAYS reframe through evidence-based psychology — CBT, ACT, positive psychology — delivered as real conversation.
2. Gently identify cognitive distortions: "That sounds like all-or-nothing thinking — let's look at the full picture."
3. Offer concrete tools as suggestions: "One thing that actually works here is..."
4. Thoughtful, 3–5 sentences. End with a reframe that genuinely shifts their perspective.`
};

const PLAN_FRIENDS = {
  basic:   ['Maya', 'Dre'],
  plus:    ['Maya', 'Dre', 'Sage', 'Kai'],
  premium: ['Maya', 'Dre', 'Sage', 'Kai', 'Nova']
};

app.post('/chat', authMiddleware, async (req, res) => {
  try {
    const { friend, messages } = req.body;
    const userPlan = req.user.plan;

    // Check friend is available on this plan
    const allowedFriends = PLAN_FRIENDS[userPlan] || [];
    if (!allowedFriends.includes(friend)) {
      return res.status(403).json({
        error: `${friend} is not available on your ${userPlan} plan. Upgrade to unlock.`,
        code: 'UPGRADE_REQUIRED'
      });
    }

    const persona = FRIEND_PERSONAS[friend];
    if (!persona) return res.status(400).json({ error: 'Unknown friend' });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: persona,
      messages: messages
    });

    res.json({ reply: response.content[0].text });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Chat error' });
  }
});

// ── CONNECT DB & START ────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 Friendy backend running on port ${PORT}`));
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });
