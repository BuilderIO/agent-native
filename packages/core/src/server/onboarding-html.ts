/**
 * First-run onboarding page for agent-native apps.
 *
 * Shown when Better Auth is active and the user isn't signed in.
 * Provides two paths:
 * 1. Create account (email/password) — real identity from day one
 * 2. Use locally — sets AUTH_MODE=local for offline/solo dev (dev only)
 *
 * After first account exists, this page acts as a normal login page.
 * The "Use locally" escape hatch is hidden in production to ensure
 * real accounts are used (needed for per-user usage tracking/limits).
 * It's also hidden when DATABASE_URL points at a non-local DB (Postgres,
 * Turso, D1) — local@localhost has no per-user scoping, so enabling it
 * against a shared DB would silently fail server-side.
 */

import { isLocalDatabase } from "../db/client.js";

function isProductionEnv(): boolean {
  const env = process.env.NODE_ENV;
  return env !== "development" && env !== "test";
}

function hasGoogleOAuth(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function getConnectionLabel(): string {
  const url = process.env.DATABASE_URL || "";
  if (!url) return "SQLite (local file)";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    if (url.includes("neon.tech")) return "Neon Postgres";
    if (url.includes("supabase")) return "Supabase Postgres";
    return "Postgres";
  }
  if (url.startsWith("file:")) return "SQLite (local file)";
  if (url.startsWith("libsql://") || url.includes("turso.io")) return "Turso";
  return "SQL database";
}

export interface OnboardingHtmlOptions {
  /**
   * Hide email/password forms and show ONLY the Google sign-in button.
   * Useful for templates (mail, calendar) where Google is required anyway.
   * If Google OAuth env vars are not configured, an error message is shown.
   */
  googleOnly?: boolean;
}

const MIGRATE_FLAG_KEY = "an_migrate_from_local";

export function getOnboardingHtml(opts: OnboardingHtmlOptions = {}): string {
  const showLocalMode =
    !isProductionEnv() && !opts.googleOnly && isLocalDatabase();
  const showGoogle = hasGoogleOAuth();
  const googleOnly = !!opts.googleOnly;
  const localModeBlock = showLocalMode
    ? `
  <div class="divider" id="local-divider">or</div>

  <button class="btn-secondary" id="local-btn" onclick="useLocally()">Use locally without an account</button>
  <p class="local-info" id="local-info">Skip auth for solo local development. You can create an account later.</p>`
    : "";

  const localModeScript = showLocalMode
    ? `
  async function useLocally() {
    var btn = document.getElementById('local-btn');
    btn.disabled = true;
    btn.textContent = 'Setting up...';
    try {
      try {
        if (localStorage.getItem('${MIGRATE_FLAG_KEY}')) {
          localStorage.removeItem('${MIGRATE_FLAG_KEY}');
        }
      } catch (e) {}
      var res = await fetch('/_agent-native/auth/local-mode', { method: 'POST' });
      if (res.ok) {
        window.location.reload();
      } else {
        var data = await res.json().catch(function() { return {}; });
        var info = document.getElementById('local-info');
        if (info && data && data.error) {
          info.textContent = data.error;
          info.style.color = '#f87171';
        }
        btn.textContent = 'Not available';
        btn.disabled = true;
      }
    } catch(e) {
      btn.textContent = 'Failed — try again';
      btn.disabled = false;
    }
  }`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Welcome</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0a0a0a;
    color: #e5e5e5;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 1rem;
  }
  .card {
    width: 100%;
    max-width: 400px;
    padding: 2rem;
    background: #141414;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
  }
  h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.25rem; color: #fff; }
  .subtitle { font-size: 0.8125rem; color: #888; margin-bottom: 1.5rem; }
  .tabs {
    display: inline-flex;
    width: 100%;
    padding: 4px;
    margin-bottom: 1.5rem;
    background: rgba(255,255,255,0.06);
    border-radius: 8px;
  }
  .tab {
    flex: 1;
    padding: 0.5rem 0.75rem;
    background: none;
    border: none;
    color: #888;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    border-radius: 6px;
  }
  .tab.active {
    background: #1e1e1e;
    color: #fff;
    box-shadow: 0 1px 2px rgba(0,0,0,0.3);
  }
  .tab:hover:not(.active) { color: #bbb; }
  .form { display: none; }
  .form.active { display: block; }
  label { display: block; font-size: 0.8125rem; color: #888; margin-bottom: 0.375rem; }
  input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    color: #e5e5e5;
    font-size: 0.875rem;
    outline: none;
    margin-bottom: 0.875rem;
  }
  input:focus { border-color: rgba(255,255,255,0.3); box-shadow: 0 0 0 1px rgba(255,255,255,0.1); }
  input::placeholder { color: #555; }
  button[type="submit"], .btn-primary {
    width: 100%;
    margin-top: 0.25rem;
    padding: 0.5rem;
    background: #fff;
    color: #000;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
  }
  button[type="submit"]:hover, .btn-primary:hover { background: #e5e5e5; }
  button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    width: 100%;
    margin-top: 0.75rem;
    padding: 0.5rem;
    background: transparent;
    color: #888;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .btn-secondary:hover { color: #bbb; border-color: rgba(255,255,255,0.2); }
  .msg { margin-top: 0.75rem; font-size: 0.8125rem; display: none; }
  .msg.error { color: #f87171; }
  .msg.success { color: #4ade80; }
  .msg.show { display: block; }
  .divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 1.25rem 0;
    font-size: 0.75rem;
    color: #555;
  }
  .divider::before, .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(255,255,255,0.08);
  }
  .local-info {
    font-size: 0.75rem;
    color: #666;
    margin-top: 0.5rem;
    line-height: 1.4;
  }
  .upgrade-note {
    margin-bottom: 1rem;
    padding: 0.75rem;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    background: rgba(255,255,255,0.03);
    font-size: 0.75rem;
    line-height: 1.5;
    color: #a1a1aa;
    display: none;
  }
  .upgrade-note.show { display: block; }
  .btn-google {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.625rem;
    padding: 0.5rem;
    background: #fff;
    color: #000;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
  }
  .btn-google:hover { background: #e5e5e5; }
  .btn-google:disabled { opacity: 0.5; cursor: wait; }
  .btn-google svg { width: 18px; height: 18px; flex-shrink: 0; }
  .google-error { margin-top: 0.5rem; font-size: 0.8125rem; color: #f87171; display: none; }
  .google-error.show { display: block; }
  .local-note {
    display: none;
    max-width: 400px;
    width: 100%;
    margin-top: 1rem;
    padding: 0.625rem 0.875rem;
    font-size: 0.6875rem;
    line-height: 1.5;
    color: #666;
    border: 1px dashed rgba(255,255,255,0.08);
    border-radius: 8px;
    text-align: center;
  }
  .local-note.show { display: block; }
  .local-note strong { color: #999; font-weight: 500; }
  .local-note a { color: #888; text-decoration: underline; text-underline-offset: 2px; }
  .local-note a:hover { color: #bbb; }
</style>
</head>
<body>
<div class="card">
  <h1>Welcome</h1>
  <p class="subtitle">Create an account to get started</p>
  <p class="upgrade-note" id="upgrade-note">
    You started this flow from <code>local@localhost</code>. Continue signing in to upgrade this workspace to a real account and migrate your local data. If you want to cancel that and keep using local mode, use the secondary button below.
  </p>

${
  showGoogle
    ? `
  <button class="btn-google" id="google-btn" onclick="signInWithGoogle()">
    <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
    Sign in with Google
  </button>
  <p class="google-error" id="google-err"></p>
${googleOnly ? "" : `\n  <div class="divider">or</div>\n`}
`
    : googleOnly
      ? `
  <p style="color:#f87171;font-size:0.875rem;text-align:center;padding:1rem 0">
    Google sign-in is not configured. Set <code>GOOGLE_CLIENT_ID</code> and
    <code>GOOGLE_CLIENT_SECRET</code> environment variables to enable login.
  </p>
`
      : ""
}
${
  googleOnly
    ? ""
    : `  <div class="tabs">
    <button class="tab" data-tab="signup">Create account</button>
    <button class="tab" data-tab="login">Sign in</button>
  </div>

  <form id="signup-form" class="form">
    <label for="s-email">Email</label>
    <input id="s-email" type="email" autocomplete="email" autofocus placeholder="you@example.com" required />
    <label for="s-pass">Password</label>
    <input id="s-pass" type="password" autocomplete="new-password" placeholder="At least 8 characters" required minlength="8" />
    <label for="s-pass2">Confirm password</label>
    <input id="s-pass2" type="password" autocomplete="new-password" placeholder="Confirm password" required minlength="8" />
    <button type="submit">Create account</button>
    <p class="msg" id="s-msg"></p>
  </form>

  <form id="login-form" class="form">
    <label for="l-email">Email</label>
    <input id="l-email" type="email" autocomplete="email" placeholder="you@example.com" required />
    <label for="l-pass">Password</label>
    <input id="l-pass" type="password" autocomplete="current-password" placeholder="Enter password" required />
    <button type="submit">Sign in</button>
    <p class="msg error" id="l-msg"></p>
    <p style="margin-top:0.75rem;font-size:0.75rem;text-align:right">
      <a href="#" id="forgot-link" style="color:#888;text-decoration:underline;text-underline-offset:2px">Forgot password?</a>
    </p>
  </form>

  <form id="forgot-form" class="form">
    <label for="f-email">Email</label>
    <input id="f-email" type="email" autocomplete="email" placeholder="you@example.com" required />
    <button type="submit">Send reset link</button>
    <p class="msg" id="f-msg"></p>
    <p style="margin-top:0.75rem;font-size:0.75rem;text-align:center">
      <a href="#" id="back-to-login" style="color:#888;text-decoration:underline;text-underline-offset:2px">Back to sign in</a>
    </p>
  </form>`
}
${localModeBlock}
</div>
<p class="local-note" id="local-note">
  This account lives in <strong>your app</strong>, not an external service. Current connection: <strong>${getConnectionLabel()}</strong>.
  <br />
  <a href="https://github.com/BuilderIO/agent-native#readme" target="_blank" rel="noreferrer">Connect a different database or auth provider →</a>
</p>
<script>
  (function revealLocalNote() {
    var h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) {
      var n = document.getElementById('local-note');
      if (n) n.classList.add('show');
    }
  })();
${
  googleOnly
    ? ""
    : `  var TAB_STORAGE_KEY = 'an.onboarding.tab';
  var tabs = document.querySelectorAll('.tab');
  var forms = document.querySelectorAll('.form');
  function setActiveTab(name, opts) {
    if (name !== 'signup' && name !== 'login') return;
    var form = document.getElementById(name + '-form');
    if (!form) return;
    tabs.forEach(function(x) { x.classList.remove('active'); });
    forms.forEach(function(x) { x.classList.remove('active'); });
    var btn = document.querySelector('.tab[data-tab="' + name + '"]');
    if (btn) btn.classList.add('active');
    form.classList.add('active');
    if (opts && opts.persist) {
      try { localStorage.setItem(TAB_STORAGE_KEY, name); } catch (e) {}
    }
  }
  (function initActiveTab() {
    var initial = 'signup';
    try {
      var params = new URLSearchParams(location.search);
      var qp = params.get('tab');
      if (qp === 'login' || qp === 'signup') {
        initial = qp;
      } else {
        var stored = localStorage.getItem(TAB_STORAGE_KEY);
        if (stored === 'login' || stored === 'signup') initial = stored;
      }
    } catch (e) {}
    setActiveTab(initial, { persist: false });
  })();
  tabs.forEach(function(t) { t.addEventListener('click', function() {
    setActiveTab(t.dataset.tab, { persist: true });
  }); });

  document.getElementById('signup-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var form = e.currentTarget;
    var btn = form.querySelector('button[type="submit"]');
    var msg = document.getElementById('s-msg');
    msg.classList.remove('show', 'error', 'success');
    var pass = document.getElementById('s-pass').value;
    var pass2 = document.getElementById('s-pass2').value;
    if (pass !== pass2) {
      msg.textContent = 'Passwords do not match';
      msg.classList.add('show', 'error');
      return;
    }
    var originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Creating account…';
    try {
      var email = document.getElementById('s-email').value;
      var res = await fetch('/_agent-native/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: pass }),
      });
      var data = await res.json().catch(function() { return {}; });
      if (res.ok) {
        msg.textContent = 'Account created — signing you in…';
        msg.classList.add('show', 'success');
        btn.textContent = 'Signing in…';
        var loginRes = await fetch('/_agent-native/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: pass }),
        });
        if (loginRes.ok) {
          window.location.reload();
          return;
        }
      }
      msg.textContent = data.error || 'Registration failed';
      msg.classList.add('show', 'error');
      btn.disabled = false;
      btn.textContent = originalLabel;
    } catch (err) {
      msg.textContent = 'Network error — please try again';
      msg.classList.add('show', 'error');
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  var forgotLink = document.getElementById('forgot-link');
  var backToLogin = document.getElementById('back-to-login');
  if (forgotLink) forgotLink.addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('login-form').classList.remove('active');
    document.getElementById('forgot-form').classList.add('active');
    var fEmail = document.getElementById('f-email');
    var lEmail = document.getElementById('l-email');
    if (lEmail && lEmail.value) fEmail.value = lEmail.value;
    setTimeout(function() { fEmail.focus(); }, 0);
  });
  if (backToLogin) backToLogin.addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('forgot-form').classList.remove('active');
    document.getElementById('login-form').classList.add('active');
  });

  var forgotForm = document.getElementById('forgot-form');
  if (forgotForm) forgotForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    var btn = e.currentTarget.querySelector('button[type="submit"]');
    var msg = document.getElementById('f-msg');
    msg.classList.remove('show', 'error', 'success');
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      var email = document.getElementById('f-email').value;
      var res = await fetch('/_agent-native/auth/ba/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email }),
      });
      if (res.ok) {
        msg.textContent = 'If that email exists, a reset link is on its way.';
        msg.classList.add('show', 'success');
        btn.textContent = 'Sent';
        return;
      }
      var data = await res.json().catch(function() { return {}; });
      msg.textContent = (data && (data.message || data.error)) || 'Could not send reset email.';
      msg.classList.add('show', 'error');
      btn.disabled = false;
      btn.textContent = original;
    } catch (err) {
      msg.textContent = 'Network error — please try again';
      msg.classList.add('show', 'error');
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  document.getElementById('login-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var form = e.currentTarget;
    var btn = form.querySelector('button[type="submit"]');
    var msg = document.getElementById('l-msg');
    msg.classList.remove('show');
    var originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      var res = await fetch('/_agent-native/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('l-email').value,
          password: document.getElementById('l-pass').value,
        }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      var data = await res.json().catch(function() { return {}; });
      msg.textContent = data.error || 'Invalid email or password';
      msg.classList.add('show');
      btn.disabled = false;
      btn.textContent = originalLabel;
    } catch (err) {
      msg.textContent = 'Network error — please try again';
      msg.classList.add('show');
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });
`
}${localModeScript}
${
  showLocalMode
    ? `
  (function syncUpgradeFromLocalUi() {
    var subtitle = document.querySelector('.subtitle');
    var note = document.getElementById('upgrade-note');
    var localBtn = document.getElementById('local-btn');
    var localInfo = document.getElementById('local-info');
    var divider = document.getElementById('local-divider');
    if (!subtitle || !note || !localBtn || !localInfo || !divider) return;
    try {
      if (!localStorage.getItem('${MIGRATE_FLAG_KEY}')) return;
    } catch (e) {
      return;
    }
    subtitle.textContent = 'Sign in to upgrade your local workspace';
    note.classList.add('show');
    localBtn.textContent = 'Stay in local mode';
    localInfo.textContent = 'Use this if you want to cancel the upgrade and go back to local@localhost on this device.';
    divider.textContent = 'or stay local';
  })();
`
    : ""
}
${
  showGoogle
    ? `
  async function signInWithGoogle() {
    var btn = document.getElementById('google-btn');
    var err = document.getElementById('google-err');
    btn.disabled = true;
    err.classList.remove('show');
    try {
      var res = await fetch('/_agent-native/google/auth-url');
      var data = await res.json();
      if (data.url) {
        try { sessionStorage.setItem('__an_signin', '1'); } catch(e) {}
        window.open(data.url, '_blank');
        btn.disabled = false;
        btn.textContent = 'Waiting for sign-in…';
        var poll = setInterval(function() {
          fetch('/_agent-native/auth/session').then(function(r) { return r.json(); }).then(function(s) {
            if (s && s.email) { clearInterval(poll); window.location.reload(); }
          }).catch(function() {});
        }, 1500);
      } else {
        err.textContent = data.message || 'Google OAuth is not configured.';
        err.classList.add('show');
        btn.disabled = false;
      }
    } catch (e) {
      err.textContent = 'Failed to connect. Please try again.';
      err.classList.add('show');
      btn.disabled = false;
    }
  }`
    : ""
}
</script>
</body>
</html>`;
}

/** @deprecated Use getOnboardingHtml() instead */
export const ONBOARDING_HTML = getOnboardingHtml();

/**
 * HTML for the password reset page — shown when the user clicks the link in
 * their reset email. Posts `{ newPassword, token }` to Better Auth's
 * `/reset-password` endpoint, then redirects to the login page.
 */
export function getResetPasswordHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Reset password</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0a0a0a; color: #e5e5e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1rem; }
  .card { width: 100%; max-width: 400px; padding: 2rem; background: #141414; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; }
  h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.25rem; color: #fff; }
  .subtitle { font-size: 0.8125rem; color: #888; margin-bottom: 1.5rem; }
  label { display: block; font-size: 0.8125rem; color: #888; margin-bottom: 0.375rem; }
  input { width: 100%; padding: 0.5rem 0.75rem; background: transparent; border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; color: #e5e5e5; font-size: 0.875rem; outline: none; margin-bottom: 0.875rem; }
  input:focus { border-color: rgba(255,255,255,0.3); box-shadow: 0 0 0 1px rgba(255,255,255,0.1); }
  input::placeholder { color: #555; }
  button[type="submit"] { width: 100%; margin-top: 0.25rem; padding: 0.5rem; background: #fff; color: #000; border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
  button[type="submit"]:hover { background: #e5e5e5; }
  button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; }
  .msg { margin-top: 0.75rem; font-size: 0.8125rem; display: none; }
  .msg.error { color: #f87171; }
  .msg.success { color: #4ade80; }
  .msg.show { display: block; }
  .back { display: inline-block; margin-top: 1rem; font-size: 0.75rem; color: #888; text-decoration: none; }
  .back:hover { color: #bbb; }
</style>
</head>
<body>
<div class="card">
  <h1>Choose a new password</h1>
  <p class="subtitle">Set a new password for your account.</p>
  <form id="reset-form">
    <label for="p1">New password</label>
    <input id="p1" type="password" autocomplete="new-password" autofocus placeholder="At least 8 characters" required minlength="8" />
    <label for="p2">Confirm password</label>
    <input id="p2" type="password" autocomplete="new-password" placeholder="Confirm password" required minlength="8" />
    <button type="submit">Save new password</button>
    <p class="msg" id="msg"></p>
  </form>
  <a class="back" id="back-link" href="/">Back to sign in</a>
</div>
<script>
  (function() {
    // Derive the app's base path so apps mounted under a prefix
    // (e.g. /mail, /calendar) get sent home instead of to the root domain.
    var RESET_PATH = '/_agent-native/auth/reset';
    var pathname = window.location.pathname;
    var idx = pathname.indexOf(RESET_PATH);
    var basePath = (idx >= 0 ? pathname.slice(0, idx) : '') || '';
    var homeHref = basePath + '/';
    var backLink = document.getElementById('back-link');
    if (backLink) backLink.setAttribute('href', homeHref);
    var params = new URLSearchParams(location.search);
    var token = params.get('token') || '';
    var msg = document.getElementById('msg');
    if (!token) {
      msg.textContent = 'Missing or invalid reset token. Request a new reset link.';
      msg.classList.add('show', 'error');
      document.getElementById('reset-form').style.display = 'none';
      return;
    }
    document.getElementById('reset-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = e.currentTarget.querySelector('button[type="submit"]');
      var p1 = document.getElementById('p1').value;
      var p2 = document.getElementById('p2').value;
      msg.classList.remove('show', 'error', 'success');
      if (p1 !== p2) {
        msg.textContent = 'Passwords do not match';
        msg.classList.add('show', 'error');
        return;
      }
      var original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        var res = await fetch(basePath + '/_agent-native/auth/ba/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPassword: p1, token: token }),
        });
        if (res.ok) {
          msg.textContent = 'Password updated — redirecting to sign in…';
          msg.classList.add('show', 'success');
          setTimeout(function() { window.location.href = homeHref; }, 1200);
          return;
        }
        var data = await res.json().catch(function() { return {}; });
        msg.textContent = (data && (data.message || data.error)) || 'Reset failed. The link may have expired — request a new one.';
        msg.classList.add('show', 'error');
        btn.disabled = false;
        btn.textContent = original;
      } catch (err) {
        msg.textContent = 'Network error — please try again';
        msg.classList.add('show', 'error');
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  })();
</script>
</body>
</html>`;
}
