/**
 * Supabase auth plugin for macros.
 *
 * Authenticates users via Supabase Auth and stores sessions in the
 * framework's session table. One file: login page + endpoint + session.
 */
import {
  createAuthPlugin,
  addSession,
  getH3App,
  readBody,
} from "@agent-native/core/server";
import { defineEventHandler } from "h3";
import { createClient } from "@supabase/supabase-js";

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
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Sign In — Macros</title>
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
document.getElementById('f').onsubmit=async e=>{
e.preventDefault();const b=document.getElementById('b'),err=document.getElementById('e');
b.disabled=true;b.textContent='Signing in...';err.style.display='none';
try{const r=await fetch('/_agent-native/auth/supabase-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value})});
const d=await r.json();if(d.ok)window.location.href='/';else{err.textContent=d.error||'Sign in failed';err.style.display='block'}}
catch{err.textContent='Network error';err.style.display='block'}
finally{b.disabled=false;b.textContent='Sign in'}};
</script></body></html>`;

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default (nitroApp: any) => {
  const app = getH3App(nitroApp);

  app.use(
    "/_agent-native/auth/supabase-login",
    defineEventHandler(async (event) => {
      try {
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

        const maxAge = 60 * 60 * 24 * 30;
        const secure = process.env.NODE_ENV === "production";
        const cookie = `an_session=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

        return new Response(
          JSON.stringify({ ok: true, email: data.user.email }),
          {
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": cookie,
            },
          },
        );
      } catch {
        return jsonResponse({ error: "Login failed" }, 500);
      }
    }),
  );

  return createAuthPlugin({ loginHtml: LOGIN_HTML })(nitroApp);
};
