import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";
import { guideFrame } from "./guide.js";

// A six-slide seed deck for a made-up restaurant ordering startup. Every
// slide shares one grid, header, footer and set of tokens, so the agent can
// rewrite a single slide or restyle the whole deck in one pass.
const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#F6F2EA",
  // guard:allow-raw-color — authored template palette, not app chrome.
  surface: "#FFFFFF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#1B2A22",
  // guard:allow-raw-color — authored template palette, not app chrome.
  soft: "#56635C",
  // guard:allow-raw-color — authored template palette, not app chrome.
  line: "rgba(27, 42, 34, 0.12)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accent: "#E0572B",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accentSoft: "#FBE3D6",
  // guard:allow-raw-color — authored template palette, not app chrome.
  leaf: "#2F6B4A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  leafSoft: "#DDEBE0",
  // guard:allow-raw-color — authored template palette, not app chrome.
  gold: "#E8B04A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  mist: "#B4C2BA",
  // guard:allow-raw-color — authored template palette, not app chrome.
  bar: "#C9D5CD",
  // guard:allow-raw-color — authored template palette, not app chrome.
  lineDark: "rgba(246, 242, 234, 0.16)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  shadow: "rgba(27, 42, 34, 0.10)",
};

const PALETTE = {
  canvas: C.paper,
  paper: C.paper,
  surface: C.surface,
  ink: C.ink,
  soft: C.soft,
  line: C.line,
  accent: C.accent,
  "accent-soft": C.accentSoft,
  leaf: C.leaf,
  "leaf-soft": C.leafSoft,
  gold: C.gold,
  mist: C.mist,
  bar: C.bar,
  "line-dark": C.lineDark,
  shadow: C.shadow,
  "font-display": "'Fraunces', serif",
  "font-body": "'Inter', sans-serif",
};

const FONTS =
  "family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600;700";

const DECK = {
  company: "Tallyroot",
  round: "Seed round · March 2026",
  total: 6,
};

// One grid for every slide: 120px side margins, header at 72, content from
// 200 to 920, footer rule at 960 and footer text at 1000.
const BASE_CSS = `
      .artboard { color:var(--ink); font-family:var(--font-body); }
      .display { font-family:var(--font-display); font-weight:600; letter-spacing:-.025em; text-wrap:balance; }
      .slide-label { position:absolute; top:74px; right:120px; z-index:3; display:flex; align-items:center; gap:12px; color:var(--soft); font-size:20px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; }
      .slide-label i { display:block; width:10px; height:10px; border-radius:50%; background:var(--accent); }
      .content { position:absolute; left:120px; right:120px; top:200px; bottom:160px; z-index:2; }
      .footer { position:absolute; left:120px; right:120px; bottom:56px; z-index:2; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; padding-top:28px; border-top:1px solid var(--line); color:var(--soft); font-size:18px; font-weight:500; }
      .footer b { justify-self:end; color:var(--ink); font-weight:600; font-variant-numeric:tabular-nums; }
      .title { font-size:76px; line-height:1.04; }
      .kicker { color:var(--soft); font-size:26px; line-height:1.45; }
      .card { border:1px solid var(--line); border-radius:28px; background:var(--surface); }
      .avatar { display:grid; place-items:center; flex:none; border-radius:50%; font-weight:600; }
`;

// Dark slides (title and ask) swap the chrome onto the ink background.
const DARK_CSS = `
      .artboard { background:var(--ink); color:var(--paper); }
      .artboard .slide-label, .artboard .footer, .artboard .kicker { color:var(--mist); }
      .artboard .footer { border-top-color:var(--line-dark); }
      .artboard .footer b { color:var(--paper); }
`;

const background = (dark: boolean) =>
  `<div style="position:absolute;inset:0;background:var(${dark ? "--ink" : "--paper"})" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>`;

const mark = (size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" style="fill:var(--accent)"/><path d="M16 7v11M16 18c0-4 3-6 7-6M16 18c0-3-2.5-5-6-5M9 22h14M12 25.5h8" style="fill:none;stroke:var(--surface)" stroke-width="2.4" stroke-linecap="round"/></svg>`;

const logo = (dark: boolean, size = 28, top = 68, left = 120) =>
  `<div style="position:absolute;top:${top}px;left:${left}px;z-index:3;display:flex;align-items:center;gap:${Math.round(size * 0.4)}px;color:var(${dark ? "--paper" : "--ink"});font:600 ${size}px/1 var(--font-display);letter-spacing:-.02em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        ${mark(Math.round(size * 1.3))}
        <span>${DECK.company}</span>
      </div>`;

const slide = ({
  n,
  label,
  css = "",
  body,
  dark = false,
}: {
  n: number;
  label: string;
  css?: string;
  body: string;
  dark?: boolean;
}) =>
  presetDocument({
    title: `${DECK.company} — ${n}. ${label}`,
    width: 1920,
    height: 1080,
    fonts: FONTS,
    palette: PALETTE,
    css: `${BASE_CSS}${dark ? DARK_CSS : ""}${css}`,
    body: `
      ${background(dark)}
      ${logo(dark)}
      <p class="slide-label" data-agent-native-node-id="slide-label" data-agent-native-layer-name="Slide label"><i></i>${label}</p>
      ${body}
      <p class="footer" data-agent-native-node-id="footer" data-agent-native-layer-name="Footer"><span>${DECK.company} · ${DECK.round}</span><span>Confidential</span><b data-agent-native-node-id="slide-number" data-agent-native-layer-name="Slide number">0${n} / 0${DECK.total}</b></p>`,
  });

// 1 — Title
const receiptLine = (item: string, qty: string) =>
  `<div style="display:flex;justify-content:space-between;padding:14px 0;border-bottom:1px dashed var(--line);font-size:22px"><span>${item}</span><b style="font-weight:600;font-variant-numeric:tabular-nums">${qty}</b></div>`;

const titleSlide = slide({
  n: 1,
  label: "Seed deck",
  dark: true,
  css: `
      .hero { position:absolute; left:120px; top:250px; width:1040px; z-index:2; }
      .pill { display:inline-flex; align-items:center; gap:12px; height:48px; padding:0 22px; border:1.5px solid var(--line-dark); border-radius:999px; color:var(--paper); font-size:20px; font-weight:600; }
      .pill i { display:block; width:10px; height:10px; border-radius:50%; background:var(--gold); }
      .hero h1 { margin-top:40px; font-size:116px; line-height:.98; }
      .hero h1 em { font-style:italic; color:var(--gold); }
      .hero p { margin-top:36px; max-width:860px; }
      .presenter { position:absolute; left:120px; top:840px; z-index:2; color:var(--mist); font-size:22px; }
      .presenter b { color:var(--paper); font-weight:600; }
      .orb { position:absolute; left:1240px; top:200px; width:560px; height:560px; border-radius:50%; background:var(--accent); z-index:1; }
      .receipt { position:absolute; left:1300px; top:250px; z-index:2; width:440px; padding:36px 36px 30px; border-radius:22px; background:var(--surface); color:var(--ink); box-shadow:0 40px 80px var(--shadow); transform:rotate(3deg); }
  `,
  body: `
      <div class="hero" data-agent-native-node-id="title-copy" data-agent-native-layer-name="Title copy">
        <p class="pill" data-agent-native-node-id="round-pill" data-agent-native-layer-name="Round pill"><i></i>${DECK.round}</p>
        <h1 class="display" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">Kitchens that order only what they'll <em>actually use.</em></h1>
        <p class="kicker" data-agent-native-node-id="subhead" data-agent-native-layer-name="Subhead">Inventory and ordering for independent restaurants, forecast from what sold last night.</p>
      </div>
      <p class="presenter" data-agent-native-node-id="presenter" data-agent-native-layer-name="Presenter"><b>Ines Okafor</b> · Co-founder and CEO</p>
      <div class="orb" aria-hidden="true" data-agent-native-node-id="orb" data-agent-native-layer-name="Accent circle"></div>
      <div class="receipt" data-agent-native-node-id="receipt" data-agent-native-layer-name="Order receipt">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="display" style="font-size:30px">Thursday order</span><span style="color:var(--soft);font-size:18px">6:00am</span></div>
        <div style="margin-top:6px;color:var(--soft);font-size:18px">Forecast from 184 covers</div>
        <div style="margin-top:18px">
          ${receiptLine("Roma tomatoes", "7 kg")}
          ${receiptLine("Chicken thighs", "7 kg")}
          ${receiptLine("Whole milk", "8 L")}
          ${receiptLine("Sourdough loaves", "12")}
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:22px;padding:14px 16px;border-radius:12px;background:var(--leaf-soft);color:var(--leaf);font-size:18px;font-weight:600"><span style="display:block;width:10px;height:10px;border-radius:50%;background:var(--leaf)"></span>Sent to 4 suppliers</div>
      </div>`,
});

// 2 — Problem
const pain = (num: string, title: string, body: string, id: string) => `
        <li class="card" style="display:flex;flex-direction:column;padding:52px 48px" data-agent-native-node-id="${id}" data-agent-native-layer-name="${title}">
          <span class="display" style="color:var(--accent);font-size:96px;line-height:1">${num}</span>
          <span style="margin-top:auto;font-size:30px;font-weight:600;letter-spacing:-.01em">${title}</span>
          <span style="margin-top:12px;color:var(--soft);font-size:22px;line-height:1.5">${body}</span>
        </li>`;

const problemSlide = slide({
  n: 2,
  label: "The problem",
  css: `
      .content h2 { max-width:1380px; }
      .pains { display:grid; grid-template-columns:repeat(3, 1fr); gap:32px; margin-top:88px; }
      .pains li { min-height:400px; }
      .source { position:absolute; left:0; bottom:0; color:var(--soft); font-size:18px; }
  `,
  body: `
      <div class="content" data-agent-native-node-id="content" data-agent-native-layer-name="Content">
        <h2 class="display title" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">Independent kitchens throw away one dollar in every seven they spend on food.</h2>
        <ul class="pains" data-agent-native-node-id="pains" data-agent-native-layer-name="Pain points">
          ${pain("14%", "Of food spend is wasted", "Spoilage and over-ordering, by the owners' own counts.", "pain-waste")}
          ${pain("6 hrs", "Every week spent ordering", "Mostly after close, on paper or in group texts to suppliers.", "pain-time")}
          ${pain("3 in 4", "Still order on gut feel", "Par levels get set once at opening and never revisited.", "pain-gut")}
        </ul>
        <p class="source" data-agent-native-node-id="source" data-agent-native-layer-name="Source">Source: Tallyroot survey of 212 independent restaurant owners, November 2025.</p>
      </div>`,
});

// 3 — Solution, with the product itself
const orderRow = (
  item: string,
  onHand: string,
  forecast: string,
  order: string,
  supplier: string,
  flag = false,
) => `
              <div class="row">
                <span style="font-weight:600">${item}</span><span>${onHand}</span><span>${forecast}</span>
                <span><b class="qty"${flag ? ` style="background:var(--accent-soft)"` : ""}>${order}</b></span><span style="color:var(--soft)">${supplier}</span>
              </div>`;

const solutionSlide = slide({
  n: 3,
  label: "The solution",
  css: `
      .pitch { position:absolute; left:120px; top:200px; width:620px; z-index:2; }
      .pitch h2 { font-size:68px; line-height:1.05; }
      .points { display:flex; flex-direction:column; gap:30px; margin-top:52px; }
      .points li { display:flex; gap:20px; font-size:22px; line-height:1.45; }
      .points li span:first-child { flex:none; display:grid; place-items:center; width:40px; height:40px; border-radius:50%; background:var(--ink); color:var(--paper); font-size:18px; font-weight:700; }
      .points b { font-weight:600; }
      .points p { color:var(--soft); }
      .app { position:absolute; left:800px; top:196px; z-index:2; display:grid; grid-template-columns:200px 1fr; width:1000px; height:700px; overflow:hidden; border-radius:24px; box-shadow:0 40px 90px var(--shadow); }
      .side { display:flex; flex-direction:column; gap:6px; padding:28px 16px; background:var(--ink); color:var(--mist); font-size:17px; font-weight:500; }
      .side span { padding:12px 14px; border-radius:10px; }
      .side span.on { background:var(--line-dark); color:var(--paper); }
      .main { display:flex; flex-direction:column; padding:32px 36px; background:var(--surface); }
      .row { display:grid; grid-template-columns:1.5fr .8fr .8fr .8fr 1.5fr; align-items:center; padding:15px 0; border-bottom:1px solid var(--line); font-size:17px; font-variant-numeric:tabular-nums; }
      .row.head { padding-top:0; color:var(--soft); font-size:14px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; }
      .qty { display:inline-block; padding:5px 12px; border-radius:8px; background:var(--leaf-soft); font-weight:600; }
  `,
  body: `
      <div class="pitch" data-agent-native-node-id="pitch" data-agent-native-layer-name="Pitch">
        <h2 class="display" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">Tallyroot writes tomorrow's order from tonight's sales.</h2>
        <ol class="points" data-agent-native-node-id="points" data-agent-native-layer-name="Points">
          <li><span>1</span><div><b>Reads the till.</b><p>Pulls last night's sales from the POS, dish by dish.</p></div></li>
          <li><span>2</span><div><b>Forecasts the week.</b><p>Bookings, weather and local events all count.</p></div></li>
          <li><span>3</span><div><b>Sends it by 6am.</b><p>One tap orders from every supplier at once.</p></div></li>
        </ol>
      </div>
      <div class="app" data-agent-native-node-id="app" data-agent-native-layer-name="Product UI">
        <div class="side" data-agent-native-node-id="app-nav" data-agent-native-layer-name="App navigation">
          <div style="display:flex;align-items:center;gap:10px;padding:0 10px 22px;color:var(--paper);font:600 20px/1 var(--font-display)">${mark(28)}Tallyroot</div>
          <span class="on">Orders</span><span>Inventory</span><span>Suppliers</span><span>Recipes</span><span>Reports</span>
        </div>
        <div class="main" data-agent-native-node-id="app-order" data-agent-native-layer-name="Order screen">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div><div style="color:var(--soft);font-size:15px">Juniper &amp; Rye · Main kitchen</div><div class="display" style="margin-top:6px;font-size:34px">Order for Thu, Mar 12</div></div>
            <span style="display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px;border-radius:999px;background:var(--leaf-soft);color:var(--leaf);font-size:15px;font-weight:600"><span style="display:block;width:8px;height:8px;border-radius:50%;background:var(--leaf)"></span>Ready by 6:00am</span>
          </div>
          <div style="display:flex;align-items:center;gap:12px;margin:22px 0 24px;padding:14px 18px;border-radius:12px;background:var(--accent-soft);font-size:16px"><b style="font-weight:600">Friday covers up 18%.</b><span>Rain cleared from the forecast, so the patio is open.</span></div>
          <div class="row head"><span>Item</span><span>On hand</span><span>Need</span><span>Order</span><span>Supplier</span></div>
          ${orderRow("Roma tomatoes", "4 kg", "11 kg", "7 kg", "Greenleaf Produce", true)}
          ${orderRow("Chicken thighs", "9 kg", "16 kg", "7 kg", "Hollis Butchers")}
          ${orderRow("Whole milk", "6 L", "14 L", "8 L", "Dale Farm Dairy")}
          ${orderRow("Basil", "2 bn", "5 bn", "3 bn", "Greenleaf Produce")}
          ${orderRow("Unsalted butter", "1 kg", "3 kg", "2 kg", "Dale Farm Dairy")}
          ${orderRow("Sourdough loaves", "0", "12", "12", "Fourth St Bakery")}
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto">
            <span style="color:var(--soft);font-size:16px">23 items · est. $1,284</span>
            <span style="display:inline-flex;align-items:center;height:52px;padding:0 26px;border-radius:999px;background:var(--ink);color:var(--paper);font-size:17px;font-weight:600">Send to 4 suppliers</span>
          </div>
        </div>
      </div>`,
});

// 4 — Traction: monthly recurring revenue, Apr 2025 to Mar 2026, in $k
const MRR = [4, 6, 8, 11, 14, 17, 21, 25, 30, 36, 41, 48];
const MONTHS = ["A", "M", "J", "J", "A", "S", "O", "N", "D", "J", "F", "M"];
const chart = (() => {
  const w = 1000,
    h = 440,
    left = 64,
    bottom = 390,
    top = 30,
    max = 50;
  const step = (w - left) / MRR.length;
  const bw = step * 0.62;
  const y = (v: number) => bottom - (v / max) * (bottom - top);
  const grid = [0, 10, 20, 30, 40, 50]
    .map(
      (v) =>
        `<line x1="${left}" x2="${w}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)" stroke-width="1.5"/><text x="${left - 16}" y="${y(v) + 6}" text-anchor="end" style="fill:var(--soft);font:500 17px var(--font-body)">${v === 0 ? "$0" : `$${v}k`}</text>`,
    )
    .join("");
  const bars = MRR.map((v, i) => {
    const x = left + i * step + (step - bw) / 2;
    const last = i === MRR.length - 1;
    return `<rect x="${x}" y="${y(v)}" width="${bw}" height="${bottom - y(v)}" rx="8" style="fill:var(${last ? "--accent" : "--leaf"})${last ? "" : ";opacity:.85"}"/><text x="${x + bw / 2}" y="${bottom + 36}" text-anchor="middle" style="fill:var(--soft);font:500 17px var(--font-body)">${MONTHS[i]}</text>`;
  }).join("");
  const lx = left + 11 * step + step / 2;
  return `<svg width="${w}" height="${h + 20}" viewBox="0 0 ${w} ${h + 20}" role="img" aria-label="Monthly recurring revenue grew from $4k in April 2025 to $48k in March 2026">${grid}${bars}<text x="${lx}" y="${y(48) - 16}" text-anchor="middle" style="fill:var(--ink);font:600 22px var(--font-body)">$48k</text></svg>`;
})();

const stat = (num: string, label: string, note: string, id: string) => `
          <li style="padding:24px 0;border-top:1px solid var(--line)" data-agent-native-node-id="${id}" data-agent-native-layer-name="${label}">
            <div class="display" style="font-size:76px;line-height:1">${num}</div>
            <div style="margin-top:12px;font-size:24px;font-weight:600">${label}</div>
            <div style="margin-top:4px;color:var(--soft);font-size:20px">${note}</div>
          </li>`;

const tractionSlide = slide({
  n: 4,
  label: "Traction",
  css: `
      .content h2 { font-size:68px; }
      .chart { position:absolute; left:0; top:124px; padding:32px 40px 16px 20px; border:1px solid var(--line); border-radius:28px; background:var(--surface); }
      .chart-title { margin:0 0 12px 44px; font-size:20px; font-weight:600; }
      .chart-title span { color:var(--soft); font-weight:500; }
      .stats { position:absolute; right:0; top:124px; width:500px; }
  `,
  body: `
      <div class="content" data-agent-native-node-id="content" data-agent-native-layer-name="Content">
        <h2 class="display title" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">Revenue up 25% a month since April.</h2>
        <figure class="chart" data-agent-native-node-id="chart" data-agent-native-layer-name="Revenue chart">
          <figcaption class="chart-title">Monthly recurring revenue <span>· Apr 2025 to Mar 2026</span></figcaption>
          ${chart}
        </figure>
        <ul class="stats" data-agent-native-node-id="stats" data-agent-native-layer-name="Key numbers">
          ${stat("$48k", "Monthly recurring revenue", "Up from $4k in April", "stat-mrr")}
          ${stat("140", "Kitchens live", "Across nine cities, 6% monthly churn", "stat-kitchens")}
          ${stat("22%", "Less food waste", "Average after 90 days on Tallyroot", "stat-waste")}
        </ul>
      </div>`,
});

// 5 — Team
const person = (
  initials: string,
  bg: string,
  fg: string,
  name: string,
  role: string,
  bio: string,
  id: string,
) => `
          <li class="card" style="display:flex;flex-direction:column;padding:40px" data-agent-native-node-id="${id}" data-agent-native-layer-name="${name}">
            <span class="avatar display" style="width:112px;height:112px;background:var(${bg});color:var(${fg});font-size:40px">${initials}</span>
            <span style="margin-top:32px;font-size:30px;font-weight:600;letter-spacing:-.01em">${name}</span>
            <span style="margin-top:6px;color:var(--leaf);font-size:20px;font-weight:600">${role}</span>
            <span style="margin-top:20px;color:var(--soft);font-size:21px;line-height:1.5">${bio}</span>
          </li>`;

const teamSlide = slide({
  n: 5,
  label: "The team",
  css: `
      .people { display:grid; grid-template-columns:repeat(4, 1fr); gap:28px; margin-top:68px; }
      .advisors { position:absolute; left:0; bottom:0; color:var(--soft); font-size:20px; }
      .advisors b { color:var(--ink); font-weight:600; }
  `,
  body: `
      <div class="content" data-agent-native-node-id="content" data-agent-native-layer-name="Content">
        <h2 class="display title" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">Cooks and engineers who have all lived the 11pm order.</h2>
        <ul class="people" data-agent-native-node-id="people" data-agent-native-layer-name="People">
          ${person("IO", "--accent", "--ink", "Ines Okafor", "Co-founder, CEO", "Ran two neighborhood bistros for nine years and wrote every order by hand.", "person-ines")}
          ${person("TR", "--leaf", "--surface", "Tomasz Rehn", "Co-founder, CTO", "Built demand forecasting for a regional grocer's 300 stores.", "person-tomasz")}
          ${person("PD", "--gold", "--ink", "Priya Dalal", "Head of Product", "Took a restaurant POS product from 40 to 4,000 customers.", "person-priya")}
          ${person("MB", "--ink", "--paper", "Marcus Bell", "Head of Sales", "Line cook turned food-service sales lead across the Midwest.", "person-marcus")}
        </ul>
        <p class="advisors" data-agent-native-node-id="advisors" data-agent-native-layer-name="Advisors"><b>Advisors</b> · Dana Whitlow, restaurant group operator · Raj Menon, former VP at a food distributor</p>
      </div>`,
});

// 6 — The ask
const FUNDS = [
  {
    label: "Engineering and forecasting",
    pct: 45,
    amount: "$1.44M",
    color: "--accent",
  },
  { label: "Sales and onboarding", pct: 30, amount: "$0.96M", color: "--gold" },
  {
    label: "Supplier integrations",
    pct: 15,
    amount: "$0.48M",
    color: "--leaf-soft",
  },
  {
    label: "Operations and buffer",
    pct: 10,
    amount: "$0.32M",
    color: "--mist",
  },
];

const askSlide = slide({
  n: 6,
  label: "The ask",
  dark: true,
  css: `
      .raise { position:absolute; left:120px; top:220px; width:740px; z-index:2; }
      .raise h2 { font-size:68px; line-height:1.04; }
      .big { margin-top:72px; font-size:220px; line-height:.9; color:var(--gold); }
      .big-note { margin-top:20px; color:var(--mist); font-size:24px; }
      .funds { position:absolute; left:960px; right:120px; top:236px; z-index:2; }
      .funds h3 { font-size:22px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--mist); }
      .stack { display:flex; gap:6px; height:28px; margin-top:28px; }
      .stack span { display:block; border-radius:6px; }
      .fund { display:grid; grid-template-columns:20px 1fr auto auto; align-items:center; gap:20px; padding:28px 0; border-bottom:1px solid var(--line-dark); font-size:24px; }
      .fund i { display:block; width:20px; height:20px; border-radius:6px; }
      .fund b { width:80px; text-align:right; font-weight:600; font-variant-numeric:tabular-nums; }
      .fund span:last-child { width:110px; text-align:right; color:var(--mist); font-variant-numeric:tabular-nums; }
      .milestones { display:grid; grid-template-columns:repeat(3, 1fr); gap:20px; margin-top:56px; }
      .milestones li { padding:28px 28px 26px; border:1px solid var(--line-dark); border-radius:18px; }
      .milestones div { font-size:48px; line-height:1; }
      .milestones p { margin-top:10px; color:var(--mist); font-size:20px; }
  `,
  body: `
      <div class="raise" data-agent-native-node-id="raise" data-agent-native-layer-name="Raise">
        <h2 class="display" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">We're raising a seed round to reach 1,000 kitchens.</h2>
        <div class="display big" data-agent-native-node-id="amount" data-agent-native-layer-name="Amount">$3.2M</div>
        <p class="big-note" data-agent-native-node-id="amount-note" data-agent-native-layer-name="Amount note">Seed · $800k already committed</p>
      </div>
      <div class="funds" data-agent-native-node-id="funds" data-agent-native-layer-name="Use of funds">
        <h3>Use of funds</h3>
        <div class="stack" aria-hidden="true">${FUNDS.map((f) => `<span style="flex:${f.pct};background:var(${f.color})"></span>`).join("")}</div>
        <ul style="margin-top:16px">${FUNDS.map((f) => `<li class="fund"><i style="background:var(${f.color})"></i><span>${f.label}</span><b>${f.pct}%</b><span>${f.amount}</span></li>`).join("")}
        </ul>
        <ul class="milestones" data-agent-native-node-id="milestones" data-agent-native-layer-name="Milestones">
          <li><div class="display">18 mo</div><p>of runway</p></li>
          <li><div class="display">1,000</div><p>kitchens live</p></li>
          <li><div class="display">$500k</div><p>monthly revenue</p></li>
        </ul>
      </div>`,
});

const guide = guideFrame({
  title: "How this deck works",
  documentTitle: `${DECK.company} — How this deck works`,
  intro:
    "Six slides on one grid. Edit any slide on its own, and the header, footer and tokens keep them consistent.",
  steps: [
    {
      title: "Rewrite one slide",
      body: "Each slide is its own file, so you can change one message without touching the rest.",
      prompt:
        "Rewrite the problem slide around time lost to ordering instead of food waste.",
    },
    {
      title: "Add a slide that fits",
      body: "New slides can copy the header, footer, grid and slide number from the ones here.",
      prompt:
        "Add a competition slide after traction that matches this deck, and renumber the footers.",
    },
    {
      title: "Change the type",
      body: "Fonts and colors are tokens at the top of each slide, shared across the deck.",
      prompt:
        "Swap Fraunces for Playfair Display on every slide and update the font link.",
    },
  ],
  logo: logo(false, 22, 52, 96),
  fonts: FONTS,
  palette: PALETTE,
  displayFont: "var(--font-display)",
  bodyFont: "var(--font-body)",
  width: 1920,
  height: 640,
});

export const pitchDeck: DesignTemplatePreset = {
  id: "preset-pitch-deck",
  title: "Pitch deck",
  description:
    "A six-slide seed deck at 1920 × 1080: title, problem, solution, traction, team and the ask, on one shared grid.",
  category: "presentation",
  width: 1920,
  height: 1080,
  filename: "deck-01-title.html",
  content: titleSlide,
  frames: [
    {
      key: "problem",
      filename: "deck-02-problem.html",
      x: 2040,
      y: 0,
      width: 1920,
      height: 1080,
      content: problemSlide,
    },
    {
      key: "solution",
      filename: "deck-03-solution.html",
      x: 4080,
      y: 0,
      width: 1920,
      height: 1080,
      content: solutionSlide,
    },
    {
      key: "traction",
      filename: "deck-04-traction.html",
      x: 0,
      y: 1320,
      width: 1920,
      height: 1080,
      content: tractionSlide,
    },
    {
      key: "team",
      filename: "deck-05-team.html",
      x: 2040,
      y: 1320,
      width: 1920,
      height: 1080,
      content: teamSlide,
    },
    {
      key: "ask",
      filename: "deck-06-ask.html",
      x: 4080,
      y: 1320,
      width: 1920,
      height: 1080,
      content: askSlide,
    },
    {
      key: "guide",
      filename: "how-this-deck-works.html",
      x: 0,
      y: 2640,
      width: 1920,
      height: 640,
      content: guide,
    },
  ],
};
