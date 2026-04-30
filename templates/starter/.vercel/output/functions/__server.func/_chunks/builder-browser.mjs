import{n as e}from"../_runtime.mjs";import{c as t,l as n,s as r}from"./auth.mjs";import{createHmac as i,randomBytes as a,timingSafeEqual as o}from"node:crypto";var s=e({BUILDER_CALLBACK_PATH:()=>`/_agent-native/builder/callback`,BUILDER_ENV_KEYS:()=>y,BUILDER_STATE_PARAM:()=>`_an_state`,buildBuilderCliAuthUrl:()=>h,createBuilderBrowserCallbackErrorPage:()=>S,createBuilderBrowserCallbackPage:()=>x,getBuilderApiHost:()=>m,getBuilderAppHost:()=>p,getBuilderBrowserConnectUrl:()=>g,getBuilderBrowserStatus:()=>_,getBuilderBrowserStatusForEvent:()=>v,requestBuilderBrowserConnection:()=>w,resolveSafePreviewUrl:()=>b,runBuilderAgent:()=>C,signBuilderCallbackState:()=>l,verifyBuilderCallbackState:()=>u});function c(e,t,r){return i(`sha256`,`builder-csrf:${n()}`).update(`${e}.${t}.${r}`).digest(`base64url`)}function l(e){let t=a(16).toString(`base64url`),n=Date.now(),r=Buffer.from(e,`utf8`).toString(`base64url`);return`${t}.${r}.${n}.${c(t,r,n)}`}function u(e,t){if(typeof e!=`string`||e.length===0)return!1;let n=e.split(`.`);if(n.length!==4)return!1;let[r,i,a,s]=n;if(!r||!i||!a||!s)return!1;let l;try{l=Buffer.from(i,`base64url`).toString(`utf8`)}catch{return!1}if(l!==t)return!1;let u=Number(a);if(!Number.isFinite(u)||Math.abs(Date.now()-u)>6e5)return!1;let d=Buffer.from(c(r,i,u)),f=Buffer.from(s);return d.length===f.length?o(d,f):!1}function d(e){try{let t=new URL(e),n=t.hostname.toLowerCase(),r=t.protocol===`http:`||t.protocol===`https:`,i=n===`localhost`||n===`127.0.0.1`||n===`[::1]`,a=n===`builder.io`||n.endsWith(`.builder.io`),o=n===`agent-native.com`||n.endsWith(`.agent-native.com`);return r&&(i||a||o)}catch{return!1}}function f(e){return e.replace(/\/+$/,``)}function p(){return process.env.BUILDER_APP_HOST||process.env.BUILDER_PUBLIC_APP_HOST||`https://builder.io`}function m(){return process.env.AIR_HOST||process.env.BUILDER_HOST||process.env.BUILDER_API_HOST||`https://api.builder.io`}function h(e,t=null){let n=f(e),i=r(),a=new URL(`${i}/_agent-native/builder/callback`,n);t&&a.searchParams.set(`_an_state`,t);let o=new URL(`/cli-auth`,p());return o.searchParams.set(`response_type`,`code`),o.searchParams.set(`host`,`agent-native-browser`),o.searchParams.set(`client_id`,`Agent Native Browser`),o.searchParams.set(`redirect_url`,a.toString()),o.searchParams.set(`preview_url`,`${n}${i}`),o.searchParams.set(`framework`,`agent-native`),o.toString()}function g(e){return`${f(e)}${r()}/_agent-native/builder/connect`}function _(e){return{configured:!!(process.env.BUILDER_PRIVATE_KEY&&process.env.BUILDER_PUBLIC_KEY),builderEnabled:!!process.env.ENABLE_BUILDER,appHost:p(),apiHost:m(),connectUrl:g(e),publicKeyConfigured:!!process.env.BUILDER_PUBLIC_KEY,privateKeyConfigured:!!process.env.BUILDER_PRIVATE_KEY,userId:process.env.BUILDER_USER_ID||void 0,orgName:process.env.BUILDER_ORG_NAME||void 0,orgKind:process.env.BUILDER_ORG_KIND||void 0}}function v(e){return _(t(e))}const y=[`BUILDER_PRIVATE_KEY`,`BUILDER_PUBLIC_KEY`,`BUILDER_USER_ID`,`BUILDER_ORG_NAME`,`BUILDER_ORG_KIND`];function b(e,n){return e&&d(e)?e:t(n)}function x(e){let t=JSON.stringify(e);return`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <title>Builder Connected</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(20, 184, 166, 0.18), transparent 38%),
          linear-gradient(180deg, #f7fafc 0%, #eef2f7 100%);
        color: #0f172a;
        font: 14px/1.5 ui-sans-serif, system-ui, sans-serif;
      }
      .card {
        width: min(460px, calc(100vw - 32px));
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 18px;
        padding: 28px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
      }
      h1 { margin: 0 0 8px; font-size: 22px; }
      p { margin: 0 0 12px; color: #475569; }
      a { color: #0f766e; font-weight: 600; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Builder connected</h1>
      <p>Browser access is now available to your agent-native app.</p>
      <p>You can close this tab and return to the workspace.</p>
      <p><a href=${t} target="_blank" rel="noopener noreferrer">Open the workspace</a></p>
    </main>
    <script>
      // If we're a popup opened by the app, close ourselves and let the
      // parent tab keep polling for connection status. If close() is
      // blocked (e.g. we're the top-level tab because popups were
      // downgraded), fall back to navigating back to the workspace.
      window.setTimeout(function () {
        try { window.close(); } catch (e) {}
        window.setTimeout(function () {
          if (!window.closed) {
            window.location.replace(${t});
          }
        }, 200);
      }, 700);
    <\/script>
  </body>
</html>`}function S(e){return`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <title>Builder connect failed</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(244, 63, 94, 0.14), transparent 38%),
          linear-gradient(180deg, #f7fafc 0%, #eef2f7 100%);
        color: #0f172a;
        font: 14px/1.5 ui-sans-serif, system-ui, sans-serif;
      }
      .card {
        width: min(460px, calc(100vw - 32px));
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 18px;
        padding: 28px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
      }
      h1 { margin: 0 0 8px; font-size: 22px; color: #b91c1c; }
      p { margin: 0 0 12px; color: #475569; }
      pre {
        margin: 0 0 12px;
        padding: 10px 12px;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        color: #991b1b;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-word;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Couldn't save Builder connection</h1>
      <p>Builder authorized your account but the server couldn't persist the credentials.</p>
      <pre id="msg"></pre>
      <p>You can close this tab and try again from settings. The connect dialog has the same error so you can copy it.</p>
    </main>
    <script>
      try {
        var msg = ${JSON.stringify(e)};
        document.getElementById("msg").textContent = msg;
        // Stop the parent's poll immediately. /builder/status also surfaces
        // a connectError row written by the callback so the parent picks
        // this up even if the popup closed before postMessage delivered.
        if (window.opener && !window.opener.closed) {
          try {
            window.opener.postMessage(
              { type: "builder-connect-error", message: msg },
              window.location.origin,
            );
          } catch (e) {}
        }
      } catch (e) {}
    <\/script>
  </body>
</html>`}async function C(e){let{resolveBuilderCredentials:t}=await import(`./credential-provider.mjs`).then(e=>e.t),n=await t();if(!n.privateKey||!n.publicKey)throw Error(`Builder keys are not configured`);if(!e.prompt||!e.prompt.trim())throw Error(`prompt is required`);if(!e.userEmail&&!e.userId)throw Error(`userEmail or userId is required`);let r=new URL(`/agents/run`,m());r.searchParams.set(`apiKey`,n.publicKey);let i={userMessage:{userPrompt:e.prompt}};e.projectId&&(i.projectId=e.projectId),e.branchName&&(i.branchName=e.branchName),e.userEmail&&(i.userEmail=e.userEmail),e.userId&&(i.userId=e.userId);let a=await fetch(r,{method:`POST`,headers:{Authorization:`Bearer ${n.privateKey}`,"Content-Type":`application/json`},body:JSON.stringify(i)}),o=await a.json().catch(()=>({}));if(!a.ok){let e=typeof o.error==`string`?o.error:`Builder agent run failed (${a.status})`;throw Error(e)}return{branchName:String(o.branchName??``),projectId:String(o.projectId??``),url:String(o.url??``),status:String(o.status??`processing`)}}async function w(e){let{resolveBuilderCredentials:t}=await import(`./credential-provider.mjs`).then(e=>e.t),n=await t();if(!n.privateKey||!n.publicKey)throw Error(`Builder browser access is not configured`);let r=e.sessionId?.trim();if(!r)throw Error(`sessionId is required`);let i=new URL(`/codegen/get-browser-connection`,m());i.searchParams.set(`apiKey`,n.publicKey),n.userId&&i.searchParams.set(`userId`,n.userId);let a=await fetch(i,{method:`POST`,headers:{Authorization:`Bearer ${n.privateKey}`,"Content-Type":`application/json`},body:JSON.stringify({sessionId:r,projectId:e.projectId||void 0,branchName:e.branchName||void 0,proxyOrigin:e.proxyOrigin||void 0,proxyDefaultOrigin:e.proxyDefaultOrigin||void 0,proxyDst:e.proxyDestination||void 0})}),o=await a.json().catch(()=>({}));if(!a.ok){let e=typeof o.error==`string`?o.error:`Builder browser request failed (${a.status})`;throw Error(e)}return o}export{x as a,b as c,u as d,S as i,C as l,h as n,g as o,s as r,v as s,y as t,l as u};