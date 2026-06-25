/**
 * Supabase auth plugin for macros.
 *
 * Authenticates users via Supabase Auth and stores sessions in the
 * framework's session table. One file: login page + endpoint + session.
 */
import {
  createAuthPlugin,
  addSession,
  clearFrameworkSessionCookies,
  getSessionEmail,
  getFrameworkSessionCookieValues,
  getH3App,
  readBody,
  setFrameworkSessionCookie,
} from "@agent-native/core/server";
import { createClient } from "@supabase/supabase-js";
import { defineEventHandler, getMethod } from "h3";

// Above a normal Neon serverless cold-wake (~1-2s) but well under both the
// core DB op timeout and Netlify's function limit, so a slow-but-fine lookup
// still resolves instead of false-timing-out on every cold start.
const SESSION_LOOKUP_TIMEOUT_MS = 4_000;

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _supabase;
}

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<title>Agent-Native Macros — Sign in</title>
<meta name="description" content="Log meals, exercises, and weight by typing or voice while the agent estimates calories and macros for you."/>
<meta property="og:title" content="Agent-Native Macros"/>
<meta property="og:description" content="Log meals, exercises, and weight by typing or voice while the agent estimates calories and macros for you."/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#e5e5e5;min-height:100vh;display:flex;align-items:center;justify-content:center}
.c{background:#171717;border:1px solid #262626;border-radius:12px;padding:40px;width:100%;max-width:400px}
h1{font-size:24px;font-weight:700;margin-bottom:8px}
.s{color:#a3a3a3;font-size:14px;margin-bottom:32px}
label{display:block;font-size:14px;color:#a3a3a3;margin-bottom:6px}
input{width:100%;padding:10px 12px;background:#0a0a0a;border:1px solid #333;border-radius:8px;color:#e5e5e5;font-size:14px;margin-bottom:16px;outline:none}
input:focus{border-color:#666}
button{width:100%;padding:12px;background:#e5e5e5;color:#0a0a0a;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
button:hover{background:#d4d4d4}button:disabled{opacity:.5;cursor:not-allowed}
.e{color:#ef4444;font-size:13px;margin-top:12px;display:none}
</style></head><body>
<div class="c"><h1>Welcome</h1><p class="s">Sign in to your account</p>
<form id="f">
<label for="email">Email</label><input type="email" id="email" required placeholder="you@example.com"/>
<label for="password">Password</label><input type="password" id="password" required/>
<button type="submit" id="b">Sign in</button><p class="e" id="e"></p>
</form></div>
<script>
function appBasePath(){var marker='/_agent-native/';var path=window.location.pathname||'';var index=path.indexOf(marker);if(index<=0)return '';return path.slice(0,index).replace(/\\/+$/,'')}
function appPath(path){return appBasePath()+path}
document.getElementById('f').onsubmit=async e=>{
e.preventDefault();const b=document.getElementById('b'),err=document.getElementById('e');
b.disabled=true;b.textContent='Signing in...';err.style.display='none';
try{const r=await fetch(appPath('/_agent-native/auth/supabase-login'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value})});
const d=await r.json();if(d.ok)window.location.href=appPath('/');else{err.textContent=d.error||'Sign in failed';err.style.display='block'}}
catch{err.textContent='Network error';err.style.display='block'}
finally{b.disabled=false;b.textContent='Sign in'}};
</script></body></html>`;

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function getSessionEmailWithTimeout(
  token: string,
): Promise<string | null | "timeout"> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getSessionEmail(token),
      new Promise<"timeout">((resolve) => {
        timeout = setTimeout(
          () => resolve("timeout"),
          SESSION_LOOKUP_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export default (nitroApp: any) => {
  const authInit = createAuthPlugin({
    loginHtml: LOGIN_HTML,
    // Resolve sessions from the framework's legacy session table, where
    // supabase-login stores them via addSession(). Providing a custom
    // getSession marks this template as BYOA — the framework will not
    // silently bypass auth in dev mode.
    getSession: async (event) => {
      const cookies = getFrameworkSessionCookieValues(event);
      if (cookies.length === 0) return null;

      for (const cookie of cookies) {
        const email = await getSessionEmailWithTimeout(cookie);
        if (email === "timeout") {
          // Transient slow/cold DB — do NOT destroy a possibly-valid
          // session. Treat this request as unauthenticated (the framework
          // serves the login page instead of hanging), but keep the cookie
          // so the next request succeeds once the DB warms.
          return null;
        }
        if (email) return { email, token: cookie };
      }

      // Every cookie resolved to a definitive "no such / expired session" —
      // safe to clear so the user isn't stuck presenting a dead cookie.
      clearFrameworkSessionCookies(event);
      return null;
    },
  })(nitroApp);

  const app = getH3App(nitroApp);
  app.use(
    "/_agent-native/auth/supabase-login",
    defineEventHandler(async (event) => {
      try {
        if (getMethod(event) !== "POST") {
          return jsonResponse({ error: "Method not allowed" }, 405);
        }

        const { email, password } = await readBody<{
          email?: string;
          password?: string;
        }>(event);

        if (!email || !password)
          return jsonResponse(
            { error: "Email and password are required" },
            400,
          );

        const supabase = getSupabase();
        if (!supabase)
          return jsonResponse({ error: "Auth is not configured" }, 500);

        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error || !data.user)
          return jsonResponse({ error: "Invalid email or password" }, 401);

        const token = globalThis.crypto.randomUUID();
        await addSession(token, data.user.email ?? email);
        setFrameworkSessionCookie(event, token);

        return { ok: true, email: data.user.email };
      } catch {
        return jsonResponse({ error: "Login failed" }, 500);
      }
    }),
  );

  return authInit;
};
