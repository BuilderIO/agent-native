// i18n-raw-literal-disable-file -- Static product artwork, not interactive UI.
import {
  IconActivity,
  IconBook2,
  IconChartBar,
  IconChevronDown,
  IconDatabase,
  IconHeartbeat,
  IconMessageCircle,
  IconPlayerPlay,
  IconSettings,
} from "@tabler/icons-react";

import { LogoMark } from "../website-redesign/ds/logo-mark";

const ANALYTICS_MOCK_CSS = [
  ".analytics-landing-mock { --an-bg:#1b1b1b; --an-sidebar:#191919; --an-panel:#232323; --an-line:#373737; --an-text:#ededed; --an-muted:#a0a0a0; width:100%; min-width:0; overflow:hidden; border:1px solid rgb(255 255 255 / 10%); border-radius:12px; background:var(--an-bg); box-shadow:0 22px 60px -34px rgb(0 0 0 / 64%); color:var(--an-text); font-family:Inter,'Inter Variable',ui-sans-serif,system-ui,sans-serif; }",
  ".analytics-landing-mock, .analytics-landing-mock * { box-sizing:border-box; }",
  ".analytics-landing-mock--dashboard { min-height:560px; } .analytics-landing-mock--growth,.analytics-landing-mock--report,.analytics-landing-mock--replay { min-height:430px; }",
  ".an-screen { display:grid; width:100%; height:100%; min-height:inherit; grid-template-columns:168px minmax(0,1fr) 242px; background:var(--an-bg); font-size:11px; }",
  ".an-sidebar { display:flex; min-width:0; flex-direction:column; border-right:1px solid #303030; background:var(--an-sidebar); padding:12px 9px; }",
  ".an-brand { display:flex; height:34px; align-items:center; gap:8px; padding:0 6px; color:#f2f2f2; font-size:12px; font-weight:600; }",
  ".an-brand-mark { display:grid; width:20px; height:13px; place-items:center; }",
  ".an-nav-section { margin:18px 7px 6px; color:#787878; font-size:8px; font-weight:650; letter-spacing:.09em; text-transform:uppercase; }",
  ".an-nav { display:flex; flex-direction:column; gap:3px; }",
  ".an-nav-row { display:flex; height:29px; min-width:0; align-items:center; gap:8px; overflow:hidden; border-radius:5px; padding:0 7px; color:#a8a8a8; white-space:nowrap; }",
  ".an-nav-row svg { width:14px; height:14px; flex:0 0 14px; }",
  ".an-nav-row.is-active { background:#2c2c2c; color:#f4f4f4; }",
  ".an-nav-row small { margin-left:auto; color:#858585; font-size:9px; }",
  ".an-nav-nested { margin:2px 0 5px 20px; border-left:1px solid #3b3b3b; padding-left:7px; }",
  ".an-nav-nested .an-nav-row { height:26px; padding-left:6px; font-size:10px; }",
  ".an-sidebar-spacer { flex:1; }",
  ".an-main { display:flex; min-width:0; min-height:0; flex-direction:column; overflow:hidden; }",
  ".an-topbar { display:flex; height:38px; flex:0 0 38px; align-items:center; justify-content:space-between; gap:8px; border-bottom:1px solid #303030; padding:0 14px; color:#989898; font-size:9px; }",
  ".an-crumb { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
  ".an-top-actions { display:flex; align-items:center; gap:6px; white-space:nowrap; }",
  ".an-top-button { border:1px solid #414141; border-radius:5px; background:#272727; padding:5px 8px; color:#dedede; font-size:9px; }",
  ".an-scroll { min-height:0; overflow:auto; padding:16px 16px 14px; scrollbar-width:none; }",
  ".an-scroll::-webkit-scrollbar { display:none; }",
  ".an-title-row { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin-bottom:13px; }",
  ".an-title-row h2 { margin:0; color:#f1f1f1; font-size:16px; font-weight:600; letter-spacing:-.025em; }",
  ".an-title-row p { margin:4px 0 0; color:#8f8f8f; font-size:9px; }",
  ".an-metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:7px; margin-bottom:8px; }",
  ".an-metric, .an-card { min-width:0; border:1px solid #363636; border-radius:7px; background:#222; }",
  ".an-metric { padding:9px 10px 8px; }",
  ".an-metric-label { overflow:hidden; color:#a0a0a0; font-size:8px; text-overflow:ellipsis; white-space:nowrap; }",
  ".an-metric-value { margin-top:7px; color:#f4f4f4; font-size:18px; font-weight:600; letter-spacing:-.04em; line-height:1; }",
  ".an-metric-change { margin-top:6px; color:#61cf98; font-size:8px; }",
  ".an-card { padding:10px; }",
  ".an-card-top { margin-top:8px; }",
  ".an-card-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }",
  ".an-card-title { margin:0; color:#e7e7e7; font-size:10px; font-weight:550; }",
  ".an-card-subtitle { margin-top:3px; color:#858585; font-size:8px; }",
  ".an-card-kebab { color:#818181; font-size:14px; letter-spacing:2px; }",
  ".an-chart-summary { margin-top:8px; color:#f0f0f0; font-size:16px; font-weight:600; letter-spacing:-.03em; }",
  ".an-chart-summary span { margin-left:6px; color:#65d29d; font-size:8px; font-weight:500; letter-spacing:0; }",
  ".an-chart-wrap { position:relative; height:118px; margin-top:5px; }",
  ".an-chart-svg { display:block; width:100%; height:100%; overflow:visible; }",
  ".an-chart-grid { fill:none; stroke:#3b3b3b; stroke-width:1; }",
  ".an-chart-line { fill:none; stroke:#49c8a1; stroke-width:2.6; stroke-linecap:round; stroke-linejoin:round; }",
  ".an-chart-line-alt { fill:none; stroke:#7a8df0; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }",
  ".an-chart-legend { display:flex; flex-wrap:wrap; gap:12px; margin-top:5px; color:#a7a7a7; font-size:8px; }",
  ".an-legend-dot { display:inline-block; width:6px; height:6px; margin-right:5px; border-radius:50%; background:#49c8a1; vertical-align:1px; }",
  ".an-legend-dot.is-violet { background:#7a8df0; }",
  ".an-lower-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px; }",
  ".an-funnel { display:grid; gap:7px; margin-top:10px; }",
  ".an-funnel-row { display:grid; grid-template-columns:68px minmax(0,1fr) 28px; align-items:center; gap:6px; color:#b5b5b5; font-size:8px; }",
  ".an-bar-track { height:6px; overflow:hidden; border-radius:999px; background:#373737; }",
  ".an-bar-fill { height:100%; border-radius:inherit; background:#49c8a1; }",
  ".an-funnel-row:nth-child(2) .an-bar-fill { background:#65a4e8; } .an-funnel-row:nth-child(3) .an-bar-fill { background:#9c86ed; }",
  ".an-channel-list { display:grid; gap:7px; margin-top:10px; }",
  ".an-channel-row { display:grid; grid-template-columns:58px minmax(0,1fr) 27px; align-items:center; gap:6px; color:#b5b5b5; font-size:8px; }",
  ".an-insight { display:flex; align-items:flex-start; gap:8px; margin-top:8px; border:1px solid #34443c; border-radius:6px; background:#202922; padding:8px; color:#bdcfbf; font-size:8px; line-height:1.45; }",
  ".an-insight-mark { display:grid; width:17px; height:17px; flex:0 0 17px; place-items:center; border-radius:50%; background:#314b3b; color:#7de0aa; font-size:10px; }",
  ".an-growth-layout { display:grid; grid-template-columns:1.3fr .7fr; gap:8px; }",
  ".an-cohort-table { display:grid; grid-template-columns:68px repeat(5,1fr); gap:3px; align-items:center; margin-top:10px; color:#999; font-size:7px; text-align:center; }",
  ".an-cohort-table span { min-height:19px; display:grid; place-items:center; border-radius:3px; background:#2f413c; color:#c7e8d9; }",
  ".an-cohort-table span:nth-child(5n+3), .an-cohort-table span:nth-child(5n+4) { background:#3f4230; color:#e6e4c0; }",
  ".an-cohort-table .an-cohort-label { justify-items:start; background:transparent; color:#aaa; text-align:left; }",
  ".an-report-bars { display:flex; height:122px; align-items:flex-end; gap:7px; margin-top:11px; padding:7px 3px 0; border-bottom:1px solid #414141; background:repeating-linear-gradient(to bottom,transparent 0,transparent 29px,#383838 30px); }",
  ".an-report-bar { position:relative; flex:1; min-width:0; border-radius:3px 3px 0 0; background:linear-gradient(180deg,#50c7a1,#328a7b); }",
  ".an-report-bar:nth-child(3n+2) { background:linear-gradient(180deg,#789cf5,#536dd0); }",
  ".an-report-months { display:flex; justify-content:space-between; margin-top:5px; color:#8d8d8d; font-size:7px; }",
  ".an-source-table { width:100%; margin-top:10px; border-collapse:collapse; color:#b8b8b8; font-size:8px; }",
  ".an-source-table th { padding:5px 4px; color:#838383; font-size:7px; font-weight:500; text-align:left; }",
  ".an-source-table td { border-top:1px solid #363636; padding:7px 4px; }",
  ".an-source-table td:last-child, .an-source-table th:last-child { text-align:right; }",
  ".an-replay { display:grid; grid-template-columns:minmax(0,1.45fr) minmax(105px,.55fr); gap:8px; }",
  ".an-status-error { color:#e7797e; } .an-status-warning { color:#e7b579; }",
  ".an-player { position:relative; min-height:190px; overflow:hidden; border:1px solid #353535; border-radius:7px; background:#101216; }",
  ".an-browser-bar { display:flex; height:22px; align-items:center; gap:4px; border-bottom:1px solid #2d2f33; background:#202226; padding:0 7px; }",
  ".an-browser-dot { width:5px; height:5px; border-radius:50%; background:#6e7076; }",
  ".an-browser-url { flex:1; margin-left:6px; border-radius:3px; background:#17181b; padding:3px 6px; color:#8f9299; font-size:6px; }",
  ".an-store-page { margin:11px auto; width:78%; border:1px solid #2b2e35; border-radius:4px; background:#f3f3f1; color:#26272a; padding:8px; }",
  ".an-store-nav { display:flex; justify-content:space-between; border-bottom:1px solid #dededb; padding-bottom:5px; font-size:7px; font-weight:650; }",
  ".an-store-layout { display:grid; grid-template-columns:.8fr 1fr; gap:8px; padding-top:8px; }",
  ".an-product-photo { min-height:70px; border-radius:3px; background:linear-gradient(145deg,#d7e4e5,#9eafb0 48%,#ebd6c0); }",
  ".an-product-copy { padding-top:2px; font-size:7px; } .an-product-copy strong { display:block; margin:4px 0; font-size:9px; }",
  ".an-price { margin:7px 0; color:#43766d; font-size:9px; font-weight:650; } .an-buy { display:inline-block; border-radius:3px; background:#243b36; padding:5px 8px; color:#fff; font-size:6px; }",
  ".an-player-controls { position:absolute; right:7px; bottom:7px; left:7px; display:flex; align-items:center; gap:7px; border:1px solid #393b40; border-radius:5px; background:rgb(22 23 26 / 92%); padding:6px; color:#ddd; font-size:7px; }",
  ".an-play { display:grid; width:17px; height:17px; place-items:center; border-radius:50%; background:#eee; color:#191919; font-size:8px; }",
  ".an-timeline { height:3px; flex:1; border-radius:999px; background:linear-gradient(90deg,#4cc6a0 0 42%,#42454b 42%); }",
  ".an-event-list { display:grid; gap:6px; margin-top:8px; }",
  ".an-event-item { border-left:2px solid #ed9d60; padding-left:6px; color:#bcbcbc; font-size:7px; line-height:1.4; } .an-event-item.is-error { border-color:#ee6d75; }",
  ".an-agent { display:flex; min-width:0; flex-direction:column; border-left:1px solid #303030; background:#202020; }",
  ".an-agent-head { display:flex; height:38px; flex:0 0 38px; align-items:center; justify-content:space-between; border-bottom:1px solid #303030; padding:0 12px; color:#e8e8e8; font-size:10px; font-weight:550; }",
  ".an-agent-status { width:6px; height:6px; border-radius:50%; background:#68d39a; box-shadow:0 0 0 3px rgb(104 211 154 / 12%); }",
  ".an-thread { display:flex; min-height:0; flex:1; flex-direction:column; gap:11px; overflow:auto; padding:13px 10px; scrollbar-width:none; }",
  ".an-thread::-webkit-scrollbar { display:none; }",
  ".an-thread-label { color:#8d8d8d; font-size:8px; }",
  ".an-user-message { align-self:flex-end; max-width:94%; border:1px solid #3d3d3d; border-radius:8px 8px 2px 8px; background:#2b2b2b; padding:8px; color:#e5e5e5; font-size:9px; line-height:1.45; }",
  ".an-agent-reply { color:#d0d0d0; font-size:9px; line-height:1.55; }",
  ".an-agent-reply strong { color:#f2f2f2; font-weight:600; }",
  ".an-agent-evidence { display:flex; flex-wrap:wrap; gap:4px; margin-top:7px; }",
  ".an-evidence-pill { border:1px solid #3b3b3b; border-radius:999px; padding:4px 6px; color:#acacac; font-size:7px; }",
  ".an-agent-result { border:1px solid #3b3b3b; border-radius:6px; background:#252525; padding:8px; }",
  ".an-agent-result-title { margin-bottom:6px; color:#aaa; font-size:7px; }",
  ".an-agent-result strong { display:block; color:#eee; font-size:10px; font-weight:550; }",
  ".an-result-note { margin-top:4px; color:#999; font-size:7px; line-height:1.4; }",
  ".an-agent-composer { display:flex; flex:0 0 auto; align-items:center; gap:6px; margin:0 9px 10px; border:1px solid #3b3b3b; border-radius:7px; background:#262626; padding:8px; color:#878787; font-size:8px; }",
  ".an-agent-composer span:last-child { margin-left:auto; display:grid; width:17px; height:17px; place-items:center; border-radius:50%; background:#e1e1e1; color:#262626; font-size:10px; }",
  ".an-agent-mobile { display:none; }",
  "@media (max-width:900px) { .an-screen { grid-template-columns:54px minmax(0,1fr) 215px; } .an-sidebar { align-items:center; padding-inline:6px; } .an-brand { justify-content:center; padding:0; } .an-brand-name,.an-nav-section,.an-nav-row span,.an-nav-row small,.an-nav-nested { display:none; } .an-nav { width:100%; align-items:center; margin-top:14px; } .an-nav-row { width:34px; justify-content:center; padding:0; } .an-sidebar-spacer { min-height:12px; } .an-nav-row svg { width:15px; height:15px; } }",
  "@media (max-width:660px) { .analytics-landing-mock { border-radius:9px; } .analytics-landing-mock--dashboard { min-height:520px; } .analytics-landing-mock--growth,.analytics-landing-mock--report,.analytics-landing-mock--replay { min-height:430px; } .an-screen { grid-template-columns:40px minmax(0,1fr); } .an-sidebar { padding:9px 3px; } .an-nav-row { width:30px; height:27px; } .an-agent { display:none; } .an-topbar { height:34px; flex-basis:34px; padding-inline:8px; } .an-scroll { padding:11px 9px; } .an-title-row { margin-bottom:8px; } .an-title-row h2 { font-size:13px; } .an-title-row p { font-size:8px; } .an-top-actions { gap:4px; } .an-top-button { padding:4px 5px; font-size:8px; } .an-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); gap:5px; margin-bottom:5px; } .an-metric { padding:7px; } .an-metric-value { font-size:15px; } .an-chart-wrap { height:93px; } .an-lower-grid { gap:5px; margin-top:5px; } .an-card { padding:7px; } .an-card-title { font-size:9px; } .an-agent-mobile { display:flex; align-items:flex-start; gap:7px; margin-top:6px; border:1px solid #383838; border-radius:6px; background:#232323; padding:7px; color:#cfcfcf; font-size:8px; line-height:1.4; } .an-agent-mobile strong { color:#eee; font-weight:550; } .an-growth-layout { grid-template-columns:1fr; } .an-replay { grid-template-columns:minmax(0,1fr); } .an-replay .an-card:last-child { display:none; } }",
  ".analytics-landing-mock--sidebar-hidden .an-sidebar,.analytics-landing-mock--agent-hidden .an-agent,.analytics-landing-mock--agent-hidden .an-agent-mobile { display:none; }",
  ".analytics-landing-mock--sidebar-hidden .an-screen { grid-template-columns:minmax(0,1fr) 242px; }",
  ".analytics-landing-mock--agent-hidden:not(.analytics-landing-mock--sidebar-hidden) .an-screen { grid-template-columns:168px minmax(0,1fr); }",
  ".analytics-landing-mock--sidebar-hidden.analytics-landing-mock--agent-hidden .an-screen { grid-template-columns:minmax(0,1fr); }",
  "@media (max-width:660px) { .analytics-landing-mock--sidebar-hidden .an-screen { grid-template-columns:minmax(0,1fr); } .analytics-landing-mock--sidebar-hidden .an-agent { display:none; } }",
].join("\n");

type AnalyticsLandingMode = "dashboard" | "growth" | "report" | "replay";

const MODE_COPY = {
  dashboard: {
    question: "Why did activation climb this week?",
    answer: (
      <>
        Team invites explain most of the lift.{" "}
        <strong>Invite acceptance rose 22%</strong> after the onboarding change,
        with the strongest gain from organic signups.
      </>
    ),
    result: "+18% activated users",
    note: "Compared 4 cohorts using the saved activation definition.",
  },
  growth: {
    question: "Where are new signups dropping off?",
    answer: (
      <>
        Mobile visitors convert less often after creating an account. The drop
        is concentrated on the <strong>workspace setup</strong> step.
      </>
    ),
    result: "−8.4 pts on mobile",
    note: "I used the signup funnel definition in your data dictionary.",
  },
  report: {
    question: "What changed in recurring revenue?",
    answer: (
      <>
        Expansion revenue outpaced new subscriptions this month. The difference
        comes mostly from <strong>annual plan upgrades</strong>.
      </>
    ),
    result: "$184.2k MRR",
    note: "Query, source tables, and date range are attached to this result.",
  },
  replay: {
    question: "Why did this customer fail checkout?",
    answer: (
      <>
        The coupon applied, then the payment request returned a 422. The replay
        and console event line up at <strong>02:14</strong>.
      </>
    ),
    result: "Checkout error · 02:14",
    note: "Temporary replay context is ready to share with the agent.",
  },
} as const;

function AnalyticsSidebar({ mode }: { mode: AnalyticsLandingMode }) {
  const current = mode === "replay" ? "Sessions" : "Dashboards";
  return (
    <aside className="an-sidebar">
      <div className="an-brand">
        <span className="an-brand-mark">
          <LogoMark className="h-full w-full" />
        </span>
        <span className="an-brand-name">Analytics</span>
      </div>
      <nav className="an-nav" aria-label="Analytics navigation">
        <div className="an-nav-section">Workspace</div>
        <div className="an-nav-row">
          <IconMessageCircle />
          <span>Ask</span>
        </div>
        <div
          className={`an-nav-row ${current === "Dashboards" ? "is-active" : ""}`}
        >
          <IconChartBar />
          <span>Dashboards</span>
          <IconChevronDown />
        </div>
        <div className="an-nav-nested">
          <div className={`an-nav-row ${mode !== "replay" ? "is-active" : ""}`}>
            <span>
              {mode === "report"
                ? "Revenue report"
                : mode === "growth"
                  ? "Activation"
                  : "Product overview"}
            </span>
          </div>
          <div className="an-nav-row">
            <span>Acquisition</span>
          </div>
        </div>
        <div
          className={`an-nav-row ${current === "Sessions" ? "is-active" : ""}`}
        >
          <IconPlayerPlay />
          <span>Sessions</span>
        </div>
        <div className="an-nav-row">
          <IconHeartbeat />
          <span>Monitoring</span>
        </div>
        <div className="an-nav-row">
          <IconActivity />
          <span>Agents</span>
        </div>
        <div className="an-nav-section">Data</div>
        <div className="an-nav-row">
          <IconDatabase />
          <span>Data sources</span>
        </div>
        <div className="an-nav-row">
          <IconBook2 />
          <span>Data dictionary</span>
        </div>
      </nav>
      <div className="an-sidebar-spacer" />
      <div className="an-nav-row">
        <IconSettings />
        <span>Settings</span>
      </div>
    </aside>
  );
}

function AnalyticsAgent({ mode }: { mode: AnalyticsLandingMode }) {
  const copy = MODE_COPY[mode];
  return (
    <aside className="an-agent" aria-label="Analytics agent">
      <div className="an-agent-head">
        <span>Agent</span>
        <span className="an-agent-status" />
      </div>
      <div className="an-thread">
        <div className="an-thread-label">Product overview · Today</div>
        <div className="an-user-message">{copy.question}</div>
        <div className="an-agent-reply">
          {copy.answer}
          <div className="an-agent-evidence">
            <span className="an-evidence-pill">SQL inspected</span>
            <span className="an-evidence-pill">Metric definition</span>
          </div>
        </div>
        <div className="an-agent-result">
          <div className="an-agent-result-title">Analysis result</div>
          <strong>{copy.result}</strong>
          <div className="an-result-note">{copy.note}</div>
        </div>
      </div>
      <div className="an-agent-composer">
        <span>Ask about this data…</span>
        <span>↑</span>
      </div>
    </aside>
  );
}

function ProductDashboard() {
  return (
    <>
      <div className="an-title-row">
        <div>
          <h2>Product overview</h2>
          <p>Growth signals across your product</p>
        </div>
        <button className="an-top-button">Share</button>
      </div>
      <div className="an-metrics">
        <Metric label="Weekly active users" value="48.2k" change="↑ 12.8%" />
        <Metric label="New signups" value="6,412" change="↑ 8.4%" />
        <Metric label="Activation rate" value="38.4%" change="↑ 4.2%" />
        <Metric label="Avg. session" value="4m 26s" change="↑ 0.7%" />
      </div>
      <div className="an-card">
        <div className="an-card-head">
          <div>
            <h3 className="an-card-title">Weekly active users</h3>
            <div className="an-card-subtitle">Unique users · daily</div>
          </div>
          <span className="an-card-kebab">···</span>
        </div>
        <div className="an-chart-summary">
          48,206 <span>+12.8% vs. prior period</span>
        </div>
        <TrendChart id="overview" />
        <div className="an-chart-legend">
          <span>
            <i className="an-legend-dot" />
            This period
          </span>
          <span>
            <i className="an-legend-dot is-violet" />
            Previous period
          </span>
          <span>Feb 1 — Feb 28</span>
        </div>
      </div>
      <div className="an-lower-grid">
        <div className="an-card">
          <div className="an-card-head">
            <h3 className="an-card-title">Activation funnel</h3>
            <span className="an-card-subtitle">Last 30 days</span>
          </div>
          <div className="an-funnel">
            <FunnelRow label="Signed up" value="6,412" width="100%" />
            <FunnelRow label="Activated" value="2,461" width="58%" />
            <FunnelRow label="Retained" value="1,860" width="43%" />
          </div>
          <div className="an-insight">
            <span className="an-insight-mark">↗</span>
            <span>
              Team invites are the strongest activation signal this week.
            </span>
          </div>
        </div>
        <div className="an-card">
          <div className="an-card-head">
            <h3 className="an-card-title">Top acquisition channels</h3>
            <span className="an-card-subtitle">New signups</span>
          </div>
          <div className="an-channel-list">
            <ChannelRow label="Organic" value="42%" width="82%" />
            <ChannelRow label="Direct" value="28%" width="57%" />
            <ChannelRow label="Referral" value="18%" width="37%" />
            <ChannelRow label="Paid search" value="12%" width="25%" />
          </div>
        </div>
      </div>
    </>
  );
}

function GrowthDashboard() {
  return (
    <>
      <div className="an-title-row">
        <div>
          <h2>Activation by cohort</h2>
          <p>Find the step where new users lose momentum</p>
        </div>
        <button className="an-top-button">Last 30 days⌄</button>
      </div>
      <div className="an-metrics">
        <Metric label="New accounts" value="6,412" change="↑ 8.4%" />
        <Metric label="Setup complete" value="3,087" change="↓ 2.1%" />
        <Metric label="Activated" value="2,461" change="↑ 4.2%" />
        <Metric label="Day 7 retained" value="1,860" change="↑ 1.6%" />
      </div>
      <div className="an-growth-layout">
        <div className="an-card">
          <div className="an-card-head">
            <h3 className="an-card-title">Activation by signup week</h3>
            <span className="an-card-subtitle">% activated</span>
          </div>
          <TrendChart id="cohort" />
          <div className="an-insight">
            <span className="an-insight-mark">↗</span>
            <span>Invite-based signups activate 1.7× more often.</span>
          </div>
        </div>
        <div className="an-card">
          <div className="an-card-head">
            <h3 className="an-card-title">Setup completion</h3>
            <span className="an-card-subtitle">By device</span>
          </div>
          <div className="an-funnel">
            <FunnelRow label="Desktop" value="54%" width="85%" />
            <FunnelRow label="Tablet" value="42%" width="66%" />
            <FunnelRow label="Mobile" value="31%" width="48%" />
          </div>
        </div>
      </div>
      <div className="an-card an-card-top">
        <div className="an-card-head">
          <h3 className="an-card-title">Activation cohort</h3>
          <span className="an-card-subtitle">
            Retention by week from signup
          </span>
        </div>
        <div className="an-cohort-table">
          <span />
          <span>W0</span>
          <span>W1</span>
          <span>W2</span>
          <span>W3</span>
          <span>W4</span>
          <span className="an-cohort-label">Feb 3</span>
          <span>41%</span>
          <span>34%</span>
          <span>29%</span>
          <span>26%</span>
          <span>24%</span>
          <span className="an-cohort-label">Feb 10</span>
          <span>43%</span>
          <span>36%</span>
          <span>31%</span>
          <span>28%</span>
          <span>—</span>
          <span className="an-cohort-label">Feb 17</span>
          <span>46%</span>
          <span>38%</span>
          <span>33%</span>
          <span>—</span>
          <span>—</span>
        </div>
      </div>
    </>
  );
}

function RevenueDashboard() {
  const barHeights = [42, 48, 51, 58, 55, 68, 65, 74, 72, 81, 84, 96];
  return (
    <>
      <div className="an-title-row">
        <div>
          <h2>Revenue performance</h2>
          <p>Recurring revenue and customer movement</p>
        </div>
        <button className="an-top-button">Q1 2025⌄</button>
      </div>
      <div className="an-metrics">
        <Metric
          label="Monthly recurring revenue"
          value="$184.2k"
          change="↑ 9.6%"
        />
        <Metric label="Paying customers" value="2,840" change="↑ 6.1%" />
        <Metric label="Expansion revenue" value="$21.4k" change="↑ 18.2%" />
        <Metric label="Net revenue retention" value="112%" change="↑ 2.8 pts" />
      </div>
      <div className="an-card">
        <div className="an-card-head">
          <div>
            <h3 className="an-card-title">Monthly recurring revenue</h3>
            <div className="an-card-subtitle">
              USD · recognized subscriptions
            </div>
          </div>
          <span className="an-card-kebab">···</span>
        </div>
        <div className="an-report-bars">
          {barHeights.map((height, index) => (
            <div
              key={index}
              className="an-report-bar"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
        <div className="an-report-months">
          <span>Apr</span>
          <span>May</span>
          <span>Jun</span>
          <span>Jul</span>
          <span>Aug</span>
          <span>Sep</span>
          <span>Oct</span>
          <span>Nov</span>
          <span>Dec</span>
          <span>Jan</span>
          <span>Feb</span>
          <span>Mar</span>
        </div>
      </div>
      <div className="an-card an-card-top">
        <div className="an-card-head">
          <h3 className="an-card-title">Revenue by plan</h3>
          <span className="an-card-subtitle">Current quarter</span>
        </div>
        <table className="an-source-table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Customers</th>
              <th>MRR</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Enterprise</td>
              <td>86</td>
              <td>$82,400</td>
              <td>+14%</td>
            </tr>
            <tr>
              <td>Business</td>
              <td>624</td>
              <td>$61,200</td>
              <td>+8%</td>
            </tr>
            <tr>
              <td>Starter</td>
              <td>2,130</td>
              <td>$40,600</td>
              <td>+6%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function SessionReplay() {
  return (
    <>
      <div className="an-title-row">
        <div>
          <h2>Checkout session</h2>
          <p>Tuesday, Mar 18 · 2m 46s · Chrome on macOS</p>
        </div>
        <button className="an-top-button">Copy agent link</button>
      </div>
      <div className="an-replay">
        <div className="an-player">
          <div className="an-browser-bar">
            <i className="an-browser-dot" />
            <i className="an-browser-dot" />
            <i className="an-browser-dot" />
            <div className="an-browser-url">northstar.shop / checkout</div>
          </div>
          <div className="an-store-page">
            <div className="an-store-nav">
              <span>NORTHSTAR</span>
              <span>New arrivals　About</span>
            </div>
            <div className="an-store-layout">
              <div className="an-product-photo" />
              <div className="an-product-copy">
                <span>EVERYDAY COLLECTION</span>
                <strong>Field jacket</strong>
                <div>Sand · Size M</div>
                <div className="an-price">$148.00</div>
                <span className="an-buy">Complete purchase</span>
              </div>
            </div>
          </div>
          <div className="an-player-controls">
            <span className="an-play">▶</span>
            <span>02:14</span>
            <div className="an-timeline" />
            <span>02:46</span>
            <span>1×</span>
          </div>
        </div>
        <div className="an-card">
          <div className="an-card-head">
            <h3 className="an-card-title">Timeline</h3>
            <span className="an-card-subtitle">12 events</span>
          </div>
          <div className="an-event-list">
            <div className="an-event-item">01:52 · Added coupon code</div>
            <div className="an-event-item">02:03 · Applied discount</div>
            <div className="an-event-item is-error">
              02:14 · Checkout returned 422
            </div>
            <div className="an-event-item">02:18 · Retried payment</div>
            <div className="an-event-item">02:46 · Session ended</div>
          </div>
          <div className="an-insight">
            <span className="an-insight-mark">!</span>
            <span>Payment failed after coupon validation.</span>
          </div>
        </div>
      </div>
      <div className="an-card an-card-top">
        <div className="an-card-head">
          <h3 className="an-card-title">Console & network</h3>
          <span className="an-card-subtitle">Filtered to errors</span>
        </div>
        <table className="an-source-table">
          <tbody>
            <tr>
              <td className="an-status-error">422</td>
              <td>POST /api/checkout</td>
              <td>02:14.2</td>
            </tr>
            <tr>
              <td className="an-status-warning">WARN</td>
              <td>Coupon validation completed</td>
              <td>02:13.9</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: string;
}) {
  return (
    <div className="an-metric">
      <div className="an-metric-label">{label}</div>
      <div className="an-metric-value">{value}</div>
      <div className="an-metric-change">{change} vs. prior period</div>
    </div>
  );
}

function FunnelRow({
  label,
  value,
  width,
}: {
  label: string;
  value: string;
  width: string;
}) {
  return (
    <div className="an-funnel-row">
      <span>{label}</span>
      <div className="an-bar-track">
        <div className="an-bar-fill" style={{ width }} />
      </div>
      <span>{value}</span>
    </div>
  );
}

function ChannelRow({
  label,
  value,
  width,
}: {
  label: string;
  value: string;
  width: string;
}) {
  return (
    <div className="an-channel-row">
      <span>{label}</span>
      <div className="an-bar-track">
        <div className="an-bar-fill" style={{ width }} />
      </div>
      <span>{value}</span>
    </div>
  );
}

function TrendChart({ id }: { id: string }) {
  const gradientId = `an-area-${id}`;
  return (
    <div className="an-chart-wrap">
      <svg
        className="an-chart-svg"
        viewBox="0 0 620 150"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#49c8a1" stopOpacity=".25" />
            <stop offset="1" stopColor="#49c8a1" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          className="an-chart-grid"
          d="M0 18H620 M0 50H620 M0 82H620 M0 114H620 M0 146H620"
        />
        <path
          d="M0 113 C30 108 38 99 62 103 S94 91 116 96 S151 74 179 82 S211 74 238 79 S264 62 292 72 S320 56 349 65 S378 52 409 59 S441 42 469 51 S504 34 528 43 S571 28 620 30 L620 150 L0 150Z"
          fill={`url(#${gradientId})`}
        />
        <path
          className="an-chart-line"
          d="M0 113 C30 108 38 99 62 103 S94 91 116 96 S151 74 179 82 S211 74 238 79 S264 62 292 72 S320 56 349 65 S378 52 409 59 S441 42 469 51 S504 34 528 43 S571 28 620 30"
        />
        <path
          className="an-chart-line-alt"
          d="M0 126 C37 119 41 121 62 116 S98 115 117 109 S149 100 178 103 S213 91 238 99 S267 88 292 95 S324 79 350 90 S381 76 410 81 S443 71 468 77 S500 64 528 71 S572 59 620 62"
        />
      </svg>
    </div>
  );
}

export function AnalyticsLandingMockStyles() {
  return <style>{ANALYTICS_MOCK_CSS}</style>;
}

export function AnalyticsLandingMock({
  mode,
  label,
  className = "",
  showSidebar = true,
  showAgent = true,
}: {
  mode: AnalyticsLandingMode;
  label: string;
  className?: string;
  showSidebar?: boolean;
  showAgent?: boolean;
}) {
  const chromeClass = [
    !showSidebar && "analytics-landing-mock--sidebar-hidden",
    !showAgent && "analytics-landing-mock--agent-hidden",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={`analytics-landing-mock analytics-landing-mock--${mode} ${chromeClass} ${className}`}
      role="img"
      aria-label={label}
    >
      <div className="an-screen" aria-hidden="true">
        {showSidebar && <AnalyticsSidebar mode={mode} />}
        <main className="an-main">
          <div className="an-topbar">
            <span className="an-crumb">
              Dashboards　/　
              {mode === "growth"
                ? "Activation"
                : mode === "report"
                  ? "Revenue performance"
                  : mode === "replay"
                    ? "Sessions"
                    : "Product overview"}
            </span>
            <div className="an-top-actions">
              <span>Last 30 days⌄</span>
              <button className="an-top-button">•••</button>
            </div>
          </div>
          <div className="an-scroll">
            {mode === "dashboard" && <ProductDashboard />}
            {mode === "growth" && <GrowthDashboard />}
            {mode === "report" && <RevenueDashboard />}
            {mode === "replay" && <SessionReplay />}
            {showAgent && (
              <div className="an-agent-mobile">
                <strong>Agent insight</strong>
                <span>{MODE_COPY[mode].answer}</span>
              </div>
            )}
          </div>
        </main>
        {showAgent && <AnalyticsAgent mode={mode} />}
      </div>
    </div>
  );
}
