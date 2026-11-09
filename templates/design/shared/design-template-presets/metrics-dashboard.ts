import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";
import { guideFrame } from "./guide.js";

// A store dashboard built from three components: the KPI card, the chart card
// and the table row. Each one is a single CSS class in BASE_CSS, used by both
// the dashboard and the Components sheet, so editing a component's class
// restyles every copy of it at once.
const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#F3F4F0",
  // guard:allow-raw-color — authored template palette, not app chrome.
  surface: "#FFFFFF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#15211B",
  // guard:allow-raw-color — authored template palette, not app chrome.
  soft: "#5B665F",
  // guard:allow-raw-color — authored template palette, not app chrome.
  softDark: "#A9B7AE",
  // guard:allow-raw-color — authored template palette, not app chrome.
  line: "rgba(21, 33, 27, 0.10)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  lineDark: "rgba(255, 255, 255, 0.10)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accent: "#2F7D55",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accentWash: "rgba(47, 125, 85, 0.12)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  good: "#1D7445",
  // guard:allow-raw-color — authored template palette, not app chrome.
  goodSoft: "#E2F2E7",
  // guard:allow-raw-color — authored template palette, not app chrome.
  bad: "#B42318",
  // guard:allow-raw-color — authored template palette, not app chrome.
  badSoft: "#FCE8E6",
  // guard:allow-raw-color — authored template palette, not app chrome.
  flatSoft: "#ECEEEA",
  // guard:allow-raw-color — authored template palette, not app chrome.
  avatarA: "#A35A14",
  // guard:allow-raw-color — authored template palette, not app chrome.
  avatarB: "#5B6DC8",
  // guard:allow-raw-color — authored template palette, not app chrome.
  avatarC: "#9A5BB0",
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
  "accent-wash": C.accentWash,
  good: C.good,
  "good-soft": C.goodSoft,
  bad: C.bad,
  "bad-soft": C.badSoft,
  "flat-soft": C.flatSoft,
  "avatar-a": C.avatarA,
  "avatar-b": C.avatarB,
  "avatar-c": C.avatarC,
};

const FONTS =
  "family=Manrope:wght@600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500";

const DISPLAY = "'Manrope', sans-serif";
const STORE = "Ferngrove";

// The three components. Every copy on both frames uses these classes.
const BASE_CSS = `
      .artboard { color:var(--ink); font-family:'Inter', sans-serif; font-feature-settings:'tnum' 1; }
      .display { font-family:${DISPLAY}; font-weight:700; letter-spacing:-.02em; }
      .btn { display:inline-flex; align-items:center; gap:8px; height:40px; padding:0 16px; border-radius:10px; font-size:14px; font-weight:600; white-space:nowrap; }
      .btn-ghost { border:1px solid var(--line); background:var(--surface); color:var(--ink); }
      .btn-primary { background:var(--ink); color:var(--surface); }
      .btn svg path { fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }

      /* Component: KPI card (.kpi + .up / .down / .flat / .is-empty) */
      .kpi { display:flex; flex-direction:column; padding:20px 22px; border:1px solid var(--line); border-radius:16px; background:var(--surface); }
      .kpi-label { color:var(--soft); font-size:14px; font-weight:500; }
      .kpi-row { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-top:12px; }
      .kpi-value { font:700 32px/1 ${DISPLAY}; letter-spacing:-.03em; }
      .spark { width:84px; height:32px; flex:none; }
      .spark path { fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
      .kpi-foot { display:flex; min-height:24px; align-items:center; gap:8px; margin-top:16px; color:var(--soft); font-size:13px; }
      .delta { display:inline-flex; align-items:center; gap:4px; height:24px; padding:0 8px; border-radius:999px; font-size:13px; font-weight:600; }
      .delta svg { width:10px; height:10px; }
      .delta svg path { fill:none; stroke:currentColor; stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round; }
      .kpi.up .delta { background:var(--good-soft); color:var(--good); }
      .kpi.up .spark { color:var(--good); }
      .kpi.down .delta { background:var(--bad-soft); color:var(--bad); }
      .kpi.down .spark { color:var(--bad); }
      .kpi.flat .delta { background:var(--flat-soft); color:var(--soft); }
      .kpi.flat .spark { color:var(--soft); }
      .kpi.is-empty .kpi-value { color:var(--soft); }
      .kpi.is-empty .spark { color:var(--line); }
      .kpi.is-empty .spark path { stroke-dasharray:4 5; stroke:var(--soft); opacity:.5; }

      /* Component: chart card (.chart-card + .is-empty) */
      .chart-card { display:flex; flex-direction:column; padding:22px 24px 18px; border:1px solid var(--line); border-radius:16px; background:var(--surface); }
      .chart-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
      .chart-title { font-size:15px; font-weight:600; }
      .chart-total { margin-top:6px; font:700 26px/1 ${DISPLAY}; letter-spacing:-.03em; }
      .chart-total small { margin-left:8px; color:var(--good); font:600 13px/1 'Inter', sans-serif; letter-spacing:0; }
      .legend { display:flex; gap:16px; color:var(--soft); font-size:13px; }
      .legend span { display:flex; align-items:center; gap:6px; }
      .legend i { display:block; width:14px; height:3px; border-radius:2px; background:var(--accent); }
      .legend i.prev { background:none; border-top:2px dashed var(--soft); height:0; }
      .plot { position:relative; flex:1; display:grid; grid-template-columns:44px 1fr; grid-template-rows:1fr 24px; margin-top:18px; min-height:0; }
      .y-axis { display:flex; flex-direction:column; justify-content:space-between; padding-bottom:0; color:var(--soft); font-size:12px; line-height:0; }
      .grid { position:relative; border-bottom:1px solid var(--line); background:repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px 25%); }
      .grid svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
      .grid .area { fill:var(--accent-wash); stroke:none; }
      .grid .now { fill:none; stroke:var(--accent); stroke-width:2.5; stroke-linejoin:round; stroke-linecap:round; }
      .grid .prev { fill:none; stroke:var(--soft); stroke-width:1.5; stroke-dasharray:4 5; opacity:.7; }
      .x-axis { grid-column:2; display:flex; justify-content:space-between; align-items:flex-end; color:var(--soft); font-size:12px; }
      .chart-empty { display:none; }
      .chart-card.is-empty .grid svg, .chart-card.is-empty .legend { display:none; }
      .chart-card.is-empty .chart-total { color:var(--soft); }
      .chart-card.is-empty .chart-empty { position:absolute; inset:0; display:grid; place-items:center; text-align:center; color:var(--soft); font-size:14px; line-height:1.5; }
      .chart-card.is-empty .chart-empty > div { padding:10px 18px; border-radius:12px; background:var(--surface); }
      .chart-card.is-empty .chart-empty b { display:block; color:var(--ink); font-weight:600; }

      /* Component: table row (.trow + status .up / .down / .flat, or .is-empty) */
      .trow { display:grid; grid-template-columns:112px 1.3fr 1.6fr 150px 128px 96px; align-items:center; gap:16px; height:52px; padding:0 24px; border-top:1px solid var(--line); background:var(--surface); font-size:14px; }
      .trow.thead { height:40px; background:var(--paper); color:var(--soft); font-size:12px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; }
      .trow .id { color:var(--soft); font-family:'JetBrains Mono', monospace; font-size:13px; }
      .trow .who { display:flex; align-items:center; gap:10px; font-weight:500; min-width:0; }
      .trow .items, .trow .when { color:var(--soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .trow .amt { text-align:right; font-weight:600; }
      .avatar { display:grid; place-items:center; flex:none; width:28px; height:28px; border-radius:50%; color:var(--surface); font-size:11px; font-weight:600; }
      .status { display:inline-flex; align-items:center; gap:6px; justify-self:start; height:26px; padding:0 10px; border-radius:999px; font-size:13px; font-weight:600; }
      .status i { display:block; width:6px; height:6px; border-radius:50%; background:currentColor; }
      .status.up { background:var(--good-soft); color:var(--good); }
      .status.down { background:var(--bad-soft); color:var(--bad); }
      .status.flat { background:var(--flat-soft); color:var(--soft); }
      .trow.is-empty { display:flex; justify-content:center; color:var(--soft); }
`;

const background = `<div style="position:absolute;inset:0;background:var(--paper)" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>`;

const logo = (size: number, top: number, left: number, onDark = false) =>
  `<div style="position:absolute;top:${top}px;left:${left}px;z-index:3;display:flex;align-items:center;gap:${Math.round(size * 0.45)}px;color:var(${onDark ? "--surface" : "--ink"});${onDark ? "background:var(--ink);" : ""}font:800 ${size}px/1 ${DISPLAY};letter-spacing:-.03em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="${Math.round(size * 1.4)}" height="${Math.round(size * 1.4)}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" style="fill:var(--accent)"/><path d="M16 26V14M16 14c0-5 3-8 8-8 0 5-3 8-8 8zM16 19c0-4-2.6-6.5-7-6.5 0 4 2.6 6.5 7 6.5z" style="fill:none;stroke:var(--surface)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${STORE}</span>
      </div>`;

// Deterministic sparkline and chart data.
const sparkPath = (points: number[]) => {
  const max = Math.max(...points);
  const min = Math.min(...points);
  // A minimum span keeps a flat series looking flat instead of jagged.
  const span = Math.max(max - min, 3);
  const mid = (max + min) / 2;
  return points
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${((i / (points.length - 1)) * 80 + 2).toFixed(1)} ${(16 - ((p - mid) / span) * 26).toFixed(1)}`,
    )
    .join(" ");
};

const arrow = (dir: "up" | "down" | "flat") =>
  dir === "flat"
    ? `<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 5h6"/></svg>`
    : `<svg viewBox="0 0 10 10" aria-hidden="true"><path d="${dir === "up" ? "M5 8.5V1.5M2 4.5l3-3 3 3" : "M5 1.5v7M2 5.5l3 3 3-3"}"/></svg>`;

interface Kpi {
  id: string;
  label: string;
  value: string;
  delta: string;
  note: string;
  state: "up" | "down" | "flat" | "is-empty";
  spark: number[];
}

const kpiCard = (k: Kpi) => `
          <article class="kpi ${k.state}" data-agent-native-node-id="${k.id}" data-agent-native-layer-name="KPI · ${k.label}">
            <div class="kpi-label">${k.label}</div>
            <div class="kpi-row"><span class="kpi-value">${k.value}</span><svg class="spark" viewBox="0 0 84 32" aria-hidden="true"><path d="${sparkPath(k.spark)}"/></svg></div>
            <div class="kpi-foot">${k.state === "is-empty" ? "" : `<span class="delta">${arrow(k.state)}${k.delta}</span>`}<span>${k.note}</span></div>
          </article>`;

const KPIS: Kpi[] = [
  {
    id: "kpi-revenue",
    label: "Revenue",
    value: "$84,210",
    delta: "12.4%",
    note: "vs. previous 30 days",
    state: "up",
    spark: [4, 5, 4.6, 6, 5.8, 7, 6.6, 8, 8.4, 9],
  },
  {
    id: "kpi-orders",
    label: "Orders",
    value: "1,932",
    delta: "8.1%",
    note: "vs. previous 30 days",
    state: "up",
    spark: [5, 4.4, 5.6, 5.2, 6.4, 6, 7.2, 6.8, 7.6, 8],
  },
  {
    id: "kpi-conversion",
    label: "Conversion rate",
    value: "3.2%",
    delta: "0.4 pts",
    note: "vs. previous 30 days",
    state: "down",
    spark: [8, 7.6, 8.2, 7, 7.2, 6.4, 6.8, 5.8, 6, 5.4],
  },
  {
    id: "kpi-aov",
    label: "Avg. order value",
    value: "$43.59",
    delta: "0.0%",
    note: "Flat for the month",
    state: "flat",
    spark: [6, 6.4, 5.8, 6.2, 6, 6.5, 5.9, 6.2, 6.1, 6],
  },
];

// 30 days of revenue: a gentle climb with weekend peaks.
const days = Array.from({ length: 30 }, (_, i) => i);
const now = days.map(
  (i) =>
    2300 +
    i * 28 +
    (i % 7 === 5 || i % 7 === 6 ? 700 : 0) +
    ((i * 37) % 11) * 38,
);
const prev = days.map(
  (i) =>
    2150 +
    i * 10 +
    (i % 7 === 5 || i % 7 === 6 ? 520 : 0) +
    ((i * 53) % 9) * 34,
);
const Y_MAX = 4000;
const line = (vals: number[]) =>
  vals
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${((i / 29) * 300).toFixed(1)} ${(100 - (v / Y_MAX) * 100).toFixed(1)}`,
    )
    .join(" ");

const chartCard = ({
  id,
  title,
  total,
  change,
  empty = false,
}: {
  id: string;
  title: string;
  total: string;
  change: string;
  empty?: boolean;
}) => `
          <article class="chart-card${empty ? " is-empty" : ""}" data-agent-native-node-id="${id}" data-agent-native-layer-name="Chart · ${title}">
            <div class="chart-head">
              <div><div class="chart-title">${title}</div><div class="chart-total">${total}${change ? `<small>${change}</small>` : ""}</div></div>
              <div class="legend"><span><i></i>This period</span><span><i class="prev"></i>Previous</span></div>
            </div>
            <div class="plot">
              <div class="y-axis"><span>$4k</span><span>$3k</span><span>$2k</span><span>$1k</span><span>$0</span></div>
              <div class="grid">
                <svg viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
                  <path class="area" d="${line(now)} L300 100 L0 100 Z"/>
                  <path class="prev" d="${line(prev)}" vector-effect="non-scaling-stroke"/>
                  <path class="now" d="${line(now)}" vector-effect="non-scaling-stroke"/>
                </svg>
                <div class="chart-empty"><div><b>Not enough data yet</b>Charts fill in after your first week of sales.</div></div>
              </div>
              <div class="x-axis"><span>Oct 11</span><span>Oct 18</span><span>Oct 25</span><span>Nov 1</span><span>Nov 9</span></div>
            </div>
          </article>`;

interface Order {
  id: string;
  initials: string;
  color: string;
  name: string;
  items: string;
  when: string;
  status: "up" | "down" | "flat";
  label: string;
  amount: string;
}

const tableHead = `
            <div class="trow thead"><span>Order</span><span>Customer</span><span>Items</span><span>Placed</span><span>Status</span><span class="amt">Amount</span></div>`;

const tableRow = (o: Order, node: string) => `
            <div class="trow" data-agent-native-node-id="${node}" data-agent-native-layer-name="Row · ${o.id}"><span class="id">${o.id}</span><span class="who"><span class="avatar" style="background:${o.color}">${o.initials}</span>${o.name}</span><span class="items">${o.items}</span><span class="when">${o.when}</span><span class="status ${o.status}"><i></i>${o.label}</span><span class="amt">${o.amount}</span></div>`;

const emptyRow = (node: string) => `
            <div class="trow is-empty" data-agent-native-node-id="${node}" data-agent-native-layer-name="Row · Empty">No orders in this range yet.</div>`;

const ORDERS: Order[] = [
  {
    id: "#FG-20931",
    initials: "MO",
    color: "var(--avatar-a)",
    name: "Maya Okafor",
    items: "Monstera deliciosa and 2 more",
    when: "Nov 9, 4:12 pm",
    status: "up",
    label: "Fulfilled",
    amount: "$128.00",
  },
  {
    id: "#FG-20930",
    initials: "TR",
    color: "var(--avatar-b)",
    name: "Tomás Rivera",
    items: "Glazed pot set, 3 sizes",
    when: "Nov 9, 3:47 pm",
    status: "flat",
    label: "Processing",
    amount: "$64.50",
  },
  {
    id: "#FG-20929",
    initials: "HL",
    color: "var(--avatar-c)",
    name: "Hanna Lindqvist",
    items: "Fiddle leaf fig, large",
    when: "Nov 9, 1:05 pm",
    status: "down",
    label: "Refunded",
    amount: "$89.00",
  },
  {
    id: "#FG-20928",
    initials: "DP",
    color: "var(--accent)",
    name: "Dev Patel",
    items: "Snake plant and care kit",
    when: "Nov 9, 11:30 am",
    status: "up",
    label: "Fulfilled",
    amount: "$52.00",
  },
  {
    id: "#FG-20927",
    initials: "AB",
    color: "var(--avatar-b)",
    name: "Ana Brennan",
    items: "Pothos trio, hanging planters",
    when: "Nov 9, 9:58 am",
    status: "up",
    label: "Fulfilled",
    amount: "$76.25",
  },
];

const CHANNELS = [
  ["Online store", "$40,420", 48],
  ["Instagram shop", "$18,530", 22],
  ["Wholesale", "$14,320", 17],
  ["Local pickup", "$7,580", 9],
  ["Saturday market", "$3,360", 4],
] as const;

const icon = (d: string) =>
  `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="${d}" style="fill:none;stroke:currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const NAV = [
  ["Overview", "M2.5 9.5 9 3l6.5 6.5M4.5 8v7h9V8"],
  ["Orders", "M3 4h12l-1.2 7.5H4.2L3 4zM6 15h.01M12 15h.01"],
  ["Products", "M9 2 15 5v8l-6 3-6-3V5l6-3zM3 5l6 3 6-3M9 8v8"],
  [
    "Customers",
    "M6.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM2 15c.5-2.6 2.2-4 4.5-4s4 1.4 4.5 4M12 4a2.3 2.3 0 0 1 0 4.4M13 11c1.7.4 2.7 1.8 3 4",
  ],
  ["Marketing", "M3 7v4h2l5 3V4L5 7H3zM13 6.5a3.5 3.5 0 0 1 0 5"],
  ["Reports", "M3 15V3M3 15h12M6.5 12V9M10 12V6M13.5 12V8"],
];

const dashboard = presetDocument({
  title: `${STORE} — Store overview`,
  width: 1440,
  height: 1024,
  fonts: FONTS,
  palette: PALETTE,
  css: `${BASE_CSS}
      .sidebar { position:absolute; left:0; top:0; bottom:0; width:248px; z-index:1; display:flex; flex-direction:column; padding:96px 16px 20px; background:var(--ink); color:var(--soft-dark); }
      .side-label { padding:0 12px 10px; font-size:12px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; }
      .side-nav a { display:flex; align-items:center; gap:12px; height:40px; padding:0 12px; border-radius:10px; color:var(--soft-dark); font-size:14px; font-weight:500; text-decoration:none; }
      .side-nav a.on { background:var(--line-dark); color:var(--surface); }
      .side-nav .count { margin-left:auto; color:var(--soft-dark); font-size:12px; }
      .store { margin-top:auto; display:flex; align-items:center; gap:12px; padding:12px; border:1px solid var(--line-dark); border-radius:12px; }
      .store b { display:block; color:var(--surface); font-size:14px; font-weight:600; }
      .store span { font-size:12px; }
      .main { position:absolute; left:248px; right:0; top:0; bottom:0; z-index:1; padding:32px 40px 32px; display:flex; flex-direction:column; gap:20px; }
      .topbar { display:flex; align-items:flex-end; justify-content:space-between; }
      .topbar h1 { font-size:28px; line-height:1.1; }
      .topbar p { margin-top:6px; color:var(--soft); font-size:14px; }
      .actions { display:flex; gap:10px; }
      .kpis { display:grid; grid-template-columns:repeat(4, 1fr); gap:20px; }
      .row2 { display:grid; grid-template-columns:1fr 360px; gap:20px; height:344px; }
      .panel { padding:22px 24px; border:1px solid var(--line); border-radius:16px; background:var(--surface); }
      .panel-head { display:flex; justify-content:space-between; align-items:baseline; }
      .panel-head h2 { font-size:15px; font-weight:600; }
      .panel-head span { color:var(--soft); font-size:13px; }
      .bd { margin-top:10px; }
      .bd li { padding:11px 0; border-top:1px solid var(--line); }
      .bd li:first-child { border-top:0; }
      .bd-top { display:flex; justify-content:space-between; font-size:14px; }
      .bd-top b { font-weight:600; }
      .bd-top em { margin-left:8px; color:var(--soft); font-style:normal; }
      .bar { height:6px; margin-top:8px; border-radius:3px; background:var(--flat-soft); }
      .bar i { display:block; height:100%; border-radius:3px; background:var(--accent); }
      .table { flex:1; overflow:hidden; border:1px solid var(--line); border-radius:16px; background:var(--surface); }
      .table .panel-head { align-items:center; height:56px; padding:0 24px; }
      .table .panel-head a { color:var(--accent); font-size:14px; font-weight:600; text-decoration:none; }
    `,
  body: `
      ${background}
      <aside class="sidebar" data-agent-native-node-id="sidebar" data-agent-native-layer-name="Sidebar">
        <div class="side-label">Store</div>
        <nav class="side-nav" data-agent-native-node-id="side-nav" data-agent-native-layer-name="Navigation">${NAV.map(
          ([label, d], i) =>
            `<a href="#" class="${i === 0 ? "on" : ""}">${icon(d)}${label}${label === "Orders" ? `<span class="count">12 new</span>` : ""}</a>`,
        ).join("")}</nav>
        <div class="store" data-agent-native-node-id="store-switcher" data-agent-native-layer-name="Store switcher">
          <span class="avatar" style="width:34px;height:34px;background:var(--avatar-a);font-size:12px">JS</span>
          <div><b>June Sato</b><span>Owner · Portland, OR</span></div>
        </div>
      </aside>
      ${logo(20, 30, 28, true)}
      <div class="main" data-agent-native-node-id="main" data-agent-native-layer-name="Main">
        <header class="topbar" data-agent-native-node-id="topbar" data-agent-native-layer-name="Top bar">
          <div><h1 class="display">Good afternoon, June</h1><p>Here's how the shop did over the last 30 days.</p></div>
          <div class="actions">
            <span class="btn btn-ghost">${icon("M3 5h12v10H3zM3 8h12M6 3v3M12 3v3")}Oct 11 – Nov 9</span>
            <span class="btn btn-primary">${icon("M9 3v8M5.5 7.5 9 11l3.5-3.5M3 14h12")}Export</span>
          </div>
        </header>
        <section class="kpis" data-agent-native-node-id="kpis" data-agent-native-layer-name="KPI cards">${KPIS.map(kpiCard).join("")}
        </section>
        <section class="row2">
          ${chartCard({ id: "chart-revenue", title: "Revenue per day", total: "$84,210", change: "+12.4% vs. previous" })}
          <article class="panel" data-agent-native-node-id="channels" data-agent-native-layer-name="Sales by channel">
            <div class="panel-head"><h2>Sales by channel</h2><span>Last 30 days</span></div>
            <ul class="bd">${CHANNELS.map(
              ([name, value, pct]) =>
                `<li><div class="bd-top"><span>${name}</span><span><b>${value}</b><em>${pct}%</em></span></div><div class="bar"><i style="width:${pct * 2}%"></i></div></li>`,
            ).join("")}</ul>
          </article>
        </section>
        <section class="table" data-agent-native-node-id="orders" data-agent-native-layer-name="Recent orders">
          <div class="panel-head"><h2>Recent orders</h2><a href="#">View all orders</a></div>${tableHead}${ORDERS.map((o, i) => tableRow(o, `order-${i + 1}`)).join("")}
        </section>
      </div>`,
});

const components = presetDocument({
  title: `${STORE} — Components`,
  width: 1440,
  height: 1030,
  fonts: FONTS,
  palette: PALETTE,
  css: `${BASE_CSS}
      .sheet { position:absolute; left:80px; right:80px; top:0; bottom:0; z-index:1; }
      .sheet-head { position:absolute; left:0; right:0; top:88px; display:flex; justify-content:space-between; align-items:flex-end; }
      .sheet-head h1 { font-size:36px; line-height:1.1; }
      .sheet-head p { margin-top:8px; color:var(--soft); font-size:16px; }
      .sheet-head small { color:var(--soft); font-size:14px; }
      .group { position:absolute; left:0; right:0; }
      .group-label { display:flex; align-items:center; gap:10px; height:20px; font-size:14px; font-weight:600; }
      .group-label code, .variant code { padding:2px 8px; border-radius:6px; background:var(--flat-soft); color:var(--ink); font:500 12px/1.4 'JetBrains Mono', monospace; }
      .variants { display:grid; gap:20px; margin-top:14px; }
      .variant { display:flex; flex-direction:column; gap:8px; }
      .variant > code { align-self:flex-start; color:var(--soft); }
      .rows { overflow:hidden; margin-top:14px; border:1px solid var(--line); border-radius:16px; }
      .rows .trow:first-child { border-top:0; }
    `,
  body: `
      ${background}
      ${logo(20, 36, 80)}
      <div class="sheet" data-agent-native-node-id="sheet" data-agent-native-layer-name="Components sheet">
        <div class="sheet-head" data-agent-native-node-id="sheet-head" data-agent-native-layer-name="Heading">
          <div><h1 class="display">Components</h1><p>The same classes the dashboard uses. Change one here and every copy follows.</p></div>
          <small>Up · Down · Neutral · Empty</small>
        </div>
        <section class="group" style="top:196px" data-agent-native-node-id="group-kpi" data-agent-native-layer-name="KPI card variants">
          <div class="group-label">KPI card <code>.kpi</code></div>
          <div class="variants" style="grid-template-columns:repeat(4, 1fr)">
            <div class="variant">${kpiCard({ ...KPIS[0], id: "kpi-up" })}<code>.kpi.up</code></div>
            <div class="variant">${kpiCard({ ...KPIS[2], id: "kpi-down" })}<code>.kpi.down</code></div>
            <div class="variant">${kpiCard({ ...KPIS[3], id: "kpi-flat" })}<code>.kpi.flat</code></div>
            <div class="variant">${kpiCard({ id: "kpi-empty", label: "Returning customers", value: "—", delta: "", note: "Shows up after 30 days of sales", state: "is-empty", spark: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5] })}<code>.kpi.is-empty</code></div>
          </div>
        </section>
        <section class="group" style="top:432px" data-agent-native-node-id="group-chart" data-agent-native-layer-name="Chart card variants">
          <div class="group-label">Chart card <code>.chart-card</code></div>
          <div class="variants" style="grid-template-columns:1fr 1fr;height:240px">
            ${chartCard({ id: "chart-default", title: "Revenue per day", total: "$84,210", change: "+12.4% vs. previous" })}
            ${chartCard({ id: "chart-empty", title: "Revenue per day", total: "$0", change: "", empty: true })}
          </div>
        </section>
        <section class="group" style="top:746px" data-agent-native-node-id="group-row" data-agent-native-layer-name="Table row variants">
          <div class="group-label">Table row <code>.trow</code> <span style="color:var(--soft);font-weight:500">with status <code>.up</code> <code>.down</code> <code>.flat</code> and <code>.is-empty</code></span></div>
          <div class="rows">${tableRow(ORDERS[0], "row-up")}${tableRow(ORDERS[2], "row-down")}${tableRow(ORDERS[1], "row-flat")}${emptyRow("row-empty")}
          </div>
        </section>
      </div>`,
});

const guide = guideFrame({
  title: "How components work",
  documentTitle: `${STORE} — How components work`,
  intro:
    "Each card and row is one shared class. Edit the class and every copy updates on both frames.",
  logo: logo(20, 52, 96),
  fonts: FONTS,
  palette: PALETTE,
  displayFont: DISPLAY,
  bodyFont: "'Inter', sans-serif",
  steps: [
    {
      title: "Change a component",
      body: "All eight KPI cards use the .kpi class. Restyle it once and the dashboard and Components sheet both follow.",
      prompt:
        "Give the KPI card component a 3px accent bar along the top. It'll update everywhere.",
    },
    {
      title: "Restyle with tokens",
      body: "Up, down and neutral states read color tokens, so one edit recolors every chip, sparkline and status.",
      prompt: "Make the accent a deep teal and the down state amber.",
    },
    {
      title: "Add a variant",
      body: "New states start on the Components sheet. Once a variant looks right, use it on the dashboard.",
      prompt:
        "Add a goal variant to the KPI card with a progress bar toward a $90k target.",
    },
  ],
});

export const metricsDashboard: DesignTemplatePreset = {
  id: "preset-metrics-dashboard",
  title: "Metrics dashboard",
  description:
    "A 1440 × 1024 store dashboard with KPI cards, a revenue chart, a channel breakdown and recent orders, plus a Components sheet showing every variant.",
  category: "other",
  width: 1440,
  height: 1024,
  filename: "dashboard.html",
  content: dashboard,
  frames: [
    {
      key: "components",
      filename: "dashboard-components.html",
      x: 1560,
      y: 0,
      width: 1440,
      height: 1030,
      content: components,
    },
    {
      key: "guide",
      filename: "how-components-work.html",
      x: 0,
      y: 1264,
      width: 1440,
      height: 620,
      content: guide,
    },
  ],
};
