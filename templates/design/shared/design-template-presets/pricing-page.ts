import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";
import { guideFrame } from "./guide.js";

// One pricing page at three breakpoints. Desktop, tablet and mobile share the
// same markup and tokens; only each frame's layout CSS changes, so a price or
// color edit lands everywhere while the layout stays right for each width.
const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#F6F5F1",
  // guard:allow-raw-color — authored template palette, not app chrome.
  surface: "#FFFFFF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#17181C",
  // guard:allow-raw-color — authored template palette, not app chrome.
  soft: "#5C5E67",
  // guard:allow-raw-color — authored template palette, not app chrome.
  softDark: "#B4B6C0",
  // guard:allow-raw-color — authored template palette, not app chrome.
  line: "rgba(23, 24, 28, 0.11)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  lineDark: "rgba(255, 255, 255, 0.14)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accent: "#3A47D5",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accentSoft: "#E5E7FC",
  // guard:allow-raw-color — authored template palette, not app chrome.
  good: "#1E7A4C",
  // guard:allow-raw-color — authored template palette, not app chrome.
  goodDark: "#7FD8A8",
};

const PALETTE = {
  canvas: C.paper,
  paper: C.paper,
  surface: C.surface,
  ink: C.ink,
  soft: C.soft,
  "soft-dark": C.softDark,
  line: C.line,
  "line-dark": C.lineDark,
  accent: C.accent,
  "accent-soft": C.accentSoft,
  good: C.good,
  "good-dark": C.goodDark,
};

const FONTS =
  "family=Plus+Jakarta+Sans:wght@600;700&family=Inter:wght@400;500;600";

const DISPLAY = "'Plus Jakarta Sans', sans-serif";

const PRODUCT = "Sprigboard";

// The content, in one place, so every breakpoint says the same thing.
const TIERS = [
  {
    id: "starter",
    name: "Starter",
    desc: "For a small team collecting its first round of feedback.",
    price: "$0",
    per: "free forever,<br />up to 2 editors",
    cta: "Start for free",
    lead: "What's included",
    feats: [
      "1 feedback board",
      "Unlimited voters and comments",
      "Public roadmap",
      "Weekly email digest",
    ],
  },
  {
    id: "team",
    name: "Team",
    desc: "For product teams that close the loop on every request.",
    price: "$16",
    per: "per editor / month,<br />billed yearly",
    cta: "Start 14-day trial",
    lead: "Everything in Starter, plus",
    feats: [
      "Unlimited boards",
      "Two-way chat and issue tracker sync",
      "Private roadmaps for internal plans",
      "Merge duplicate requests",
      "Custom domain",
    ],
  },
  {
    id: "business",
    name: "Business",
    desc: "For larger orgs with security reviews and many teams.",
    price: "$32",
    per: "per editor / month,<br />billed yearly",
    cta: "Talk to sales",
    lead: "Everything in Team, plus",
    feats: [
      "SAML single sign-on",
      "Audit log and data retention rules",
      "Enterprise tracker and CRM sync",
      "Priority support, 4-hour replies",
    ],
  },
];

type Cell = string | boolean;
const COMPARE: { group: string; rows: [string, Cell, Cell, Cell][] }[] = [
  {
    group: "Feedback",
    rows: [
      ["Feedback boards", "1", "Unlimited", "Unlimited"],
      ["Voters and comments", "Unlimited", "Unlimited", "Unlimited"],
      ["Merge duplicate requests", false, true, true],
    ],
  },
  {
    group: "Roadmaps",
    rows: [
      ["Public roadmap", true, true, true],
      ["Private roadmaps", false, true, true],
      ["Changelog posts", "5 a month", "Unlimited", "Unlimited"],
    ],
  },
  {
    group: "Integrations and security",
    rows: [
      ["Chat and issue tracker sync", false, true, true],
      ["Enterprise tracker and CRM sync", false, false, true],
      ["SAML single sign-on", false, false, true],
      ["Support", "Email", "Email and chat", "4-hour priority"],
    ],
  },
];

const FAQ = [
  [
    "Who counts as an editor?",
    "Anyone who can change boards, statuses or the roadmap. Voters and commenters are always free, on every plan.",
  ],
  [
    "Can I switch plans later?",
    "Yes. Upgrades apply right away and we prorate the difference. Downgrades start at your next renewal.",
  ],
  [
    "What happens when my trial ends?",
    "You move to Starter unless you add a card. Nothing is deleted, and your boards stay right where they are.",
  ],
  [
    "Do you offer nonprofit pricing?",
    "Registered nonprofits and schools get half off Team and Business. Email us and we'll set it up the same day.",
  ],
  [
    "Can we pay by invoice?",
    "On Business, yes. We bill yearly by invoice with net-30 terms, and we're happy to fill in vendor forms.",
  ],
  [
    "Where is our data stored?",
    "In the US or the EU. You pick the region at signup, and Business plans can set their own retention rules.",
  ],
];

const BASE_CSS = `
      .artboard { color:var(--ink); font-family:'Inter', sans-serif; }
      .page { position:relative; z-index:1; }
      .display { font-family:${DISPLAY}; font-weight:700; letter-spacing:-.035em; text-wrap:balance; }
      .top { display:flex; align-items:center; justify-content:flex-end; }
      .nav { display:flex; align-items:center; gap:32px; font-size:15px; font-weight:500; }
      .nav a { color:var(--soft); text-decoration:none; }
      .nav .btn { color:var(--surface); }
      .menu { display:none; }
      .btn { display:inline-flex; align-items:center; justify-content:center; height:48px; padding:0 24px; border-radius:999px; font-size:16px; font-weight:600; text-decoration:none; white-space:nowrap; }
      .btn-primary { background:var(--ink); color:var(--surface); }
      .btn-ghost { border:1.5px solid var(--line); color:var(--ink); }
      .btn-light { background:var(--surface); color:var(--ink); }
      .btn-outline-light { border:1.5px solid var(--line-dark); color:var(--surface); }
      .eyebrow { color:var(--accent); font-size:14px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; }
      .hero { text-align:center; }
      .hero h1 { margin:18px auto 0; }
      .lede { margin:20px auto 0; color:var(--soft); line-height:1.5; text-wrap:balance; }
      .toggle { display:inline-flex; align-items:center; gap:4px; padding:4px; border:1px solid var(--line); border-radius:999px; background:var(--surface); }
      .toggle > span { display:inline-flex; align-items:center; height:40px; padding:0 20px; border-radius:999px; color:var(--soft); font-size:15px; font-weight:600; }
      .toggle .on { background:var(--ink); color:var(--surface); }
      .save { display:inline-flex; align-items:center; height:24px; margin-left:10px; padding:0 10px; border-radius:999px; background:var(--accent-soft); color:var(--accent); font-size:13px; font-weight:600; }
      .tiers { display:grid; }
      .tier { display:flex; flex-direction:column; padding:32px; border:1px solid var(--line); border-radius:24px; background:var(--surface); }
      .tier-featured { border-color:var(--ink); background:var(--ink); color:var(--surface); }
      .tier-head { display:flex; min-height:28px; align-items:center; justify-content:space-between; gap:12px; }
      .tier-head h3 { font:600 22px/1.2 ${DISPLAY}; letter-spacing:-.01em; }
      .badge { display:inline-flex; align-items:center; height:28px; padding:0 12px; border-radius:999px; background:var(--accent-soft); color:var(--accent); font-size:13px; font-weight:600; }
      .tier-desc { margin-top:10px; color:var(--soft); font-size:15px; line-height:1.5; }
      .price { display:flex; align-items:flex-end; gap:12px; margin-top:28px; }
      .amt { font:700 56px/.9 ${DISPLAY}; letter-spacing:-.04em; }
      .per { color:var(--soft); font-size:14px; line-height:1.4; }
      .tier .btn { width:100%; margin-top:28px; }
      .feat-lead { margin-top:28px; padding-top:24px; border-top:1px solid var(--line); color:var(--soft); font-size:14px; font-weight:600; }
      .feats li { display:flex; gap:10px; margin-top:12px; font-size:15px; line-height:1.45; }
      .chk { flex:none; width:20px; height:20px; margin-top:1px; }
      .chk path { fill:none; stroke:var(--good); stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round; }
      .tier-featured .tier-desc, .tier-featured .per, .tier-featured .feat-lead { color:var(--soft-dark); }
      .tier-featured .feat-lead { border-color:var(--line-dark); }
      .tier-featured .chk path { stroke:var(--good-dark); }
      .section-head h2 { letter-spacing:-.03em; }
      .section-head p { margin-top:10px; color:var(--soft); line-height:1.5; }
      .cmp { overflow:hidden; border:1px solid var(--line); border-radius:24px; background:var(--surface); }
      .cmp-row { display:grid; grid-template-columns:1.6fr repeat(3, 1fr); align-items:center; min-height:52px; padding:0 28px; border-top:1px solid var(--line); font-size:15px; }
      .cmp-row > span { display:flex; align-items:center; }
      .cmp-row > span + span { justify-content:center; text-align:center; }
      .cmp-head { min-height:64px; border-top:0; font-size:16px; font-weight:600; }
      .cmp-head .hl { color:var(--accent); }
      .cmp-group { display:flex; min-height:40px; background:var(--paper); color:var(--soft); font-size:13px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; }
      .cmp .none { color:var(--soft); }
      .cmp .chk { margin:0; }
      .faq { display:grid; }
      .faq h4 { font-size:17px; font-weight:600; line-height:1.35; }
      .faq p { margin-top:8px; color:var(--soft); font-size:15px; line-height:1.55; }
      .cta { border-radius:32px; background:var(--ink); color:var(--surface); }
      .cta p { color:var(--soft-dark); line-height:1.5; }
      .cta-btns { display:flex; gap:12px; }
      .foot { display:flex; justify-content:space-between; align-items:center; color:var(--soft); font-size:14px; }
      .foot nav { display:flex; gap:24px; }
`;

const background = `<div style="position:absolute;inset:0;background:var(--paper)" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>`;

const logo = (size: number, top: number, left: number) =>
  `<div style="position:absolute;top:${top}px;left:${left}px;z-index:3;display:flex;align-items:center;gap:${Math.round(size * 0.4)}px;color:var(--ink);font:700 ${size}px/1 ${DISPLAY};letter-spacing:-.03em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="${Math.round(size * 1.25)}" height="${Math.round(size * 1.25)}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" style="fill:var(--accent)"/><path d="M16 25V12M16 17c-4.5 0-7-2.5-7-7 4.5 0 7 2.5 7 7zM16 14c0-4 2.2-6.5 6.5-6.5 0 4-2.2 6.5-6.5 6.5z" style="fill:none;stroke:var(--surface)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${PRODUCT}</span>
      </div>`;

const check = `<svg class="chk" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3.2 3.1L15 6.6"/></svg>`;

const cell = (v: Cell) =>
  v === true
    ? `<span aria-label="Included">${check}</span>`
    : v === false
      ? `<span class="none" aria-label="Not included">—</span>`
      : `<span>${v}</span>`;

const nav = `
        <div class="top" data-agent-native-node-id="header" data-agent-native-layer-name="Header">
          <nav class="nav" data-agent-native-node-id="nav" data-agent-native-layer-name="Navigation">
            <a href="#">Product</a><a href="#">Customers</a><a href="#">Changelog</a><a href="#">Sign in</a>
            <a class="btn btn-primary" href="#">Start free</a>
          </nav>
          <span class="menu" data-agent-native-node-id="menu" data-agent-native-layer-name="Menu button" aria-label="Menu"><svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M3 7h16M3 15h16" style="fill:none;stroke:var(--ink)" stroke-width="2" stroke-linecap="round"/></svg></span>
        </div>`;

const hero = `
        <header class="hero" data-agent-native-node-id="hero" data-agent-native-layer-name="Hero">
          <p class="eyebrow" data-agent-native-node-id="eyebrow" data-agent-native-layer-name="Eyebrow">Pricing</p>
          <h1 class="display" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">Pay for the people who build, not the people who vote.</h1>
          <p class="lede" data-agent-native-node-id="lede" data-agent-native-layer-name="Lede">Every plan includes unlimited voters and comments. You only pay for the editors who triage feedback and keep the roadmap honest.</p>
          <div class="toggle" data-agent-native-node-id="billing-toggle" data-agent-native-layer-name="Billing toggle">
            <span>Monthly</span><span class="on">Yearly <em class="save" style="font-style:normal">Save 20%</em></span>
          </div>
        </header>`;

const tiers = `
        <div class="tiers" data-agent-native-node-id="tiers" data-agent-native-layer-name="Plans">${TIERS.map(
          (t) => `
          <article class="tier${t.id === "team" ? " tier-featured" : ""}" data-agent-native-node-id="tier-${t.id}" data-agent-native-layer-name="${t.name} plan">
            <div class="tier-main">
              <div class="tier-head"><h3>${t.name}</h3>${t.id === "team" ? `<span class="badge">Most popular</span>` : ""}</div>
              <p class="tier-desc">${t.desc}</p>
              <div class="price" data-agent-native-node-id="price-${t.id}" data-agent-native-layer-name="${t.name} price"><span class="amt">${t.price}</span><span class="per">${t.per}</span></div>
              <a class="btn ${t.id === "team" ? "btn-light" : t.id === "starter" ? "btn-ghost" : "btn-primary"}" href="#">${t.cta}</a>
            </div>
            <div class="tier-list">
              <p class="feat-lead">${t.lead}</p>
              <ul class="feats">${t.feats.map((f) => `<li>${check}<span>${f}</span></li>`).join("")}</ul>
            </div>
          </article>`,
        ).join("")}
        </div>`;

const compare = `
        <section class="compare" data-agent-native-node-id="compare" data-agent-native-layer-name="Comparison">
          <div class="section-head"><h2 class="display">Compare every plan</h2><p>The details, side by side, for the person who has to sign off.</p></div>
          <div class="cmp" data-agent-native-node-id="compare-table" data-agent-native-layer-name="Comparison table">
            <div class="cmp-row cmp-head"><span>Features</span><span>Starter</span><span class="hl">Team</span><span>Business</span></div>${COMPARE.map(
              (g) => `
            <div class="cmp-row cmp-group">${g.group}</div>${g.rows
              .map(
                ([label, a, b, c]) => `
            <div class="cmp-row"><span>${label}</span>${cell(a)}${cell(b)}${cell(c)}</div>`,
              )
              .join("")}`,
            ).join("")}
          </div>
        </section>`;

const faq = `
        <section class="faq-wrap" data-agent-native-node-id="faq" data-agent-native-layer-name="FAQ">
          <div class="section-head"><h2 class="display">Questions, answered</h2></div>
          <dl class="faq">${FAQ.map(
            ([q, a], i) => `
            <div data-agent-native-node-id="faq-${i + 1}" data-agent-native-layer-name="Question ${i + 1}"><h4>${q}</h4><p>${a}</p></div>`,
          ).join("")}
          </dl>
        </section>`;

const footer = `
        <section class="cta" data-agent-native-node-id="footer-cta" data-agent-native-layer-name="Footer CTA">
          <div><h2 class="display">Try Team free for 14 days.</h2><p>No card needed. Bring the whole team and decide once you've seen it work.</p></div>
          <div class="cta-btns"><a class="btn btn-light" href="#">Start free trial</a><a class="btn btn-outline-light" href="#">Talk to sales</a></div>
        </section>
        <footer class="foot" data-agent-native-node-id="footer" data-agent-native-layer-name="Footer">
          <span>© 2026 ${PRODUCT}, Inc.</span>
          <nav><span>Privacy</span><span>Terms</span><span>Status</span></nav>
        </footer>`;

const page = ({
  title,
  width,
  height,
  css,
  logoSize,
  logoTop,
  logoLeft,
}: {
  title: string;
  width: number;
  height: number;
  css: string;
  logoSize: number;
  logoTop: number;
  logoLeft: number;
}) =>
  presetDocument({
    title: `${PRODUCT} pricing — ${title}`,
    width,
    height,
    fonts: FONTS,
    palette: PALETTE,
    css: `${BASE_CSS}${css}`,
    body: `
      ${background}
      ${logo(logoSize, logoTop, logoLeft)}
      <div class="page" data-agent-native-node-id="page" data-agent-native-layer-name="Page">${nav}${hero}${tiers}${compare}${faq}${footer}
      </div>`,
  });

const DESKTOP_H = 2710;
const TABLET_H = 3302;
const MOBILE_H = 4484;

const desktop = page({
  title: "Desktop",
  width: 1440,
  height: DESKTOP_H,
  logoSize: 22,
  logoTop: 32,
  logoLeft: 120,
  css: `
      .page { padding:0 120px; }
      .top { height:88px; }
      .hero { margin-top:56px; }
      .hero h1 { max-width:880px; font-size:64px; line-height:1.02; }
      .lede { max-width:620px; font-size:19px; }
      .toggle { margin-top:36px; }
      .tiers { grid-template-columns:repeat(3, 1fr); gap:20px; margin-top:48px; }
      .cmp-row { min-height:48px; }
      .cmp-group { min-height:36px; }
      .compare { margin-top:96px; }
      .section-head h2 { font-size:40px; line-height:1.1; }
      .section-head p { font-size:17px; }
      .cmp { margin-top:32px; }
      .faq-wrap { margin-top:96px; }
      .faq { grid-template-columns:repeat(3, 1fr); gap:40px 56px; margin-top:36px; }
      .cta { display:flex; align-items:center; justify-content:space-between; gap:48px; margin-top:96px; padding:56px 64px; }
      .cta h2 { font-size:40px; line-height:1.1; }
      .cta p { margin-top:10px; font-size:17px; }
      .foot { height:96px; }
    `,
});

const tablet = page({
  title: "Tablet",
  width: 768,
  height: TABLET_H,
  logoSize: 20,
  logoTop: 30,
  logoLeft: 40,
  css: `
      .page { padding:0 40px; }
      .top { height:84px; }
      .nav a:not(.btn) { display:none; }
      .nav .btn { height:42px; padding:0 18px; font-size:15px; }
      .hero { margin-top:56px; }
      .hero h1 { max-width:620px; font-size:48px; line-height:1.05; }
      .lede { max-width:560px; font-size:17px; }
      .toggle { margin-top:32px; }
      .tiers { grid-template-columns:1fr; gap:16px; margin-top:44px; }
      .tier { display:grid; grid-template-columns:1fr 1fr; gap:40px; padding:32px; }
      .tier .feat-lead { margin-top:0; padding-top:0; border-top:0; }
      .feats li:first-child { margin-top:14px; }
      .compare { margin-top:88px; }
      .section-head h2 { font-size:34px; line-height:1.1; }
      .section-head p { font-size:16px; }
      .cmp { margin-top:28px; }
      .cmp-row { grid-template-columns:1.5fr repeat(3, 1fr); padding:0 20px; font-size:14px; }
      .cmp-head { font-size:15px; }
      .faq-wrap { margin-top:88px; }
      .faq { grid-template-columns:1fr 1fr; gap:32px 40px; margin-top:28px; }
      .cta { margin-top:88px; padding:48px 44px; }
      .cta h2 { font-size:34px; line-height:1.1; }
      .cta p { margin-top:10px; font-size:16px; }
      .cta-btns { margin-top:28px; }
      .foot { height:92px; }
    `,
});

const mobile = page({
  title: "Mobile",
  width: 390,
  height: MOBILE_H,
  logoSize: 18,
  logoTop: 24,
  logoLeft: 20,
  css: `
      .page { padding:0 20px; }
      .top { height:70px; }
      .nav { display:none; }
      .menu { display:grid; place-items:center; width:44px; height:44px; margin-right:-10px; }
      .hero { margin-top:36px; }
      .hero h1 { font-size:38px; line-height:1.06; }
      .lede { font-size:16px; }
      .toggle { margin-top:28px; }
      .toggle > span { padding:0 16px; }
      .tiers { grid-template-columns:1fr; gap:16px; margin-top:36px; }
      .tier { padding:26px 24px; }
      .amt { font-size:50px; }
      .compare { margin-top:72px; }
      .section-head h2 { font-size:30px; line-height:1.1; }
      .section-head p { font-size:15px; }
      .cmp { margin-top:24px; border-radius:20px; }
      .cmp-row { grid-template-columns:repeat(3, 1fr); row-gap:8px; padding:14px 16px; min-height:0; font-size:14px; }
      .cmp-row > span:first-child { grid-column:1 / -1; font-weight:600; }
      .cmp-head { padding:16px; font-size:14px; }
      .cmp-head > span:first-child { display:none; }
      .cmp-group { padding:10px 16px; min-height:0; font-size:12px; }
      .faq-wrap { margin-top:72px; }
      .faq { grid-template-columns:1fr; gap:28px; margin-top:24px; }
      .faq h4 { font-size:16px; }
      .cta { margin-top:72px; padding:36px 26px; border-radius:24px; }
      .cta h2 { font-size:30px; line-height:1.1; }
      .cta p { margin-top:10px; font-size:15px; }
      .cta-btns { flex-direction:column; margin-top:24px; }
      .foot { flex-direction:column; align-items:flex-start; justify-content:center; gap:12px; height:120px; }
    `,
});

const guide = guideFrame({
  title: "How breakpoints work",
  documentTitle: `${PRODUCT} pricing — How breakpoints work`,
  intro:
    "One page at three widths, each laid out by hand and sharing the same tokens.",
  logo: logo(20, 52, 96),
  fonts: FONTS,
  palette: PALETTE,
  displayFont: DISPLAY,
  bodyFont: "'Inter', sans-serif",
  steps: [
    {
      title: "Change content everywhere",
      body: "Prices, plan names and FAQ copy appear in all three frames. Edit one and ask the agent to match the others.",
      prompt: "Raise the Team price to $18 in all three frames.",
    },
    {
      title: "Restyle with tokens",
      body: "Every frame reads the same color tokens, so one change restyles desktop, tablet and mobile together.",
      prompt: "Make the accent a deep forest green.",
    },
    {
      title: "Add a breakpoint",
      body: "New widths start from the frames you have. The agent reflows the layout instead of scaling it down.",
      prompt: "Add a 1024-wide laptop frame to the right of the mobile frame.",
    },
  ],
});

export const pricingPage: DesignTemplatePreset = {
  id: "preset-pricing-page",
  title: "SaaS pricing page",
  description:
    "A pricing page with three plans, a comparison table and an FAQ, laid out for desktop, tablet and mobile, plus a guide to working across breakpoints.",
  category: "landing-page",
  width: 1440,
  height: DESKTOP_H,
  filename: "pricing-desktop.html",
  content: desktop,
  frames: [
    {
      key: "tablet",
      filename: "pricing-tablet.html",
      x: 1560,
      y: 0,
      width: 768,
      height: TABLET_H,
      content: tablet,
    },
    {
      key: "mobile",
      filename: "pricing-mobile.html",
      x: 2448,
      y: 0,
      width: 390,
      height: MOBILE_H,
      content: mobile,
    },
    {
      key: "guide",
      filename: "how-breakpoints-work.html",
      x: 0,
      y: DESKTOP_H + 240,
      width: 1440,
      height: 620,
      content: guide,
    },
  ],
};
