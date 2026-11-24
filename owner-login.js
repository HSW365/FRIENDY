/*! HSW365 Owner Login v3 — PIN only, VIP all access. Drop-in: <script src="owner-login.js" defer></script>
 *  Adds an "Owner login" tab. The owner types only the PIN (no email). The PIN is checked
 *  server-side by the HSW365 owner-pin service (hashed, rate limited, lockout).
 *  On success the app gets:
 *    window.HSW_OWNER = true            window.HSW_OWNER_TOKEN = "<signed token>"
 *    window.HSW_VIP = { owner:true, tier:"elite", unlimited:true }
 *    <html class="hsw-owner hsw-vip">   event "hsw-owner" { detail:{ owner, token } }
 *    window.HSW_OWNER_READY  -> Promise<boolean>, settles after the saved session is re-checked
 *    window.hswOwner = { open, signOut, isOwner, token, ready, onChange(fn) }
 *  Backends must re-check HSW_OWNER_TOKEN with the owner-pin service ({a:"verify",token}).
 *  Markup helpers: [data-hsw-paywall] hides for the owner, [data-hsw-vip] shows only for the owner.
 */
(function () {
  if (window.__hswOwnerLoaded) return; window.__hswOwnerLoaded = true;
  var API = "https://lsxdlmrjrcivxwgfkpop.supabase.co/functions/v1/owner-pin";
  var KEY = "hsw_owner";
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function call(body) {
    return fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: "Try again." }; }); })
      .catch(function () { return { ok: false, error: "No connection. Check your internet." }; });
  }

  var listeners = [];
  function setOwner(on, token) {
    on = !!on;
    if (on && token) ls.set(KEY, token);
    if (!on) ls.del(KEY);
    window.HSW_OWNER = on;
    window.HSW_OWNER_TOKEN = on ? (token || ls.get(KEY)) : null;
    window.HSW_VIP = on ? { owner: true, tier: "elite", unlimited: true } : null;
    var de = document.documentElement;
    de.classList.toggle("hsw-owner", on); de.classList.toggle("hsw-vip", on);
    refreshBtns();
    var detail = { owner: on, token: window.HSW_OWNER_TOKEN };
    listeners.forEach(function (fn) { try { fn(on, detail); } catch (e) {} });
    try { window.dispatchEvent(new CustomEvent("hsw-owner", { detail: detail })); } catch (e) {}
  }
  window.HSW_OWNER = false; window.HSW_OWNER_TOKEN = null; window.HSW_VIP = null;

  var C = "#e11d2e", G = "#16a34a";
  var css = document.createElement("style");
  css.textContent =
    "html.hsw-owner [data-hsw-paywall]{display:none!important}html:not(.hsw-owner) [data-hsw-vip]{display:none!important}" +
    ".hswo-tab{position:fixed;top:12px;right:12px;z-index:2147483000;display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 15px;border:1px solid rgba(255,255,255,.16);border-radius:999px;background:rgba(14,14,20,.84);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);color:#fff;font:700 12.5px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.04em;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.35);transition:background .18s,border-color .18s,transform .18s}" +
    ".hswo-tab:hover{border-color:" + C + ";background:" + C + ";transform:translateY(-1px)}.hswo-tab:focus-visible{outline:2px solid #fff;outline-offset:2px}" +
    ".hswo-tab svg{width:15px;height:15px;flex:none}" +
    "html.hsw-owner .hswo-tab{border-color:rgba(74,222,128,.55);background:rgba(21,128,61,.92)}html.hsw-owner .hswo-tab:hover{background:" + G + "}" +
    "@media (max-width:520px){.hswo-tab{top:auto;bottom:14px;right:14px;height:36px;padding:0 13px;font-size:12px}}" +
    ".hswo-ov{position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(5,5,9,.72);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}" +
    ".hswo-ov.open{display:flex}" +
    ".hswo-box{width:100%;max-width:360px;padding:30px 26px 24px;border-radius:20px;background:linear-gradient(180deg,#171722,#0d0d14);border:1px solid rgba(255,255,255,.1);box-shadow:0 30px 80px rgba(0,0,0,.6);color:#fff;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;position:relative;animation:hswoIn .22s ease-out}" +
    "@keyframes hswoIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}" +
    ".hswo-box h3{margin:12px 0 4px;font:800 22px/1.15 system-ui,sans-serif;letter-spacing:.01em;color:#fff}" +
    ".hswo-box p{margin:0 0 16px;color:#a1a1b5;font-size:13.5px}" +
    ".hswo-ic{width:46px;height:46px;margin:0 auto;border-radius:14px;display:grid;place-items:center;background:" + C + ";box-shadow:0 8px 24px rgba(225,29,46,.45);color:#fff}" +
    ".hswo-box.vip .hswo-ic{background:" + G + ";box-shadow:0 8px 24px rgba(22,163,74,.45)}" +
    ".hswo-ic svg{width:22px;height:22px}" +
    ".hswo-in{display:block;box-sizing:border-box;width:100%;height:52px;margin:0 0 10px;padding:0 12px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:#0a0a10;color:#fff;font:700 24px/1 ui-monospace,Menlo,monospace;letter-spacing:.5em;text-align:center;outline:none}" +
    ".hswo-in.code{letter-spacing:.2em;font-size:18px;text-transform:uppercase}" +
    ".hswo-in:focus{border-color:" + C + ";box-shadow:0 0 0 3px rgba(225,29,46,.25)}" +
    ".hswo-go{display:block;width:100%;height:50px;border:0;border-radius:12px;background:" + C + ";color:#fff;font:800 15px/1 system-ui,sans-serif;letter-spacing:.05em;cursor:pointer;transition:filter .15s}" +
    ".hswo-go:hover{filter:brightness(1.08)}.hswo-go:disabled{opacity:.6;cursor:default}" +
    ".hswo-go.ghost{background:transparent;border:1px solid rgba(255,255,255,.18);color:#e5e5ef;margin-top:10px}" +
    ".hswo-perks{list-style:none;margin:0 0 18px;padding:0;text-align:left;font-size:13.5px;color:#d4d4e0}" +
    ".hswo-perks li{display:flex;gap:10px;align-items:center;padding:7px 0;border-top:1px solid rgba(255,255,255,.06)}" +
    ".hswo-perks li:first-child{border-top:0}.hswo-perks b{color:#4ade80;font-size:15px}" +
    ".hswo-msg{min-height:20px;margin:10px 0 0;font-size:13px;color:#ff6b78}" +
    ".hswo-lnk{margin-top:6px;background:none;border:0;color:#8a8aa0;font-size:12.5px;cursor:pointer;text-decoration:underline}" +
    ".hswo-x{position:absolute;top:10px;right:14px;background:none;border:0;color:#8a8aa0;font-size:24px;cursor:pointer;line-height:1}" +
    ".hswo-toast{position:fixed;left:50%;bottom:24px;z-index:2147483002;transform:translateX(-50%) translateY(20px);opacity:0;padding:12px 18px;border-radius:12px;background:#0f1a12;border:1px solid rgba(74,222,128,.4);color:#dcfce7;font:600 13.5px/1.3 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.45);transition:.25s;pointer-events:none}" +
    ".hswo-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}";
  (document.head || document.documentElement).appendChild(css);

  var LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  var CROWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/></svg>';

  var ov, form, pin, code, go, msg, lnk, h, p, box, loginView, vipView, mode = "login", btns = [];
  function $(s) { return ov.querySelector(s); }

  function build() {
    ov = document.createElement("div");
    ov.className = "hswo-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Owner login");
    ov.innerHTML = '<div class="hswo-box"><button class="hswo-x" type="button" aria-label="Close">&times;</button><div class="hswo-ic"></div><h3></h3><p></p>' +
      '<div class="hswo-login"><form autocomplete="off" novalidate>' +
      '<input class="hswo-in code" name="code" placeholder="SETUP CODE" aria-label="Setup code" style="display:none" autocomplete="off">' +
      '<input class="hswo-in" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="10" placeholder="••••••" aria-label="Owner PIN" autocomplete="current-password">' +
      '<button class="hswo-go" type="submit"></button></form><div class="hswo-msg" role="alert"></div><button class="hswo-lnk" type="button" style="display:none"></button></div>' +
      '<div class="hswo-vip" style="display:none"><ul class="hswo-perks"><li><b>✓</b>Every plan and tier unlocked</li><li><b>✓</b>Unlimited credits and usage</li><li><b>✓</b>No checkout, no billing, ever</li><li><b>✓</b>Signed in on this device for 30 days</li></ul>' +
      '<button class="hswo-go" type="button" data-act="done">KEEP GOING</button><button class="hswo-go ghost" type="button" data-act="out">Sign out of owner mode</button></div></div>';
    document.body.appendChild(ov);
    box = $(".hswo-box"); form = $("form"); pin = $("[name=pin]"); code = $("[name=code]"); go = $(".hswo-login .hswo-go");
    msg = $(".hswo-msg"); lnk = $(".hswo-lnk"); h = $("h3"); p = $("p"); loginView = $(".hswo-login"); vipView = $(".hswo-vip");
    $(".hswo-x").onclick = close;
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && ov.classList.contains("open")) close(); });
    lnk.onclick = function () { setMode("setup"); code.focus(); };
    pin.addEventListener("input", function () { pin.value = pin.value.replace(/\D/g, ""); });
    $("[data-act=done]").onclick = close;
    $("[data-act=out]").onclick = function () { signOut(); close(); toast("Owner mode off on this device"); };
    form.addEventListener("submit", submit);
  }

  function setMode(m) {
    mode = m; msg.textContent = ""; pin.value = ""; code.value = "";
    var vip = m === "vip";
    box.classList.toggle("vip", vip);
    $(".hswo-ic").innerHTML = vip ? CROWN : LOCK;
    loginView.style.display = vip ? "none" : ""; vipView.style.display = vip ? "" : "none";
    code.style.display = m === "setup" ? "" : "none";
    if (vip) { h.textContent = "VIP all access"; p.textContent = "You're signed in as the owner. Everything on this app is free for you."; }
    else if (m === "setup") { h.textContent = "Create your PIN"; p.textContent = "One time. Enter your setup code and choose 6 to 10 digits."; go.textContent = "SAVE PIN"; lnk.style.display = "none"; }
    else { h.textContent = "Owner login"; p.textContent = "Enter your PIN."; go.textContent = "ENTER"; lnk.textContent = "Forgot PIN"; lnk.style.display = ""; }
  }

  function open() {
    if (!ov) build();
    ov.classList.add("open");
    if (window.HSW_OWNER) { setMode("vip"); setTimeout(function () { $("[data-act=done]").focus(); }, 30); return; }
    setMode("login");
    setTimeout(function () { pin.focus(); }, 30);
    call({ a: "status" }).then(function (s) { if (s && s.set === false && mode === "login") { setMode("setup"); code.focus(); } });
  }
  function close() { if (ov) ov.classList.remove("open"); }
  function signOut() { setOwner(false); }

  function submit(e) {
    e.preventDefault();
    if (mode === "setup" && !code.value.trim()) { msg.textContent = "Enter your setup code."; return; }
    if (!/^\d{6,10}$/.test(pin.value)) { msg.textContent = "PIN is 6 to 10 digits."; return; }
    go.disabled = true; msg.textContent = "";
    var body = mode === "setup" ? { a: "setup", code: code.value, pin: pin.value } : { a: "login", pin: pin.value };
    call(body).then(function (r) {
      go.disabled = false;
      if (r && r.ok && r.token) { setOwner(true, r.token); setMode("vip"); toast("VIP all access is on"); }
      else if (r && r.needSetup) { setMode("setup"); msg.textContent = r.error; }
      else { msg.textContent = (r && r.error) || "Try again."; pin.value = ""; pin.focus(); }
    });
  }

  var tt;
  function toast(t) {
    var el = document.querySelector(".hswo-toast");
    if (!el) { el = document.createElement("div"); el.className = "hswo-toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = t; el.classList.add("on"); clearTimeout(tt); tt = setTimeout(function () { el.classList.remove("on"); }, 2600);
  }

  function refreshBtns() {
    btns.forEach(function (b) {
      var l = b.querySelector(".hswo-lbl"); if (l) l.textContent = window.HSW_OWNER ? "VIP · Owner" : "Owner login";
      var i = b.querySelector(".hswo-i"); if (i) i.innerHTML = window.HSW_OWNER ? CROWN : LOCK;
      b.setAttribute("aria-label", window.HSW_OWNER ? "Owner VIP access on" : "Owner login");
    });
  }

  function mount() {
    // Hook the app's own owner buttons if it has them, else add the floating tab.
    var existing = document.querySelectorAll("[data-owner],a.owner-btn,.owner-login");
    if (existing.length) {
      Array.prototype.forEach.call(existing, function (el) { el.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); open(); }, true); });
    } else {
      var t = document.createElement("button");
      t.type = "button"; t.className = "hswo-tab";
      t.innerHTML = '<span class="hswo-i" style="display:inline-flex">' + LOCK + '</span><span class="hswo-lbl">Owner login</span>';
      t.onclick = open; document.body.appendChild(t); btns.push(t);
    }
    refreshBtns();
  }

  // Restore a saved owner session (re-checked with the server every page load).
  var saved = ls.get(KEY);
  var ready = !saved ? Promise.resolve(false) : call({ a: "verify", token: saved }).then(function (r) {
    if (r && r.ok) { setOwner(true, saved); return true; }
    if (r && r.ok === false && !r.error) ls.del(KEY); // expired or bad token; keep it on network errors
    return false;
  });
  window.HSW_OWNER_READY = ready;
  window.hswOwner = {
    open: open, signOut: signOut, ready: ready,
    isOwner: function () { return !!window.HSW_OWNER; },
    token: function () { return window.HSW_OWNER_TOKEN; },
    onChange: function (fn) { if (typeof fn === "function") { listeners.push(fn); if (window.HSW_OWNER) fn(true, { owner: true, token: window.HSW_OWNER_TOKEN }); } }
  };
  window.HSW_OWNER_OPEN = open;

  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
})();
