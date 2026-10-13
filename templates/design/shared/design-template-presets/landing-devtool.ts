import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";

const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  bg: "#07080B",
  // guard:allow-raw-color — authored template palette, not app chrome.
  surface: "#0E1015",
  // guard:allow-raw-color — authored template palette, not app chrome.
  raised: "#151822",
  // guard:allow-raw-color — authored template palette, not app chrome.
  line: "#1E222C",
  // guard:allow-raw-color — authored template palette, not app chrome.
  lineStrong: "#2B303D",
  // guard:allow-raw-color — authored template palette, not app chrome.
  text: "#EDEEF3",
  // guard:allow-raw-color — authored template palette, not app chrome.
  muted: "#8B909E",
  // guard:allow-raw-color — authored template palette, not app chrome.
  faint: "#555B69",
  // guard:allow-raw-color — authored template palette, not app chrome.
  indigo: "#7B86FF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  cyan: "#5CE1D6",
  // guard:allow-raw-color — authored template palette, not app chrome.
  pink: "#F07AB8",
  // guard:allow-raw-color — authored template palette, not app chrome.
  green: "#7EE2A1",
  // guard:allow-raw-color — authored template palette, not app chrome.
  red: "#FF6B6B",
  // guard:allow-raw-color — authored template palette, not app chrome.
  amber: "#F5C06B",
};

const gridLines = [
  ...Array.from(
    { length: 13 },
    (_, i) =>
      `<line x1="${i * 120}" y1="0" x2="${i * 120}" y2="900" stroke="url(#grid-fade)"/>`,
  ),
  ...Array.from(
    { length: 8 },
    (_, i) =>
      `<line x1="0" y1="${i * 120}" x2="1440" y2="${i * 120}" stroke="url(#grid-fade)"/>`,
  ),
].join("");

const logos: Array<[string, string]> = [
  [
    "Helio",
    `<circle cx="11" cy="11" r="9" fill="none" stroke="${C.faint}" stroke-width="3"/>`,
  ],
  ["Quarry", `<path d="M2 20 L11 2 L20 20 Z" fill="${C.faint}"/>`],
  [
    "Brightline",
    `<rect x="2" y="8" width="18" height="6" rx="3" fill="${C.faint}"/>`,
  ],
  [
    "Oxbow",
    `<path d="M3 5 Q11 26 19 5" fill="none" stroke="${C.faint}" stroke-width="3.5" stroke-linecap="round"/>`,
  ],
  ["Lattice", `<path d="M2 2h8v8H2zM12 12h8v8h-8z" fill="${C.faint}"/>`],
  [
    "Fernway",
    `<path d="M11 2 L20 11 L11 20 L2 11 Z" fill="none" stroke="${C.faint}" stroke-width="3"/>`,
  ],
];

const trace: Array<[string, number, number, string, string]> = [
  ["enqueue", 0, 2, C.faint, "2 ms"],
  ["fetch", 2, 22, C.indigo, "184 ms"],
  ["render · try 1", 24, 26, C.red, "timeout"],
  ["render · try 2", 54, 24, C.cyan, "211 ms"],
  ["email", 78, 14, C.green, "96 ms"],
];

export const landingDevtool: DesignTemplatePreset = {
  id: "preset-landing-devtool",
  title: "Developer tool landing page",
  description:
    "A 1440 × 2464 dark SaaS landing page: light beam hero, code and trace window, logo cloud, pricing toggle.",
  category: "landing-page",
  width: 1440,
  height: 2464,
  filename: "devtool-landing-page.html",
  content: presetDocument({
    title: "Kestrel — Background jobs that explain themselves",
    width: 1440,
    height: 2464,
    alpine: true,
    fonts: "family=Geist:wght@300..800&family=Geist+Mono:wght@400;500",
    palette: {
      canvas: C.bg,
      bg: C.bg,
      surface: C.surface,
      raised: C.raised,
      line: C.line,
      "line-strong": C.lineStrong,
      text: C.text,
      muted: C.muted,
      faint: C.faint,
      indigo: C.indigo,
      cyan: C.cyan,
      pink: C.pink,
      green: C.green,
      amber: C.amber,
    },
    css: `
      .artboard { color:var(--text); font-family:'Geist', sans-serif; font-size:16px; }
      .mono { font-family:'Geist Mono', monospace; }
      .wrap { position:relative; z-index:2; width:1200px; margin:0 auto; }
      .grid-bg { position:absolute; left:0; top:0; width:1440px; height:900px; z-index:0; opacity:.7; }
      .beam { position:absolute; left:0; top:0; width:1440px; height:1000px; z-index:1; pointer-events:none; }
      .beam .shaft { position:absolute; left:690px; top:-40px; width:60px; height:560px; border-radius:50%; background:var(--indigo); opacity:.55; filter:blur(40px); }
      .beam .pool { position:absolute; left:320px; top:380px; width:800px; height:320px; border-radius:50%; background:var(--indigo); opacity:.28; filter:blur(110px); }
      .beam .pool-cyan { position:absolute; left:760px; top:470px; width:420px; height:220px; border-radius:50%; background:var(--cyan); opacity:.16; filter:blur(90px); }
      .nav { display:flex; align-items:center; justify-content:space-between; height:88px; }
      .nav ul { display:flex; gap:36px; margin-left:120px; color:var(--muted); font-size:15px; }
      .nav-actions { display:flex; align-items:center; gap:22px; font-size:15px; }
      .nav-actions a { color:var(--muted); text-decoration:none; }
      .nav-actions a.btn-primary { color:var(--bg); }
      .btn { display:inline-flex; align-items:center; gap:10px; height:44px; padding:0 20px; border:1px solid var(--line-strong); border-radius:10px; background:var(--raised); color:var(--text); font:500 15px/1 'Geist', sans-serif; text-decoration:none; cursor:pointer; }
      .btn-primary { border-color:var(--text); background:var(--text); color:var(--bg); }
      .hero { padding-top:118px; text-align:center; }
      .hero h1 { max-width:980px; margin:0 auto; font-size:88px; font-weight:600; line-height:.98; letter-spacing:-.045em; }
      .hero h1 span { color:var(--muted); font-weight:300; }
      .hero p { max-width:640px; margin:28px auto 0; color:var(--muted); font-size:20px; line-height:1.5; letter-spacing:-.005em; }
      .hero-ctas { display:flex; justify-content:center; gap:14px; margin-top:40px; }
      .hero-ctas .btn { height:52px; padding:0 24px; font-size:16px; }
      .copy-cmd { font-family:'Geist Mono', monospace; font-size:15px; }
      .copy-cmd svg { width:16px; height:16px; }
      .window { display:grid; grid-template-columns:1fr 1fr; width:1120px; margin:72px auto 0; border:1px solid var(--line-strong); border-radius:16px; background:var(--surface); box-shadow:0 40px 120px var(--bg); overflow:hidden; text-align:left; }
      .pane-head { display:flex; align-items:center; justify-content:space-between; height:48px; padding:0 20px; border-bottom:1px solid var(--line); color:var(--muted); font-size:13px; }
      .pane + .pane { border-left:1px solid var(--line); }
      pre { margin:0; padding:24px 26px 28px; font:400 13.5px/1.75 'Geist Mono', monospace; color:var(--text); white-space:pre; }
      .k { color:var(--pink); } .s { color:var(--green); } .f { color:var(--indigo); } .n { color:var(--amber); } .c { color:var(--faint); }
      .trace { padding:22px 24px 26px; }
      .trace-row { display:grid; grid-template-columns:120px 1fr 64px; align-items:center; gap:14px; height:44px; font-family:'Geist Mono', monospace; font-size:12.5px; color:var(--muted); }
      .trace-track { position:relative; height:10px; border-radius:5px; background:var(--raised); }
      .trace-track i { position:absolute; top:0; height:10px; border-radius:5px; }
      .trace-row span:last-child { text-align:right; }
      .trace-summary { display:flex; gap:28px; margin-top:18px; padding-top:18px; border-top:1px solid var(--line); font-size:13px; color:var(--muted); }
      .trace-summary strong { display:block; margin-top:4px; color:var(--text); font-size:22px; font-weight:500; letter-spacing:-.02em; }
      .logos { padding-top:88px; text-align:center; }
      .logos p { color:var(--faint); font-size:14px; }
      .logos ul { display:flex; justify-content:space-between; margin-top:30px; padding:0 40px; }
      .logos li { display:flex; align-items:center; gap:10px; color:var(--faint); font-size:22px; font-weight:600; letter-spacing:-.03em; }
      .logos svg { width:22px; height:22px; }
      .features { display:grid; grid-template-columns:repeat(3, 1fr); gap:40px; padding-top:112px; }
      .features h2 { grid-column:1 / -1; max-width:720px; margin-bottom:24px; font-size:48px; font-weight:600; line-height:1.04; letter-spacing:-.035em; }
      .features article { padding-top:24px; border-top:1px solid var(--line-strong); }
      .features h3 { font-size:20px; font-weight:600; letter-spacing:-.015em; }
      .features article p { margin-top:10px; color:var(--muted); font-size:16px; line-height:1.55; }
      .features code { display:block; margin-top:20px; padding:12px 14px; border:1px solid var(--line); border-radius:10px; background:var(--surface); color:var(--cyan); font:400 13px/1.5 'Geist Mono', monospace; }
      .pricing { padding-top:112px; }
      .pricing-head { display:flex; align-items:end; justify-content:space-between; }
      .pricing-head h2 { font-size:48px; font-weight:600; line-height:1.04; letter-spacing:-.035em; }
      .toggle { display:flex; padding:4px; border:1px solid var(--line-strong); border-radius:12px; background:var(--surface); }
      .toggle button { height:36px; padding:0 16px; border:0; border-radius:8px; background:transparent; color:var(--muted); font:500 14px/1 'Geist', sans-serif; cursor:pointer; }
      .toggle button[aria-pressed="true"] { background:var(--raised); color:var(--text); }
      .tiers { display:grid; grid-template-columns:repeat(3, 1fr); gap:20px; margin-top:40px; }
      .tier { position:relative; padding:32px; border:1px solid var(--line-strong); border-radius:16px; background:var(--surface); }
      .tier-featured { border-color:var(--indigo); box-shadow:0 0 0 1px var(--indigo), 0 30px 80px var(--bg); }
      .tier h3 { color:var(--muted); font-size:15px; font-weight:500; }
      .price { margin-top:16px; font-size:52px; font-weight:600; letter-spacing:-.04em; }
      .price small { color:var(--muted); font-size:16px; font-weight:400; letter-spacing:0; }
      .tier ul { margin-top:22px; color:var(--muted); font-size:15px; line-height:2; }
      .tier li::before { content:""; display:inline-block; width:6px; height:6px; margin-right:12px; border-radius:50%; background:var(--cyan); vertical-align:middle; }
      .tier .btn { justify-content:center; width:100%; margin-top:28px; }
      .footer { display:flex; justify-content:space-between; align-items:center; margin-top:96px; padding:32px 0 40px; border-top:1px solid var(--line); color:var(--faint); font-size:14px; }
    `,
    body: `
      <div style="position:absolute;inset:0;background:${C.bg}" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <svg class="grid-bg" viewBox="0 0 1440 900" aria-hidden="true" data-agent-native-node-id="hero-grid" data-agent-native-layer-name="Hero grid"><defs><linearGradient id="grid-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="900"><stop offset="0" stop-color="${C.lineStrong}"/><stop offset="1" stop-color="${C.bg}"/></linearGradient></defs>${gridLines}</svg>
      <div class="beam" aria-hidden="true" data-agent-native-node-id="beam" data-agent-native-layer-name="Light beam"><div class="shaft"></div><div class="pool"></div><div class="pool-cyan"></div></div>
      <div class="wrap">
        <nav class="nav" data-agent-native-node-id="nav" data-agent-native-layer-name="Navigation">
          <div style="display:flex;align-items:center;gap:10px;color:${C.text};font:600 20px/1 'Geist',sans-serif;letter-spacing:-.03em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
            <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M2 20 L13 4 L24 20 L13 14 Z" fill="${C.text}"/></svg>
            <span>Kestrel</span>
          </div>
          <ul><li>Docs</li><li>Pricing</li><li>Changelog</li><li>Customers</li></ul>
          <div class="nav-actions"><a href="#">Sign in</a><a class="btn btn-primary" href="#">Start building</a></div>
        </nav>
        <header class="hero" data-agent-native-node-id="hero" data-agent-native-layer-name="Hero">
          <h1>Background jobs that <span>explain themselves.</span></h1>
          <p>Kestrel is a durable queue for TypeScript. Every retry, timeout, and fan-out is traced, so the 3 a.m. page arrives with an answer.</p>
          <div class="hero-ctas">
            <a class="btn btn-primary" href="#">Start building — free</a>
            <button class="btn copy-cmd" type="button" x-data="{ copied: false }" @click="navigator.clipboard?.writeText('npm i @kestrel/core'); copied = true; setTimeout(() => copied = false, 1600)"><span x-text="copied ? 'Copied to clipboard' : 'npm i @kestrel/core'">npm i @kestrel/core</span><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="2" fill="none" stroke="${C.muted}" stroke-width="1.4"/><path d="M11 3.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h.5" fill="none" stroke="${C.muted}" stroke-width="1.4"/></svg></button>
          </div>
          <div class="window" data-agent-native-node-id="product-window" data-agent-native-layer-name="Product window">
            <div class="pane">
              <div class="pane-head mono"><span>jobs/send-invoice.ts</span><span>TypeScript</span></div>
<pre><span class="k">import</span> { defineJob } <span class="k">from</span> <span class="s">"@kestrel/core"</span>;

<span class="k">export const</span> sendInvoice = <span class="f">defineJob</span>({
  id: <span class="s">"send-invoice"</span>,
  retry: { attempts: <span class="n">5</span>, backoff: <span class="s">"exponential"</span> },
  <span class="k">async</span> <span class="f">run</span>({ id }, step) {
    <span class="k">const</span> inv = <span class="k">await</span> <span class="f">step</span>(<span class="s">"fetch"</span>, () =&gt; db.<span class="f">invoice</span>(id));
    <span class="k">const</span> pdf = <span class="k">await</span> <span class="f">step</span>(<span class="s">"render"</span>, () =&gt; <span class="f">toPdf</span>(inv));
    <span class="k">await</span> <span class="f">step</span>(<span class="s">"email"</span>, () =&gt; mail.<span class="f">send</span>(inv.to, pdf));
  },
});</pre>
            </div>
            <div class="pane">
              <div class="pane-head mono"><span>run_8f2c · send-invoice</span><span style="color:${C.green}">completed</span></div>
              <div class="trace">
                ${trace
                  .map(
                    ([label, start, width, color, note]) =>
                      `<div class="trace-row"><span>${label}</span><div class="trace-track"><i style="left:${start}%;width:${width}%;background:${color}"></i></div><span>${note}</span></div>`,
                  )
                  .join("")}
                <div class="trace-summary"><p>Duration<strong>612 ms</strong></p><p>Attempts<strong>2 of 5</strong></p><p>Cause of retry<strong>render timeout</strong></p></div>
              </div>
            </div>
          </div>
        </header>
        <section class="logos" data-agent-native-node-id="logo-cloud" data-agent-native-layer-name="Logo cloud">
          <p>Running in production at teams like</p>
          <ul>${logos.map(([name, mark]) => `<li><svg viewBox="0 0 22 22" aria-hidden="true">${mark}</svg>${name}</li>`).join("")}</ul>
        </section>
        <section class="features" data-agent-native-node-id="features" data-agent-native-layer-name="Features">
          <h2>Queues are easy. Knowing why a job failed is the hard part.</h2>
          <article><h3>Durable by default</h3><p>Every step checkpoints to Postgres. Deploy mid-run and the job resumes exactly where it stopped.</p><code>step("charge", …) // runs once</code></article>
          <article><h3>Traces, not logs</h3><p>Each attempt is a span with inputs, outputs, and the error that caused the retry, one click from the alert.</p><code>kestrel trace run_8f2c</code></article>
          <article><h3>Fan-out without fear</h3><p>Spawn ten thousand children with a concurrency cap and a single place to watch them finish.</p><code>step.map(users, notify, { limit: 50 })</code></article>
        </section>
        <section class="pricing" x-data="{ yearly: true }" data-agent-native-node-id="pricing" data-agent-native-layer-name="Pricing">
          <div class="pricing-head">
            <h2>Start free. Pay per million steps.</h2>
            <div class="toggle" role="group" aria-label="Billing period">
              <button type="button" :aria-pressed="!yearly" aria-pressed="false" @click="yearly = false">Monthly</button>
              <button type="button" :aria-pressed="yearly" aria-pressed="true" @click="yearly = true">Yearly · save 20%</button>
            </div>
          </div>
          <div class="tiers">
            <article class="tier"><h3>Hobby</h3><p class="price">$0 <small>/ month</small></p><ul><li>100k steps a month</li><li>7-day trace history</li><li>Community support</li></ul><a class="btn" href="#">Start for free</a></article>
            <article class="tier tier-featured"><h3>Team</h3><p class="price"><span x-text="yearly ? '$39' : '$49'">$39</span> <small>/ month</small></p><ul><li>5M steps included</li><li>30-day trace history</li><li>Alerts to Slack and PagerDuty</li></ul><a class="btn btn-primary" href="#">Start a 14-day trial</a></article>
            <article class="tier"><h3>Scale</h3><p class="price">Custom</p><ul><li>Dedicated workers</li><li>SSO and audit log</li><li>99.99% uptime SLA</li></ul><a class="btn" href="#">Talk to us</a></article>
          </div>
        </section>
        <footer class="footer" data-agent-native-node-id="footer" data-agent-native-layer-name="Footer"><span>Kestrel Systems</span><span>Docs · Status · Security · Careers</span></footer>
      </div>`,
  }),
};
