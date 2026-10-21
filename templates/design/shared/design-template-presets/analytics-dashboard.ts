import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";

const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  canvas: "#EEF1F8",
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#FFFFFF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#1C2033",
  // guard:allow-raw-color — authored template palette, not app chrome.
  muted: "#6B7190",
  // guard:allow-raw-color — authored template palette, not app chrome.
  line: "#E3E7F2",
  // guard:allow-raw-color — authored template palette, not app chrome.
  indigo: "#6F6BE8",
  // guard:allow-raw-color — authored template palette, not app chrome.
  lilac: "#C9C6FA",
  // guard:allow-raw-color — authored template palette, not app chrome.
  sky: "#CFE3FF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  teal: "#2FB5A8",
};

const bars = [
  ["Direct", 92],
  ["Search", 78],
  ["Referral", 61],
  ["Social", 47],
  ["Email", 34],
]
  .map(
    ([label, value]) =>
      `<li><span>${label}</span><i style="width:${Number(value) * 4.4}px"></i><b>${value}%</b></li>`,
  )
  .join("");

export const analyticsDashboard: DesignTemplatePreset = {
  id: "preset-analytics-dashboard",
  title: "Analytics dashboard",
  description: "Track KPIs and metrics in one place.",
  category: "other",
  width: 1440,
  height: 900,
  filename: "analytics-dashboard.html",
  content: presetDocument({
    title: "Lumen — Analytics dashboard",
    width: 1440,
    height: 900,
    fonts: "family=Inter:wght@400;500;600;700",
    palette: {
      canvas: C.canvas,
      paper: C.paper,
      ink: C.ink,
      muted: C.muted,
      line: C.line,
      indigo: C.indigo,
      lilac: C.lilac,
      sky: C.sky,
      teal: C.teal,
    },
    css: `
      .artboard { color:var(--ink); font-family:'Inter', sans-serif; }
      .sidebar { position:absolute; left:0; top:0; bottom:0; width:240px; z-index:1; padding:84px 20px 24px; background:var(--paper); border-right:1px solid var(--line); }
      .sidebar li { display:flex; align-items:center; gap:12px; height:42px; padding:0 14px; border-radius:10px; color:var(--muted); font-size:15px; font-weight:500; }
      .sidebar li::before { content:""; width:16px; height:16px; border-radius:5px; background:var(--line); }
      .sidebar li.active { background:var(--canvas); color:var(--ink); }
      .sidebar li.active::before { background:var(--indigo); }
      .head { position:absolute; left:288px; right:48px; top:36px; z-index:1; display:flex; justify-content:space-between; align-items:center; }
      .head h1 { font-size:30px; font-weight:700; letter-spacing:-.02em; }
      .range { padding:10px 16px; border:1px solid var(--line); border-radius:999px; background:var(--paper); color:var(--muted); font-size:14px; font-weight:500; }
      .stats { position:absolute; left:288px; right:48px; top:116px; z-index:1; display:grid; grid-template-columns:repeat(4,1fr); gap:20px; }
      .stat { padding:22px 24px; border-radius:16px; background:var(--paper); border:1px solid var(--line); }
      .stat small { display:block; color:var(--muted); font-size:14px; font-weight:500; }
      .stat strong { display:block; margin-top:10px; font-size:36px; font-weight:700; letter-spacing:-.03em; }
      .stat em { display:block; margin-top:6px; color:var(--teal); font-size:13px; font-style:normal; font-weight:600; }
      .stat.hot { background:var(--indigo); border-color:var(--indigo); color:var(--paper); }
      .stat.hot small, .stat.hot em { color:var(--lilac); }
      .card { position:absolute; z-index:1; padding:26px 28px; border-radius:16px; background:var(--paper); border:1px solid var(--line); }
      .card h2 { font-size:18px; font-weight:600; letter-spacing:-.01em; }
      .revenue { left:288px; top:300px; width:520px; height:552px; }
      .revenue ul { margin-top:28px; display:grid; gap:22px; }
      .revenue li { display:grid; grid-template-columns:84px auto 1fr; align-items:center; gap:14px; font-size:14px; font-weight:500; color:var(--muted); }
      .revenue i { display:block; height:22px; border-radius:6px; background:linear-gradient(90deg, var(--indigo), var(--lilac)); }
      .revenue b { color:var(--ink); font-weight:600; text-align:right; }
      .engagement { left:832px; top:300px; right:48px; height:552px; }
      .engagement svg { position:absolute; left:28px; right:28px; bottom:84px; width:calc(100% - 56px); height:300px; }
      .engagement .axis { position:absolute; left:28px; right:28px; bottom:40px; display:flex; justify-content:space-between; color:var(--muted); font-size:13px; font-weight:500; }
      .pill { position:absolute; right:28px; top:24px; padding:6px 12px; border-radius:999px; background:var(--sky); color:var(--indigo); font-size:13px; font-weight:600; }
    `,
    body: `
      <div style="position:absolute;inset:0;background:${C.canvas}" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <aside class="sidebar" data-agent-native-node-id="sidebar" data-agent-native-layer-name="Sidebar">
        <ul>
          <li class="active">Overview</li><li>Audience</li><li>Revenue</li><li>Campaigns</li><li>Reports</li><li>Settings</li>
        </ul>
      </aside>
      <div style="position:absolute;left:24px;top:28px;z-index:2;display:flex;align-items:center;gap:10px;color:${C.ink};font:700 20px/1 'Inter',sans-serif;letter-spacing:-.02em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="8" fill="${C.indigo}"/><circle cx="14" cy="14" r="5" fill="${C.paper}"/></svg>
        <span>Lumen</span>
      </div>
      <header class="head" data-agent-native-node-id="header" data-agent-native-layer-name="Header">
        <h1>Overview</h1>
        <span class="range">Last 30 days</span>
      </header>
      <section class="stats" data-agent-native-node-id="stats" data-agent-native-layer-name="Stats">
        <div class="stat"><small>Total users</small><strong>1.2M</strong><em>+8.2% vs last month</em></div>
        <div class="stat"><small>Conversion rate</small><strong>4.8%</strong><em>+0.6 pts</em></div>
        <div class="stat hot"><small>New sign-ups</small><strong>25,000</strong><em>+12.4% vs last month</em></div>
        <div class="stat"><small>Avg. session</small><strong>6m 12s</strong><em>+14s</em></div>
      </section>
      <section class="card revenue" data-agent-native-node-id="revenue" data-agent-native-layer-name="Revenue by channel">
        <h2>Revenue by channel</h2>
        <ul>${bars}</ul>
      </section>
      <section class="card engagement" data-agent-native-node-id="engagement" data-agent-native-layer-name="User engagement">
        <h2>User engagement over time</h2>
        <span class="pill">+18% this quarter</span>
        <svg viewBox="0 0 520 300" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 240 C60 220 90 150 150 170 S250 250 310 150 S420 60 520 40 L520 300 L0 300 Z" fill="${C.sky}" opacity=".7"/>
          <path d="M0 240 C60 220 90 150 150 170 S250 250 310 150 S420 60 520 40" fill="none" stroke="${C.indigo}" stroke-width="4" stroke-linecap="round"/>
          <path d="M0 270 C80 250 120 230 190 235 S330 200 390 190 S470 170 520 150" fill="none" stroke="${C.teal}" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 8"/>
        </svg>
        <div class="axis"><span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span></div>
      </section>`,
  }),
};
