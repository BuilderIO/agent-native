import { getCookie } from "h3";
import { createAuthPlugin } from "@agent-native/core/server";
import { getSessionEmail } from "@agent-native/core/server";

const ATLASSIAN_LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sign in</title>
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
    max-width: 360px;
    padding: 2rem;
    background: #141414;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    text-align: center;
  }
  h1 { font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem; color: #fff; }
  .subtitle { font-size: 0.8125rem; color: #888; margin-bottom: 1.5rem; }
  button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.625rem;
    padding: 0.625rem;
    background: #fff;
    color: #000;
    border: none;
    border-radius: 8px;
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
  }
  button:hover { opacity: 0.85; }
  button:disabled { opacity: 0.5; cursor: wait; }
  .error { margin-top: 0.75rem; font-size: 0.8125rem; color: #f87171; display: none; }
  .error.show { display: block; }
  svg { width: 18px; height: 18px; }
</style>
</head>
<body>
<div class="card">
  <h1>Sign in</h1>
  <p class="subtitle">Continue with your Atlassian account</p>
  <button id="btn" onclick="signIn()">
    <svg viewBox="0 0 24 24" fill="none"><path d="M7.36 20.93c-.27 0-.54-.1-.73-.33a1 1 0 0 1-.1-1.07c1.1-2.23.85-3.4-1.6-7.64C3.3 8.96 2 6.86 2 4.64A1 1 0 0 1 3.05 3.7h5.38c.38 0 .72.21.89.55 2.3 4.53 3.06 6.66 3.06 10.56 0 3.29-1.65 5.47-4.1 6.03-.3.07-.6.1-.92.1ZM16.64 20.93c2.44-.56 4.1-2.74 4.1-6.03 0-3.9-.76-6.03-3.06-10.56a1 1 0 0 0-.89-.55h-5.38a1 1 0 0 0-.95 1.33c.32.9.73 1.79 1.24 2.78 1.84 3.56 2.7 5.44 2.7 8 0 1.85-.5 3.32-1.45 4.43a1 1 0 0 0 .1 1.07c.2.23.46.33.73.33.32 0 .62-.03.92-.1l1.94-.7Z" fill="#2684FF"/></svg>
    Sign in with Atlassian
  </button>
  <p class="error" id="err"></p>
</div>
<script>
  async function signIn() {
    var btn = document.getElementById('btn');
    var err = document.getElementById('err');
    btn.disabled = true;
    err.classList.remove('show');
    try {
      var res = await fetch('/api/atlassian/auth-url');
      var data = await res.json();
      if (data.url) {
        try { sessionStorage.setItem('__an_signin', '1'); } catch(e) {}
        window.location.href = data.url;
      } else {
        err.textContent = data.message || 'Atlassian OAuth is not configured. Set ATLASSIAN_CLIENT_ID and ATLASSIAN_CLIENT_SECRET.';
        err.classList.add('show');
        btn.disabled = false;
      }
    } catch (e) {
      err.textContent = 'Failed to connect. Please try again.';
      err.classList.add('show');
      btn.disabled = false;
    }
  }
</script>
</body>
</html>`;

export default createAuthPlugin({
  getSession: async (event) => {
    const cookie = getCookie(event, "an_session");
    if (!cookie) return null;
    const email = await getSessionEmail(cookie);
    if (!email) return null;
    return { email, token: cookie };
  },
  publicPaths: ["/api/atlassian/callback", "/api/atlassian/auth-url"],
  loginHtml: ATLASSIAN_LOGIN_HTML,
});
