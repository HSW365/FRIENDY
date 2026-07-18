// Friendy native bridge
// Bundled (IIFE) into www/native-bridge.bundle.js and loaded by index.html
// BEFORE the app's inline <script>. Exposes window.FriendyNative so the
// existing web UI can stay mostly untouched and just call these instead
// of redirecting to an external Stripe checkout URL (which Apple rejects
// for digital-content subscriptions — Guideline 3.1.1).

import { Capacitor } from '@capacitor/core';
import { Purchases, LOG_LEVEL } from '@revenuecat/purchases-capacitor';
import { StatusBar, Style } from '@capacitor/status-bar';

// ⚠️ Replace with your real RevenueCat iOS public SDK key
// (RevenueCat dashboard → Project → API Keys → Apple App Store).
const REVENUECAT_PUBLIC_API_KEY = 'appl_REPLACE_WITH_REVENUECAT_IOS_KEY';

// Plan name -> RevenueCat Offering identifier.
// Create 3 Offerings in RevenueCat named exactly: basic, plus, premium,
// each containing one $rc_monthly Package tied to the matching
// App Store Connect auto-renewable subscription product, e.g.:
//   com.hsw365.friendy.basic.monthly
//   com.hsw365.friendy.plus.monthly
//   com.hsw365.friendy.premium.monthly
const PLAN_OFFERINGS = { basic: 'basic', plus: 'plus', premium: 'premium' };

// Entitlement identifiers to configure in RevenueCat (Entitlements tab),
// one per plan, attached to the matching product.
const PLAN_ENTITLEMENTS = { basic: 'basic', plus: 'plus', premium: 'premium' };

let configured = false;

async function ensureConfigured(appUserId) {
  if (configured) return;
  await Purchases.setLogLevel({ level: LOG_LEVEL.WARN });
  await Purchases.configure({
    apiKey: REVENUECAT_PUBLIC_API_KEY,
    appUserID: appUserId || undefined
  });
  configured = true;
}

function highestActivePlan(customerInfo) {
  const active = customerInfo?.entitlements?.active || {};
  if (active[PLAN_ENTITLEMENTS.premium]) return 'premium';
  if (active[PLAN_ENTITLEMENTS.plus]) return 'plus';
  if (active[PLAN_ENTITLEMENTS.basic]) return 'basic';
  return null;
}

const FriendyNative = {
  isNative() {
    return Capacitor.isNativePlatform();
  },

  async init() {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: '#080809' });
    } catch (e) { /* status bar not available on some devices, ignore */ }
  },

  // Call once you know the user's email (after they type it in the
  // "choose a plan" flow, before purchasing) so RevenueCat ties the
  // purchase to that identity — makes cross-device / restore reliable.
  async identify(appUserId) {
    await ensureConfigured(appUserId);
    if (appUserId) {
      try { await Purchases.logIn({ appUserID: appUserId }); } catch (e) { /* already this user */ }
    }
  },

  async getOfferings() {
    await ensureConfigured();
    const offerings = await Purchases.getOfferings();
    return offerings;
  },

  // plan: 'basic' | 'plus' | 'premium'
  // Returns { success, plan, customerInfo } or { success:false, cancelled, error }
  async purchasePlan(plan) {
    await ensureConfigured();
    const offeringId = PLAN_OFFERINGS[plan];
    try {
      const offerings = await Purchases.getOfferings();
      const offering = offerings.all[offeringId] || offerings.current;
      if (!offering) throw new Error(`No RevenueCat offering found for plan "${plan}". Configure it in the RevenueCat dashboard.`);
      const pkg = offering.availablePackages.find(p => p.packageType === 'MONTHLY') || offering.availablePackages[0];
      if (!pkg) throw new Error(`Offering "${offeringId}" has no packages.`);

      const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
      const resolvedPlan = highestActivePlan(customerInfo) || plan;
      return { success: true, plan: resolvedPlan, customerInfo };
    } catch (err) {
      const cancelled = !!(err && (err.userCancelled || err.code === 'PURCHASES_ERROR' && err.message?.includes('cancel')));
      return { success: false, cancelled, error: err?.message || String(err) };
    }
  },

  async restorePurchases() {
    await ensureConfigured();
    try {
      const customerInfo = await Purchases.restorePurchases();
      const plan = highestActivePlan(customerInfo);
      return { success: true, plan, customerInfo };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  },

  async getActivePlan() {
    await ensureConfigured();
    try {
      const { customerInfo } = await Purchases.getCustomerInfo();
      return highestActivePlan(customerInfo);
    } catch (err) {
      return null;
    }
  },

  // Sends the person to the platform's native subscription management
  // screen so they can cancel/change plan — required by Apple guideline
  // 3.1.2 (no custom cancel-my-subscription flow needed if you deep-link
  // here, but Settings > Apple ID > Subscriptions also always works).
  async manageSubscriptions() {
    try {
      await Purchases.showManageSubscriptions();
    } catch (e) { /* fall back to Settings app manually */ }
  },

  async logOut() {
    if (!configured) return;
    try { await Purchases.logOut(); } catch (e) { /* anonymous already */ }
  }
};

window.FriendyNative = FriendyNative;
