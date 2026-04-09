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
  svg { width: 20px; height: 20px; }
</style>
</head>
<body>
<div class="card">
  <h1>Sign in</h1>
  <p class="subtitle">Continue with your Atlassian account</p>
  <button id="btn" onclick="signIn()">
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="atl-g" x1="1" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#0052cc"/><stop offset="1" stop-color="#2684ff"/></linearGradient></defs><path d="M7.12 11.084a.683.683 0 00-1.16.126L.075 22.974a.703.703 0 00.63 1.018h8.19a.678.678 0 00.63-.39c1.767-3.65.696-9.203-2.406-12.52z" fill="url(#atl-g)"/><path d="M11.434.386a15.515 15.515 0 00-.906 15.317l3.95 7.9a.703.703 0 00.628.388h8.19a.703.703 0 00.63-1.017L12.63.38a.664.664 0 00-1.196.006z" fill="#2684ff"/></svg>
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
