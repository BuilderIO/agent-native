/**
 * First-run onboarding page for agent-native apps.
 *
 * Shown when Better Auth is active and the user isn't signed in.
 * Provides two paths:
 * 1. Create account (email/password) — real identity from day one
 * 2. Use locally — sets AUTH_MODE=local for offline/solo dev
 *
 * After first account exists, this page acts as a normal login page.
 */

export const ONBOARDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0a0a0a;
    color: #e5e5e5;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
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
</style>
</head>
<body>
<div class="card">
  <h1>Welcome</h1>
  <p class="subtitle">Create an account to get started</p>

  <div class="tabs">
    <button class="tab active" data-tab="signup">Create account</button>
    <button class="tab" data-tab="login">Sign in</button>
  </div>

  <form id="signup-form" class="form active">
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
  </form>

  <div class="divider">or</div>

  <button class="btn-secondary" id="local-btn" onclick="useLocally()">Use locally without an account</button>
  <p class="local-info">Skip auth for solo local development. You can create an account later.</p>
</div>
<script>
  var tabs = document.querySelectorAll('.tab');
  var forms = document.querySelectorAll('.form');
  tabs.forEach(function(t) { t.addEventListener('click', function() {
    tabs.forEach(function(x) { x.classList.remove('active'); });
    forms.forEach(function(x) { x.classList.remove('active'); });
    t.classList.add('active');
    document.getElementById(t.dataset.tab + '-form').classList.add('active');
  }); });

  document.getElementById('signup-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var msg = document.getElementById('s-msg');
    msg.classList.remove('show', 'error', 'success');
    var pass = document.getElementById('s-pass').value;
    var pass2 = document.getElementById('s-pass2').value;
    if (pass !== pass2) {
      msg.textContent = 'Passwords do not match';
      msg.classList.add('show', 'error');
      return;
    }
    var email = document.getElementById('s-email').value;
    var res = await fetch('/_agent-native/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: pass }),
    });
    var data = await res.json().catch(function() { return {}; });
    if (res.ok) {
      msg.textContent = 'Account created — signing you in...';
      msg.classList.add('show', 'success');
      var loginRes = await fetch('/_agent-native/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: pass }),
      });
      if (loginRes.ok) {
        window.location.reload();
      }
    } else {
      msg.textContent = data.error || 'Registration failed';
      msg.classList.add('show', 'error');
    }
  });

  document.getElementById('login-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var msg = document.getElementById('l-msg');
    msg.classList.remove('show');
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
    } else {
      var data = await res.json().catch(function() { return {}; });
      msg.textContent = data.error || 'Invalid email or password';
      msg.classList.add('show');
    }
  });

  async function useLocally() {
    var btn = document.getElementById('local-btn');
    btn.disabled = true;
    btn.textContent = 'Setting up...';
    try {
      var res = await fetch('/_agent-native/auth/local-mode', { method: 'POST' });
      if (res.ok) {
        window.location.reload();
      } else {
        btn.textContent = 'Failed — try again';
        btn.disabled = false;
      }
    } catch(e) {
      btn.textContent = 'Failed — try again';
      btn.disabled = false;
    }
  }
</script>
</body>
</html>`;
