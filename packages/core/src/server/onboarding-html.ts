/**
 * First-run onboarding page for agent-native apps.
 *
 * Shown when Better Auth is active and the user isn't signed in.
 * Provides a path to create or sign into an account from day one.
 *
 * After first account exists, this page acts as a normal login page.
 */

import { getPublicOAuthOrigin } from "./oauth-public-origin.js";
import {
  resolveGoogleAuthMode,
  type GoogleAuthMode,
} from "./google-auth-mode.js";
import { getWorkspaceGatewayReturnOrigin } from "./oauth-return-url.js";

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

function normalizeAppBasePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function withAppBasePath(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const basePath = normalizeAppBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
  return `${basePath}${cleanPath}`;
}

export interface OnboardingHtmlOptions {
  /**
   * Hide email/password forms and show ONLY the Google sign-in button.
   * Useful for templates (mail, calendar) where Google is required anyway.
   * If Google OAuth env vars are not configured, an error message is shown.
   */
  googleOnly?: boolean;
  /**
   * Product marketing content shown alongside the sign-in form.
   * When provided, the page uses a split layout: marketing on the left,
   * sign-in form on the right (stacked on mobile).
   */
  marketing?: {
    appName: string;
    tagline: string;
    description?: string;
    features?: string[];
    runLocalCommand?: string;
  };
  /**
   * Optional preflight copy shown before redirecting through Google sign-in.
   * Use this when a hosted app needs to warn about provider-specific consent
   * screens while leaving self-hosted deployments untouched.
   */
  googleSignInNotice?: {
    host?: string;
    title: string;
    body: string | string[];
    continueLabel?: string;
    cancelLabel?: string;
  };
  /**
   * Google sign-in flow: `'popup'`, `'redirect'`, or `'auto'` (default).
   * Falls back to `GOOGLE_AUTH_MODE` env var, then `'auto'`. Builder web
   * iframes use popup; Builder desktop preview/editor surfaces use redirect.
   */
  googleAuthMode?: GoogleAuthMode;
}

export function getOnboardingHtml(opts: OnboardingHtmlOptions = {}): string {
  const showGoogle = hasGoogleOAuth();
  const googleOnly = !!opts.googleOnly;
  const appBasePath = normalizeAppBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
  const publicOAuthOrigin = getPublicOAuthOrigin();
  const workspaceGatewayReturnOrigin = getWorkspaceGatewayReturnOrigin();
  const googleAuthMode = resolveGoogleAuthMode(opts.googleAuthMode);

  const marketing = opts.marketing;
  const hasMarketing = !!marketing;
  const runLocalCommand = marketing?.runLocalCommand?.trim();
  const brandMarkSrc = withAppBasePath("/agent-native-icon-dark.svg");
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const googleSignInNotice = opts.googleSignInNotice;
  const googleNoticeBodyHtml = googleSignInNotice
    ? (Array.isArray(googleSignInNotice.body)
        ? googleSignInNotice.body
        : [googleSignInNotice.body]
      )
        .filter((body) => body.trim().length > 0)
        .map(
          (body, index) =>
            `<p class="google-preflight-copy"${index === 0 ? ' id="google-preflight-copy"' : ""}>${esc(body)}</p>`,
        )
        .join("\n")
    : "";
  const googleNoticeHtml =
    showGoogle && googleSignInNotice
      ? `
  <div
    class="google-preflight"
    id="google-preflight"
    data-host="${esc(googleSignInNotice.host ?? "")}"
    role="dialog"
    aria-labelledby="google-preflight-title"
    aria-describedby="google-preflight-copy"
  >
    <p class="google-preflight-title" id="google-preflight-title">${esc(googleSignInNotice.title)}</p>
${googleNoticeBodyHtml}
    <div class="google-preflight-actions">
      <button type="button" class="btn-primary" id="google-preflight-continue" onclick="__anAcceptGoogleNotice()">${esc(googleSignInNotice.continueLabel ?? "Continue")}</button>
      <button type="button" class="btn-secondary" onclick="__anHideGoogleNotice()">${esc(googleSignInNotice.cancelLabel ?? "Cancel")}</button>
    </div>
  </div>`
      : "";

  const marketingStyles = hasMarketing
    ? `
  body.has-marketing { padding: 0; position: relative; overflow-x: hidden; }
  #starfield {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0.35;
    pointer-events: none;
    z-index: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    #starfield { opacity: 0.18; }
  }
  .split {
    position: relative;
    z-index: 1;
    display: flex;
    min-height: 100vh;
    width: 100%;
    max-width: 1100px;
    margin: 0 auto;
  }
  .marketing-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 3rem 3.5rem;
  }
  .marketing-content { max-width: 480px; }
  .app-name {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    font-size: 2rem;
    font-weight: 700;
    color: #fff;
    margin-bottom: 0.625rem;
    letter-spacing: -0.02em;
  }
  .app-name img.brand-mark {
    height: 2.21375rem;
    width: auto;
    display: block;
    flex-shrink: 0;
  }
  .app-tagline {
    font-size: 1.25rem;
    color: #a1a1aa;
    line-height: 1.6;
    margin-bottom: 2rem;
  }
  .app-desc {
    font-size: 1rem;
    color: #71717a;
    line-height: 1.6;
    margin-bottom: 2rem;
  }
  .feature-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }
  .feature-list li {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    font-size: 1rem;
    color: #a1a1aa;
    line-height: 1.5;
  }
  .feature-list li::before {
    content: '';
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    margin-top: 6px;
    border-radius: 50%;
    background: #3f3f46;
    border: 1px solid #52525b;
  }
  .oss-link {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
    color: #71717a;
    text-decoration: none;
  }
  .oss-link:hover { color: #a1a1aa; }
  .oss-link svg { width: 15px; height: 15px; flex-shrink: 0; }
  .marketing-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin-top: 2rem;
  }
  .run-local-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 2.25rem;
    padding: 0.5rem 0.875rem;
    background: rgba(255,255,255,0.08);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.14);
    border-radius: 8px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
  }
  .run-local-button:hover {
    background: rgba(255,255,255,0.12);
    border-color: rgba(255,255,255,0.24);
  }
  .run-local-panel {
    max-width: 480px;
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: rgba(20,20,20,0.86);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    box-shadow: 0 14px 36px rgba(0,0,0,0.28);
  }
  .run-local-panel[hidden] { display: none; }
  .run-local-panel code {
    display: block;
    overflow-x: auto;
    padding-bottom: 0.125rem;
    color: #e5e5e5;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 0.75rem;
    line-height: 1.5;
    white-space: nowrap;
  }
  .copy-run-local {
    margin-top: 0.625rem;
    padding: 0.375rem 0.625rem;
    background: transparent;
    color: #a1a1aa;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .copy-run-local:hover { color: #fff; border-color: rgba(255,255,255,0.22); }
  .form-panel {
    flex: 0 0 440px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }
  .form-panel .card { max-width: 400px; }
  .form-panel .local-note { max-width: 400px; }
  @media (max-width: 900px) {
    .split { flex-direction: column; min-height: auto; }
    .marketing-panel { padding: 2rem 1.5rem 1.5rem; }
    .app-name { font-size: 1.375rem; }
    .app-name img.brand-mark { height: 1.58125rem; }
    .app-tagline { font-size: 1rem; margin-bottom: 1rem; }
    .app-desc { margin-bottom: 1rem; }
    .feature-list { gap: 0.5rem; }
    .form-panel { flex: none; padding: 1.5rem 1rem; }
  }
`
    : "";

  const marketingPanelHtml = hasMarketing
    ? `<canvas id="starfield"></canvas>
<div class="split">
  <div class="marketing-panel">
    <div class="marketing-content">
      <h2 class="app-name">
        <img class="brand-mark" src="${esc(brandMarkSrc)}" alt="" aria-hidden="true" />
        <span>${esc(marketing!.appName)}</span>
      </h2>
      <p class="app-tagline">${esc(marketing!.tagline)}</p>
${marketing!.description ? `      <p class="app-desc">${esc(marketing!.description)}</p>\n` : ""}${
        marketing!.features?.length
          ? `      <ul class="feature-list">\n${marketing!.features.map((f) => `        <li>${esc(f)}</li>`).join("\n")}\n      </ul>\n`
          : ""
      }      <div class="marketing-actions">
${runLocalCommand ? `        <button type="button" class="run-local-button" id="run-local-button" aria-expanded="false" aria-controls="run-local-panel" onclick="__anToggleRunLocalCommand()">Run Locally</button>\n` : ""}        <a class="oss-link" href="https://github.com/BuilderIO/agent-native" target="_blank" rel="noreferrer">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 00-1.3-3.2 4.2 4.2 0 00-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 00-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 00-.1 3.2A4.6 4.6 0 004 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/></svg>
        Open source
      </a>
      </div>
${
  runLocalCommand
    ? `      <div class="run-local-panel" id="run-local-panel" hidden data-command="${esc(runLocalCommand)}">
        <code>${esc(runLocalCommand)}</code>
        <button type="button" class="copy-run-local" id="copy-run-local" onclick="__anCopyRunLocalCommand()">Copy command</button>
      </div>\n`
    : ""
}
    </div>
  </div>
  <div class="form-panel">`
    : "";

  const marketingCloseHtml = hasMarketing ? `\n  </div>\n</div>` : "";

  const starfieldScript = hasMarketing
    ? `
  (function initStarfield() {
    var canvas = document.getElementById('starfield');
    if (!canvas) return;
    var gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) return;

    var vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, 'attribute vec2 position;void main(){gl_Position=vec4(position,0.0,1.0);}');
    gl.compileShader(vs);

    var fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, [
      'precision highp float;',
      'uniform float iTime;uniform vec2 iResolution;',
      '#define S(a,b,t) smoothstep(a,b,t)',
      '#define NUM_LAYERS 4.',
      'float N21(vec2 p){vec3 a=fract(vec3(p.xyx)*vec3(213.897,653.453,253.098));a+=dot(a,a.yzx+79.76);return fract((a.x+a.y)*a.z);}',
      'vec2 GetPos(vec2 id,vec2 offs,float t){float n=N21(id+offs);float n1=fract(n*10.);float n2=fract(n*100.);float a=t+n;return offs+vec2(sin(a*n1),cos(a*n2))*.4;}',
      'float df_line(vec2 a,vec2 b,vec2 p){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}',
      'float line(vec2 a,vec2 b,vec2 uv){float r1=.025;float r2=.006;float d=df_line(a,b,uv);float d2=length(a-b);float fade=S(1.5,.5,d2);fade+=S(.05,.02,abs(d2-.75));return S(r1,r2,d)*fade;}',
      'float NetLayer(vec2 st,float n,float t){',
      '  vec2 id=floor(st)+n;st=fract(st)-.5;',
      '  vec2 p0=GetPos(id,vec2(-1,-1),t);vec2 p1=GetPos(id,vec2(0,-1),t);vec2 p2=GetPos(id,vec2(1,-1),t);',
      '  vec2 p3=GetPos(id,vec2(-1,0),t);vec2 p4=GetPos(id,vec2(0,0),t);vec2 p5=GetPos(id,vec2(1,0),t);',
      '  vec2 p6=GetPos(id,vec2(-1,1),t);vec2 p7=GetPos(id,vec2(0,1),t);vec2 p8=GetPos(id,vec2(1,1),t);',
      '  float m=0.;float sparkle=0.;float d;float s;float pulse;',
      '  m+=line(p4,p0,st);d=length(st-p0);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p0.x)+fract(p0.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p1,st);d=length(st-p1);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p1.x)+fract(p1.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p2,st);d=length(st-p2);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p2.x)+fract(p2.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p3,st);d=length(st-p3);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p3.x)+fract(p3.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p4,st);d=length(st-p4);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p4.x)+fract(p4.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p5,st);d=length(st-p5);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p5.x)+fract(p5.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p6,st);d=length(st-p6);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p6.x)+fract(p6.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p7,st);d=length(st-p7);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p7.x)+fract(p7.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p8,st);d=length(st-p8);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p8.x)+fract(p8.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p1,p3,st);m+=line(p1,p5,st);m+=line(p7,p5,st);m+=line(p7,p3,st);',
      '  float sPhase=(sin(t+n)+sin(t*.1))*.25+.5;sPhase+=pow(sin(t*.1)*.5+.5,50.)*5.;m+=sparkle*sPhase;',
      '  return m;',
      '}',
      'void mainImage(out vec4 fragColor,in vec2 fragCoord){',
      '  vec2 uv=(fragCoord-iResolution.xy*.5)/iResolution.y;',
      '  float t=iTime*.03;float s=sin(t);float c=cos(t);mat2 rot=mat2(c,-s,s,c);vec2 st=uv*rot;',
      '  float m=0.;',
      '  for(float i=0.;i<1.;i+=1./NUM_LAYERS){float z=fract(t+i);float size=mix(15.,1.,z);float fade=S(0.,.6,z)*S(1.,.8,z);m+=fade*NetLayer(st*size,i,iTime*0.3);}',
      '  vec3 col=vec3(0.35)*m;col*=1.-dot(uv,uv);',
      '  float tt=min(iTime,5.0);col*=S(0.,20.,tt);',
      '  col=clamp(col,0.,1.);fragColor=vec4(col,1.);',
      '}',
      'void main(){mainImage(gl_FragColor,gl_FragCoord.xy);}'
    ].join('\\n'));
    gl.compileShader(fs);

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    var pos = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    var uTime = gl.getUniformLocation(prog, 'iTime');
    var uRes = gl.getUniformLocation(prog, 'iResolution');
    var reducedMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reducedMotion = reducedMotionQuery ? reducedMotionQuery.matches : false;

    function resize() {
      var w = window.innerWidth, h = window.innerHeight;
      var dpr = Math.min(window.devicePixelRatio, 1.5);
      canvas.width = w * dpr; canvas.height = h * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener('resize', resize);

    var start = performance.now(), last = 0, raf = 0, reducedMotionStaticTime = 20;
    function draw(timeSeconds) {
      gl.uniform1f(uTime, timeSeconds);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    function render(now) {
      if (reducedMotion) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(render);
      if (now - last < 33) return;
      last = now;
      draw((now - start) * 0.001);
    }
    function startAnimation() {
      if (!raf) raf = requestAnimationFrame(render);
    }
    function stopAnimation() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }
    function onReducedMotionChange() {
      reducedMotion = reducedMotionQuery ? reducedMotionQuery.matches : false;
      if (reducedMotion) {
        stopAnimation();
        last = 0;
        draw(reducedMotionStaticTime);
      } else {
        startAnimation();
      }
    }
    draw(reducedMotion ? reducedMotionStaticTime : 0);
    if (reducedMotionQuery) {
      if (reducedMotionQuery.addEventListener) {
        reducedMotionQuery.addEventListener('change', onReducedMotionChange);
      } else {
        reducedMotionQuery.addListener(onReducedMotionChange);
      }
    }
    if (!reducedMotion) startAnimation();
  })();`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>${hasMarketing ? esc(marketing!.appName) + " — Sign in" : "Welcome"}</title>
<link rel="icon" type="image/svg+xml" href="${withAppBasePath("/favicon.svg")}">
<link rel="apple-touch-icon" href="${withAppBasePath("/icon-180.svg")}">
${
  hasMarketing
    ? `<meta name="description" content="${esc(marketing!.tagline)}">
<meta property="og:title" content="${esc(marketing!.appName)}">
<meta property="og:description" content="${esc(marketing!.tagline)}">`
    : ""
}
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
  .card.verifying .tabs,
  .card.verifying #google-btn,
  .card.verifying #google-err,
  .card.verifying #auth-divider,
  .card.verifying #upgrade-note {
    display: none;
  }
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
  .step-progress {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
    margin-bottom: 1.25rem;
  }
  .progress-step {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    color: #666;
    font-size: 0.6875rem;
    line-height: 1.2;
    text-align: center;
  }
  .progress-step::before {
    content: '';
    position: absolute;
    top: 11px;
    left: calc(-50% + 16px);
    width: calc(100% - 32px);
    height: 1px;
    background: rgba(255,255,255,0.1);
  }
  .progress-step:first-child::before { display: none; }
  .progress-step span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.14);
    background: #151515;
    color: #777;
    font-size: 0.6875rem;
    font-weight: 600;
  }
  .progress-step strong { font-weight: 500; }
  .progress-step.complete,
  .progress-step.current { color: #e5e5e5; }
  .progress-step.complete span {
    background: #d9f99d;
    border-color: #d9f99d;
    color: #111;
  }
  .progress-step.current span {
    background: #fff;
    border-color: #fff;
    color: #000;
    box-shadow: 0 0 0 4px rgba(255,255,255,0.08);
  }
  .verification-panel {
    padding: 1rem;
    margin-bottom: 0.875rem;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
  }
  .verification-kicker {
    margin-bottom: 0.5rem;
    color: #bef264;
    font-size: 0.75rem;
    font-weight: 500;
  }
  .verification-copy {
    color: #d4d4d8;
    font-size: 0.875rem;
    line-height: 1.55;
  }
  .verification-copy strong {
    color: #fff;
    font-weight: 600;
    word-break: break-word;
  }
  .verification-note {
    margin-top: 0.75rem;
    color: #71717a;
    font-size: 0.75rem;
    line-height: 1.45;
  }
  .inline-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: 0.75rem;
  }
  .link-button {
    padding: 0.25rem 0;
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    font-size: 0.75rem;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link-button:hover { color: #bbb; }
  .link-button:disabled { cursor: wait; opacity: 0.5; }
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
  .google-debug {
    display: none;
    margin-top: 0.5rem;
    font-size: 0.6875rem;
    line-height: 1.45;
    color: #777;
    word-break: break-word;
  }
  .google-debug.show { display: block; }
  .google-preflight {
    display: none;
    margin-top: 0.75rem;
    padding: 0.875rem;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    background: rgba(255,255,255,0.05);
    box-shadow: 0 14px 36px rgba(0,0,0,0.28);
  }
  .google-preflight.show { display: block; }
  .google-preflight-title {
    margin-bottom: 0.375rem;
    color: #fff;
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .google-preflight-copy {
    color: #b4b4b8;
    font-size: 0.75rem;
    line-height: 1.55;
  }
  .google-preflight-copy + .google-preflight-copy { margin-top: 0.5rem; }
  .google-preflight-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.875rem;
  }
  .google-preflight-actions .btn-primary,
  .google-preflight-actions .btn-secondary {
    flex: 1;
    width: auto;
    margin-top: 0;
  }
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
  .local-note a { color: #888; text-decoration: none; }
  .local-note a:hover { color: #bbb; }
${marketingStyles}
</style>
</head>
<body${hasMarketing ? ' class="has-marketing"' : ""}>
${marketingPanelHtml}
<div class="card">
  <h1 id="heading">${googleOnly ? "Sign in" : "Welcome"}</h1>
  <p class="subtitle" id="subtitle">${googleOnly ? "Use your workspace Google account to continue" : "Create an account to get started"}</p>
  <p
    class="upgrade-note"
    id="upgrade-note"
    data-upgrade-copy="Continue signing in to attach this app to your account and migrate local data."
  ></p>

${
  showGoogle
    ? `
  <button class="btn-google" id="google-btn" onclick="signInWithGoogle()">
    <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
    Sign in with Google
  </button>
  <p class="google-error" id="google-err"></p>
  <p class="google-debug" id="google-debug"></p>
${googleNoticeHtml}
${googleOnly ? "" : `\n  <div class="divider" id="auth-divider">or</div>\n`}
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

    <div id="verification-step" class="form verification-step" aria-live="polite">
      <div class="step-progress" aria-label="Signup progress">
        <div class="progress-step complete"><span>1</span><strong>Account</strong></div>
        <div class="progress-step current"><span>2</span><strong>Verify</strong></div>
        <div class="progress-step"><span>3</span><strong>Start</strong></div>
      </div>
      <div class="verification-panel">
        <p class="verification-kicker">Verification email sent</p>
        <p class="verification-copy">We sent a secure link to <strong id="verify-email"></strong>. Click it, return here, and this app will finish signing you in automatically.</p>
        <p class="verification-note">You can keep this tab open. If it has not refreshed after you come back, use Continue.</p>
      </div>
      <button type="button" class="btn-primary" id="verify-continue">Continue</button>
      <div class="inline-actions">
        <button type="button" class="link-button" id="resend-verification">Resend email</button>
        <button type="button" class="link-button" id="back-to-signup">Back</button>
      </div>
      <p class="msg" id="verify-msg"></p>
    </div>

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
</div>
<p class="local-note" id="local-note">
  Your account is stored in this app's own DB (<strong>${getConnectionLabel()}</strong>), not a third-party service.
</p>${marketingCloseHtml}
<script>
  function __anBasePath() {
    var configured = ${JSON.stringify(appBasePath)};
    if (configured) return configured;
    var marker = '/_agent-native';
    var idx = window.location.pathname.indexOf(marker);
    return idx > 0 ? window.location.pathname.slice(0, idx) : '';
  }
    function __anPath(path) {
      return __anBasePath() + path;
    }
    var __AN_PUBLIC_OAUTH_ORIGIN = ${JSON.stringify(publicOAuthOrigin)};
    var __AN_WORKSPACE_GATEWAY_RETURN_ORIGIN = ${JSON.stringify(workspaceGatewayReturnOrigin)};
    var __AN_GOOGLE_AUTH_MODE = ${JSON.stringify(googleAuthMode)};
    function __anConfiguredOAuthOrigin() {
      if (!__AN_PUBLIC_OAUTH_ORIGIN) return '';
      try {
        var origin = new URL(__AN_PUBLIC_OAUTH_ORIGIN).origin;
        return origin && origin !== window.location.origin ? origin : '';
      } catch(e) {
        return '';
      }
    }
    function __anAuthPath(path) {
      var origin = __anIsBuilderPreview() ? __anConfiguredOAuthOrigin() : '';
      return origin ? origin + path : __anPath(path);
    }
    function __anGoogleAuthUrlPath() {
      return __anIsBuilderPreview()
        ? __anAuthPath('/_agent-native/google/auth-url')
        : __anPath('/_agent-native/google/auth-url');
    }
    function __anBuilderPreviewReturnOrigin() {
      var candidates = [window.location.href, document.referrer || ''];
      try {
        if (window.location.ancestorOrigins) {
          for (var j = 0; j < window.location.ancestorOrigins.length; j++) {
            candidates.push(window.location.ancestorOrigins[j]);
          }
        }
      } catch(e) {}
      for (var i = 0; i < candidates.length; i++) {
        try {
          var url = new URL(candidates[i]);
          var host = url.hostname.toLowerCase();
          var isPreviewHost =
            host === 'builderio.xyz' || host.slice(-14) === '.builderio.xyz' ||
            host === 'builderio.dev' || host.slice(-14) === '.builderio.dev' ||
            host === 'builder.codes' || host.slice(-14) === '.builder.codes' ||
            host === 'builder.my' || host.slice(-11) === '.builder.my';
          if (url.protocol === 'https:' && isPreviewHost) return url.origin;
        } catch(e) {}
      }
      return '';
    }
    function __anWorkspaceGatewayReturnOrigin() {
      var previewOrigin = __anBuilderPreviewReturnOrigin();
      if (previewOrigin) return previewOrigin;
      if (__AN_WORKSPACE_GATEWAY_RETURN_ORIGIN) return __AN_WORKSPACE_GATEWAY_RETURN_ORIGIN;
      return __anIsBuilderDesktop() ? 'http://127.0.0.1:8080' : '';
    }
    function __anNormalizeWorkspaceReturnPath(ret) {
      try {
        var url = new URL(ret || '/', window.location.origin);
        var path = url.pathname || '/';
        if (path === '/dispatch/dispatch') {
          path = '/dispatch';
        } else if (path.indexOf('/dispatch/') === 0) {
          var rest = path.slice('/dispatch/'.length);
          var first = rest.split('/')[0];
          var dispatchRoutes = {
            overview: true, apps: true, metrics: true, vault: true,
            integrations: true, messaging: true, workspace: true,
            agents: true, destinations: true, identities: true,
            approvals: true, audit: true, team: true, 'thread-debug': true,
            'new-app': true
          };
          if (first === 'dispatch') {
            path = '/dispatch' + rest.slice(first.length);
          } else if (first && !dispatchRoutes[first]) {
            path = '/' + rest;
          }
        }
        return path + url.search + url.hash;
      } catch(e) {
        return ret || '/';
      }
    }
    function __anOAuthReturnTarget(ret) {
      var path = __anNormalizeWorkspaceReturnPath(ret);
      var origin = __anWorkspaceGatewayReturnOrigin();
      return origin ? origin + path : path;
    }
    function __anSessionBridgeUrl(ret, sessionToken) {
      try {
        var url = new URL(ret || window.location.pathname + window.location.search, window.location.origin);
        url.searchParams.set('_session', sessionToken);
        return url.pathname + url.search + url.hash;
      } catch(e) {
        var sep = (ret || '/').indexOf('?') === -1 ? '?' : '&';
        return (ret || '/') + sep + '_session=' + encodeURIComponent(sessionToken);
      }
    }
    function __anFinishOAuthExchange(ret, flowId, sessionToken) {
      if (__anIsBuilderPreview()) {
        if (sessionToken) {
          __anSetOAuthDebug('OAuth exchange redeemed; applying session bridge to embedded app', flowId);
          window.location.replace(__anSessionBridgeUrl(ret, sessionToken));
          return;
        }
        __anSetOAuthDebug('OAuth exchange redeemed; reloading the embedded app', flowId);
        window.location.reload();
        return;
      }
      __anSetOAuthDebug('OAuth exchange redeemed; returning to the app', flowId);
      window.location.href = ret || '/';
    }
    function __anGetReturnPath() {
      try {
        var inner = new URLSearchParams(window.location.search).get('return');
        if (inner) return inner;
      } catch(e) {}
      return window.location.pathname + window.location.search;
    }
    var __anBuilderPreviewSeen = false;
    function __anRememberBuilderPreview() {
      __anBuilderPreviewSeen = true;
      try { sessionStorage.setItem('__an_builder_preview_seen', '1'); } catch(e) {}
    }
    function __anHasBuilderPreviewSignal() {
      try {
        var params = new URLSearchParams(window.location.search);
        if (params.has('builder.preview') || params.has('builder.frameEditing') || params.has('__builder_editing__')) return true;
      } catch(e) {}
      return false;
    }
    function __anIsBuilderPreview() {
      if (__anBuilderPreviewSeen) return true;
      if (__anHasBuilderPreviewSignal()) {
        __anRememberBuilderPreview();
        return true;
      }
      try {
        if (sessionStorage.getItem('__an_builder_preview_seen') === '1') {
          __anBuilderPreviewSeen = true;
          return true;
        }
      } catch(e) {}
      try {
        var ref = document.referrer || '';
        var fromBuilder = ref.indexOf('builder.io') !== -1 || ref.indexOf('builder.my') !== -1 || ref.indexOf('builderio.xyz') !== -1 || ref.indexOf('builderio.dev') !== -1 || ref.indexOf('builder.codes') !== -1;
        if (fromBuilder) __anRememberBuilderPreview();
        return fromBuilder;
      } catch(e) {
        return false;
      }
    }
    __anIsBuilderPreview();
    function __anIsBuilderDesktop() {
      try {
        var ua = navigator.userAgent || '';
        return ua.indexOf('Electron') !== -1 && ua.indexOf('AgentNativeDesktop') === -1;
      } catch(e) {
        return false;
      }
    }
    function __anIsAgentNativeDesktop() {
      try {
        return (navigator.userAgent || '').indexOf('AgentNativeDesktop') !== -1;
      } catch(e) {
        return false;
      }
    }
    function __anIsElectron() {
      try {
        return (navigator.userAgent || '').indexOf('Electron') !== -1;
      } catch(e) {
        return false;
      }
    }
    function __anResolveAuthFlow() {
      if (__anIsBuilderPreview()) return __anIsBuilderDesktop() ? 'redirect' : 'popup';
      // Per-session override for ad-hoc testing outside Builder: append
      // ?authMode=popup or ?authMode=redirect to the sign-in URL.
      try {
        var qp = new URLSearchParams(window.location.search).get('authMode');
        if (qp === 'popup' || qp === 'redirect') return qp;
      } catch(e) {}
      var mode = __AN_GOOGLE_AUTH_MODE || 'auto';
      if (mode === 'popup') return 'popup';
      if (mode === 'redirect') return 'redirect';
      return __anIsElectron() ? 'redirect' : 'popup';
    }
    var __anOAuthPollTimer = null;
    var __anOAuthPollCount = 0;
    function __anNewOAuthFlowId() {
      try {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
          return window.crypto.randomUUID();
        }
      } catch(e) {}
      return 'builder-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }
    function __anFlowDebugId(flowId) {
      return flowId ? String(flowId).slice(-10) : '';
    }
    function __anSetOAuthDebug(message, flowId) {
      var text = message + (flowId ? ' (flow ' + __anFlowDebugId(flowId) + ')' : '');
      try {
        console.info('[agent-native][google-oauth] ' + text);
      } catch(e) {}
      // Only surface the debug overlay when explicitly opted in via #oauth-debug
      // hash or ?oauth_debug=1 query — otherwise it leaks raw flow IDs and
      // diagnostic strings into the user-facing sign-in screen.
      var showDebugOverlay = false;
      try {
        var loc = window.location || {};
        showDebugOverlay =
          (typeof loc.hash === 'string' && loc.hash.indexOf('oauth-debug') !== -1) ||
          (typeof loc.search === 'string' && loc.search.indexOf('oauth_debug=1') !== -1);
      } catch(e) {}
      var debug = document.getElementById('google-debug');
      if (debug) {
        debug.textContent = text;
        if (showDebugOverlay) debug.classList.add('show');
      }
    }
    function __anShowOAuthError(err, btn, message) {
      if (__anOAuthPollTimer) {
        clearInterval(__anOAuthPollTimer);
        __anOAuthPollTimer = null;
      }
      err.textContent = message;
      err.classList.add('show');
      btn.disabled = false;
    }
    function __anWaitForOAuthExchange(flowId, ret, btn, err) {
      var started = Date.now();
      var timeoutMs = 5 * 60 * 1000;
      __anOAuthPollCount = 0;
      async function check() {
        __anOAuthPollCount++;
        try {
          var res = await fetch(__anPath('/_agent-native/auth/desktop-exchange') + '?flow_id=' + encodeURIComponent(flowId), { credentials: 'include' });
          var data = await res.json().catch(function() { return {}; });
          if (data && (data.email || data.token)) {
            if (__anOAuthPollTimer) clearInterval(__anOAuthPollTimer);
            __anOAuthPollTimer = null;
            __anFinishOAuthExchange(ret, flowId, data.token);
            return;
          }
          if (data && data.error) {
            __anSetOAuthDebug('OAuth exchange returned an error: ' + (data.message || data.error), flowId);
            __anShowOAuthError(err, btn, data.message || data.error);
            return;
          }
          if (data && data.pending && (__anOAuthPollCount === 1 || __anOAuthPollCount % 5 === 0)) {
            __anSetOAuthDebug('Waiting for the Google callback; polling attempt ' + __anOAuthPollCount, flowId);
          }
        } catch(e) {
          if (__anOAuthPollCount === 1 || __anOAuthPollCount % 5 === 0) {
            __anSetOAuthDebug('Could not reach the OAuth exchange endpoint: ' + (e && e.message ? e.message : 'network error'), flowId);
          }
        }
        if (Date.now() - started > timeoutMs) {
          __anShowOAuthError(err, btn, 'Google sign-in did not finish. Flow ' + __anFlowDebugId(flowId) + ' never reached this app. Check the Google OAuth redirect URI and server logs for [agent-native][google-oauth].');
        }
      }
      if (__anOAuthPollTimer) clearInterval(__anOAuthPollTimer);
      __anOAuthPollTimer = setInterval(check, 1000);
      setTimeout(check, 500);
    }
    function __anStartPopupOAuth(ret, btn, err) {
      var flowId = __anNewOAuthFlowId();
      var oauthReturn = __anIsBuilderPreview() ? __anOAuthReturnTarget(ret) : ret;
      var params = new URLSearchParams();
      if (oauthReturn) params.set('return', oauthReturn);
      params.set('desktop', '1');
      params.set('flow_id', flowId);
      params.set('redirect', '1');
      var url = __anGoogleAuthUrlPath() + '?' + params.toString();
      try { sessionStorage.setItem('__an_signin', '1'); } catch(e) {}
      __anSetOAuthDebug('Opening Google sign-in popup', flowId);
      try {
        var popup = window.open('', '_blank', 'width=640,height=760');
        if (!popup) {
          __anShowOAuthError(err, btn, 'Google popup was blocked. Allow popups for this site and try again (flow ' + __anFlowDebugId(flowId) + ').');
          return;
        }
        try { popup.opener = null; } catch(e) {}
        try {
          popup.location.href = url;
        } catch(e) {
          try { popup.close(); } catch(closeErr) {}
          __anShowOAuthError(err, btn, 'Could not navigate Google popup for flow ' + __anFlowDebugId(flowId) + ': ' + (e && e.message ? e.message : 'unknown error'));
          return;
        }
        __anSetOAuthDebug('Google popup opened; waiting for callback', flowId);
      } catch(e) {
        __anShowOAuthError(err, btn, 'Could not open Google popup for flow ' + __anFlowDebugId(flowId) + ': ' + (e && e.message ? e.message : 'unknown error'));
        return;
      }
      __anWaitForOAuthExchange(flowId, ret, btn, err);
    }
    function __anStartNativeDesktopOAuth(ret, btn, err) {
      var flowId = __anNewOAuthFlowId();
      var params = new URLSearchParams();
      if (ret) params.set('return', ret);
      params.set('desktop', '1');
      params.set('flow_id', flowId);
      params.set('redirect', '1');
      var url = __anGoogleAuthUrlPath() + '?' + params.toString();
      __anSetOAuthDebug('Opening Google sign-in in system browser', flowId);
      __anOpenOAuthUrl(url);
      __anWaitForOAuthExchange(flowId, ret, btn, err);
    }
    function __anOpenOAuthUrl(url) {
      try { sessionStorage.setItem('__an_signin', '1'); } catch(e) {}
      window.location.href = url;
    }
    (function revealLocalNote() {
    var h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) {
      var n = document.getElementById('local-note');
      if (n) n.classList.add('show');
    }
  })();
  (function revealUpgradeNote() {
    var shouldShow = false;
    try {
      var params = new URLSearchParams(location.search);
      shouldShow = params.get('signin') === '1' || params.get('upgrade-from-local') === '1';
    } catch(e) {}
    if (!shouldShow) {
      try { shouldShow = localStorage.getItem('an_migrate_from_local') === '1'; } catch(e) {}
    }
    if (!shouldShow) return;
    var n = document.getElementById('upgrade-note');
    if (!n) return;
    n.textContent = n.getAttribute('data-upgrade-copy') || 'Continue signing in to migrate local data.';
    n.classList.add('show');
  })();
${
  googleOnly
    ? ""
    : `  var TAB_STORAGE_KEY = 'an.onboarding.tab';
    var tabs = document.querySelectorAll('.tab');
    var forms = document.querySelectorAll('.form');
    var subtitles = { signup: 'Create an account to get started', login: 'Sign in to your account' };
    var headings = { signup: 'Welcome', login: 'Welcome back' };
    var pendingSignupEmail = '';
    var pendingSignupPassword = '';
    var verificationCheckInFlight = false;
    function setActiveTab(name, opts) {
      if (name !== 'signup' && name !== 'login') return;
      var form = document.getElementById(name + '-form');
      if (!form) return;
      var card = document.querySelector('.card');
      if (card) card.classList.remove('verifying');
      tabs.forEach(function(x) { x.classList.remove('active'); });
      forms.forEach(function(x) { x.classList.remove('active'); });
    var btn = document.querySelector('.tab[data-tab="' + name + '"]');
    if (btn) btn.classList.add('active');
    form.classList.add('active');
    var sub = document.getElementById('subtitle');
    if (sub && subtitles[name]) sub.textContent = subtitles[name];
    var heading = document.getElementById('heading');
    if (heading && headings[name]) heading.textContent = headings[name];
      if (opts && opts.persist) {
        try { localStorage.setItem(TAB_STORAGE_KEY, name); } catch (e) {}
      }
    }
    function showVerificationStep(email, password) {
      pendingSignupEmail = email || '';
      pendingSignupPassword = password || '';
      tabs.forEach(function(x) { x.classList.remove('active'); });
      forms.forEach(function(x) { x.classList.remove('active'); });
      var card = document.querySelector('.card');
      if (card) card.classList.add('verifying');
      var step = document.getElementById('verification-step');
      if (step) step.classList.add('active');
      var emailNode = document.getElementById('verify-email');
      if (emailNode) emailNode.textContent = pendingSignupEmail;
      var heading = document.getElementById('heading');
      if (heading) heading.textContent = 'Check your email';
      var sub = document.getElementById('subtitle');
      if (sub) sub.textContent = 'Finish creating your account';
      var msg = document.getElementById('verify-msg');
      if (msg) {
        msg.classList.remove('show', 'error', 'success');
        msg.textContent = '';
      }
      try { localStorage.setItem(TAB_STORAGE_KEY, 'signup'); } catch (e) {}
    }
    function getVerificationMessageNode() {
      var verifyStep = document.getElementById('verification-step');
      if (verifyStep && verifyStep.classList.contains('active')) {
        return document.getElementById('verify-msg');
      }
      return document.getElementById('l-msg') || document.getElementById('verify-msg');
    }
    function isVerificationStepActive() {
      var verifyStep = document.getElementById('verification-step');
      return !!(verifyStep && verifyStep.classList.contains('active'));
    }
    function getPendingSignupEmail() {
      var signupEmail = document.getElementById('s-email');
      var loginEmail = document.getElementById('l-email');
      return (pendingSignupEmail || (signupEmail && signupEmail.value) || (loginEmail && loginEmail.value) || '').trim();
    }
    function getPendingSignupPassword() {
      var signupPassword = document.getElementById('s-pass');
      return pendingSignupPassword || (signupPassword && signupPassword.value) || '';
    }
    function movePendingSignupToLogin(message) {
      var email = getPendingSignupEmail();
      setActiveTab('login', { persist: true });
      var loginEmail = document.getElementById('l-email');
      var loginPassword = document.getElementById('l-pass');
      var msg = document.getElementById('l-msg');
      if (loginEmail && email) loginEmail.value = email;
      if (msg) {
        msg.textContent = message || 'Sign in to continue.';
        msg.classList.remove('error');
        msg.classList.add('show', 'success');
      }
      setTimeout(function() { if (loginPassword) loginPassword.focus(); }, 0);
    }
    async function signInWithPendingSignup() {
      var email = getPendingSignupEmail();
      var password = getPendingSignupPassword();
      if (!email || !password) {
        return { ok: false, needsManualSignIn: true };
      }
      var res = await fetch(__anPath('/_agent-native/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password }),
      });
      if (res.ok) {
        window.location.reload();
        return { ok: true };
      }
      var data = await res.json().catch(function() { return {}; });
      var error = (data && (data.error || data.message)) || 'Could not finish sign-in automatically.';
      return {
        ok: false,
        error: error,
        isWaitingForVerification: /not verified|verification/i.test(error),
      };
    }
    async function checkVerificationSession(fallbackText, opts) {
      opts = opts || {};
      if (verificationCheckInFlight) return;
      verificationCheckInFlight = true;
      var msg = getVerificationMessageNode();
      var continueBtn = document.getElementById('verify-continue');
      if (continueBtn && !opts.silent) {
        continueBtn.disabled = true;
        continueBtn.textContent = 'Checking...';
      }
      if (msg && !opts.silent) {
        msg.textContent = 'Checking your verification...';
        msg.classList.remove('error');
        msg.classList.add('show', 'success');
      }
      try {
        var res = await fetch(__anPath('/_agent-native/auth/session'), {
          headers: { 'Accept': 'application/json' },
        });
        var data = await res.json().catch(function() { return {}; });
        if (res.ok && data && data.email && !data.error) {
          window.location.reload();
          return;
        }
        var loginResult = await signInWithPendingSignup();
        if (loginResult.ok) return;
        if (loginResult.needsManualSignIn) {
          if (!opts.silent) {
            movePendingSignupToLogin(fallbackText || 'Enter your password after verifying your email.');
          }
          return;
        }
        if (loginResult.error && !loginResult.isWaitingForVerification) {
          if (!opts.silent) {
            movePendingSignupToLogin('We could not finish sign-in automatically. Sign in to continue.');
          }
          return;
        }
        if (msg && !opts.silent) {
          msg.textContent = fallbackText || 'Still waiting on verification. Click the link in your email, then try Continue again.';
          msg.classList.remove('success');
          msg.classList.add('show', 'error');
        }
      } catch (err) {
        if (msg && !opts.silent) {
          msg.textContent = 'Could not check verification. Please try again.';
          msg.classList.remove('success');
          msg.classList.add('show', 'error');
        }
      } finally {
        verificationCheckInFlight = false;
        if (continueBtn && !opts.silent) {
          continueBtn.disabled = false;
          continueBtn.textContent = 'Continue';
        }
      }
    }
    function maybeCompleteVerificationAfterReturn() {
      if (!isVerificationStepActive()) return;
      checkVerificationSession(null, { silent: true });
    }
    async function resendVerificationEmail() {
      var btn = document.getElementById('resend-verification');
      var msg = document.getElementById('verify-msg');
      var email = pendingSignupEmail || document.getElementById('s-email').value;
      if (!email) return;
      var original = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending...';
      }
      if (msg) msg.classList.remove('show', 'error', 'success');
      try {
        var res = await fetch(__anPath('/_agent-native/auth/ba/send-verification-email'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, callbackURL: __anGetReturnPath() }),
        });
        if (res.ok) {
          if (msg) {
            msg.textContent = 'Sent a fresh verification link.';
            msg.classList.add('show', 'success');
          }
          if (btn) btn.textContent = 'Sent';
          setTimeout(function() {
            if (btn) {
              btn.disabled = false;
              btn.textContent = original;
            }
          }, 1600);
          return;
        }
        var data = await res.json().catch(function() { return {}; });
        if (msg) {
          msg.textContent = (data && (data.message || data.error)) || 'Could not resend the verification email.';
          msg.classList.add('show', 'error');
        }
        if (btn) {
          btn.disabled = false;
          btn.textContent = original;
        }
      } catch (err) {
        if (msg) {
          msg.textContent = 'Network error. Please try again.';
          msg.classList.add('show', 'error');
        }
        if (btn) {
          btn.disabled = false;
          btn.textContent = original;
        }
      }
    }
    (function initActiveTab() {
    var initial = 'signup';
    try {
      var params = new URLSearchParams(location.search);
      var qp = params.get('tab');
      var path = location.pathname;
      while (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
      if (qp === 'login' || qp === 'signup') {
        initial = qp;
      } else if (params.has('verified')) {
        initial = 'login';
      } else if (path === '/login' || path.endsWith('/login')) {
        initial = 'login';
      } else if (path === '/signup' || path.endsWith('/signup')) {
        initial = 'signup';
      } else {
        var stored = localStorage.getItem(TAB_STORAGE_KEY);
        if (stored === 'login' || stored === 'signup') initial = stored;
      }
    } catch (e) {}
    setActiveTab(initial, { persist: false });
      try {
        if (new URLSearchParams(location.search).has('verified')) {
          var msg = document.getElementById('l-msg');
          if (msg) {
            msg.textContent = 'Email verified. Finishing sign-in...';
            msg.classList.remove('error');
            msg.classList.add('show', 'success');
          }
          checkVerificationSession('Email verified. Sign in to continue.');
        }
      } catch (e) {}
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
      var res = await fetch(__anPath('/_agent-native/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email,
            password: pass,
            callbackURL: __anGetReturnPath(),
          }),
        });
      var data = await res.json().catch(function() { return {}; });
      if (res.ok) {
        // If email verification is required, the server won't return a session.
        // Try logging in — if it fails (unverified), show a "check your email" message.
        var loginRes = await fetch(__anPath('/_agent-native/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: pass }),
        });
        if (loginRes.ok) {
          msg.textContent = 'Account created — signing you in…';
          msg.classList.add('show', 'success');
          window.location.reload();
          return;
        }
          btn.disabled = false;
          btn.textContent = originalLabel;
          showVerificationStep(email, pass);
          return;
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

    var verifyContinue = document.getElementById('verify-continue');
    if (verifyContinue) verifyContinue.addEventListener('click', function(e) {
      e.preventDefault();
      checkVerificationSession();
    });
    window.addEventListener('focus', maybeCompleteVerificationAfterReturn);
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') maybeCompleteVerificationAfterReturn();
    });
    var resendBtn = document.getElementById('resend-verification');
    if (resendBtn) resendBtn.addEventListener('click', function(e) {
      e.preventDefault();
      resendVerificationEmail();
    });
    var backToSignup = document.getElementById('back-to-signup');
    if (backToSignup) backToSignup.addEventListener('click', function(e) {
      e.preventDefault();
      setActiveTab('signup', { persist: true });
      var email = document.getElementById('s-email');
      setTimeout(function() { if (email) email.focus(); }, 0);
    });

    var forgotLink = document.getElementById('forgot-link');
  var backToLogin = document.getElementById('back-to-login');
  if (forgotLink) forgotLink.addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('login-form').classList.remove('active');
    document.getElementById('forgot-form').classList.add('active');
    var sub = document.getElementById('subtitle');
    if (sub) sub.textContent = 'Reset your password';
    var heading = document.getElementById('heading');
    if (heading) heading.textContent = 'Reset password';
    var fEmail = document.getElementById('f-email');
    var lEmail = document.getElementById('l-email');
    if (lEmail && lEmail.value) fEmail.value = lEmail.value;
    setTimeout(function() { fEmail.focus(); }, 0);
  });
  if (backToLogin) backToLogin.addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('forgot-form').classList.remove('active');
    document.getElementById('login-form').classList.add('active');
    var sub = document.getElementById('subtitle');
    if (sub) sub.textContent = subtitles.login;
    var heading = document.getElementById('heading');
    if (heading) heading.textContent = headings.login;
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
      var res = await fetch(__anPath('/_agent-native/auth/ba/request-password-reset'), {
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
      msg.classList.remove('show', 'success');
      msg.classList.add('error');
    var originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      var res = await fetch(__anPath('/_agent-native/auth/login'), {
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
}
${
  showGoogle
    ? `
    async function signInWithGoogle() {
    if (__anShouldShowGoogleNotice()) {
      __anShowGoogleNotice();
      return;
    }
    return __anStartGoogleSignIn();
  }
    async function __anStartGoogleSignIn() {
    var btn = document.getElementById('google-btn');
    var err = document.getElementById('google-err');
    var ret = __anGetReturnPath();
    btn.disabled = true;
    err.classList.remove('show');
    if (__anResolveAuthFlow() === 'popup') {
      __anStartPopupOAuth(ret, btn, err);
      return;
    }
    if (__anIsAgentNativeDesktop()) {
      __anStartNativeDesktopOAuth(ret, btn, err);
      return;
    }
    if (__anIsBuilderPreview()) {
      var params = new URLSearchParams();
      if (ret) params.set('return', __anOAuthReturnTarget(ret));
      params.set('redirect', '1');
      __anSetOAuthDebug('Opening Google sign-in redirect');
      __anOpenOAuthUrl(__anGoogleAuthUrlPath() + '?' + params.toString());
      return;
    }
    try {
      var authUrl = __anGoogleAuthUrlPath() + '?return=' + encodeURIComponent(ret);
      var res = await fetch(authUrl);
      var data = await res.json();
      if (data.url) {
        __anOpenOAuthUrl(data.url);
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
${
  googleSignInNotice
    ? `
  window.__anGoogleNoticeAccepted = false;
  function __anShouldShowGoogleNotice() {
    var notice = document.getElementById('google-preflight');
    if (!notice || window.__anGoogleNoticeAccepted) return false;
    var host = notice.getAttribute('data-host');
    return !host || window.location.hostname === host;
  }
  function __anShowGoogleNotice() {
    var notice = document.getElementById('google-preflight');
    if (!notice) return;
    notice.classList.add('show');
    var continueBtn = document.getElementById('google-preflight-continue');
    if (continueBtn) continueBtn.focus();
  }
  function __anHideGoogleNotice() {
    var notice = document.getElementById('google-preflight');
    if (notice) notice.classList.remove('show');
  }
  function __anAcceptGoogleNotice() {
    window.__anGoogleNoticeAccepted = true;
    __anHideGoogleNotice();
    __anStartGoogleSignIn();
  }`
    : `
  function __anShouldShowGoogleNotice() { return false; }`
}
${starfieldScript}
${
  runLocalCommand
    ? `
  function __anToggleRunLocalCommand() {
    var panel = document.getElementById('run-local-panel');
    var button = document.getElementById('run-local-button');
    if (!panel || !button) return;
    var nextOpen = panel.hasAttribute('hidden');
    if (nextOpen) {
      panel.removeAttribute('hidden');
    } else {
      panel.setAttribute('hidden', '');
    }
    button.setAttribute('aria-expanded', String(nextOpen));
  }
  function __anCopyRunLocalCommand() {
    var panel = document.getElementById('run-local-panel');
    var button = document.getElementById('copy-run-local');
    if (!panel || !button) return;
    var command = panel.getAttribute('data-command') || '';
    var original = button.textContent || 'Copy command';
    function markCopied() {
      button.textContent = 'Copied';
      setTimeout(function() { button.textContent = original; }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(command).then(markCopied).catch(function() {});
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
<link rel="icon" type="image/svg+xml" href="${withAppBasePath("/favicon.svg")}">
<link rel="apple-touch-icon" href="${withAppBasePath("/icon-180.svg")}">
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
