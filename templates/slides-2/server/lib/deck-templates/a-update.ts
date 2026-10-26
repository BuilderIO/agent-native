import { authoredDeck, slideRoot } from "./a-shared.js";

// guard:allow-raw-color — authored slide palette, not app chrome.
const [bg, ink, muted, accent, surface, line] = [
  "#FAFAF9", // guard:allow-raw-color
  "#17171C", // guard:allow-raw-color
  "#686874", // guard:allow-raw-color
  "#4655D4", // guard:allow-raw-color
  "#F1F1F3", // guard:allow-raw-color
  "#E2E2E7", // guard:allow-raw-color
];
// guard:allow-raw-color — authored status colors, not app chrome.
const [ok, warn, risk] = ["#16774A", "#94600F", "#B53333"];

const tokens = `--deck-bg:${bg};--deck-ink:${ink};--deck-muted:${muted};--deck-accent:${accent};--deck-surface:${surface};--deck-heading-font:'Geist',sans-serif;--deck-body-font:'Geist',sans-serif;--deck-radius:10px;--up-line:${line};--up-ok:${ok};--up-warn:${warn};--up-risk:${risk};`;

const mono = "font-family:'Geist Mono',monospace;";
const h1 =
  "font-family:'Geist',sans-serif;font-weight:600;letter-spacing:-0.035em;margin:0;";

const slide = (page: number, body: string) =>
  slideRoot(
    tokens,
    "font-family:'Geist',sans-serif;padding:30px 44px 28px;display:flex;flex-direction:column;",
    `<div style="display:flex;align-items:center;justify-content:space-between;font-size:14px;padding-bottom:14px;border-bottom:1px solid var(--up-line);"><span style="display:flex;align-items:center;gap:10px;"><span style="width:14px;height:14px;border-radius:4px;background:var(--deck-accent);"></span><span style="font-weight:600;">Platform team</span><span style="color:var(--deck-muted);">Weekly readout</span></span><span style="${mono}color:var(--deck-muted);">WK 00 · 20XX-00-00 · ${page}/5</span></div>${body}`,
  );

const chip = (tone: "ok" | "warn" | "risk" | "idle", label: string) => {
  const color = tone === "idle" ? "var(--deck-muted)" : `var(--up-${tone})`;
  return `<span style="display:inline-flex;align-self:flex-start;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:999px;font-size:14px;font-weight:500;white-space:nowrap;background:color-mix(in srgb,${color} 11%,transparent);color:${color};"><span style="width:6px;height:6px;border-radius:50%;background:currentColor;"></span>${label}</span>`;
};

const avatar = (initials: string) =>
  `<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--deck-surface);border:1px solid var(--up-line);font-size:14px;font-weight:600;letter-spacing:-0.02em;margin-right:8px;">${initials}</span>`;

const row = (
  id: string,
  change: string,
  owner: string,
  status: string,
  note: string,
) =>
  `<tr style="border-top:1px solid var(--up-line);"><td style="${mono}padding:15px 12px 11px 0;color:var(--deck-muted);">${id}</td><td style="padding:15px 12px;font-weight:500;">${change}</td><td style="padding:15px 12px;white-space:nowrap;">${avatar(owner)}</td><td style="padding:15px 12px;">${status}</td><td style="padding:15px 0 11px 12px;color:var(--deck-muted);">${note}</td></tr>`;

const bar = (label: string, pct: number, tone: string, value: string) =>
  `<div style="display:grid;grid-template-columns:132px 1fr 44px;align-items:center;gap:12px;font-size:15px;"><span>${label}</span><span style="height:8px;border-radius:4px;background:var(--deck-surface);"><span style="display:block;height:8px;width:${pct}%;border-radius:4px;background:${tone};"></span></span><span style="${mono}text-align:right;color:var(--deck-muted);">${value}</span></div>`;

const weeks = [18, 26, 31, 40, 46, 52, 61, 67, 0, 0, 0, 0]
  .map((h, i) =>
    h
      ? `<span style="flex:1;height:${h + 22}%;border-radius:3px 3px 0 0;background:var(--deck-accent);opacity:${i === 7 ? 1 : 0.55};"></span>`
      : `<span style="flex:1;height:${90 + 3 * (i - 8)}%;border-radius:3px 3px 0 0;border:1px dashed var(--up-line);border-bottom:none;"></span>`,
  )
  .join("");

const gantt = (
  label: string,
  start: number,
  span: number,
  tone: string,
  text: string,
) =>
  `<div style="display:grid;grid-template-columns:150px repeat(6,1fr);align-items:center;height:54px;border-top:1px solid var(--up-line);font-size:15px;"><span style="font-weight:500;">${label}</span><span style="grid-column:${start + 1}/span ${span};height:28px;margin:0 3px;border-radius:6px;background:${tone};display:flex;align-items:center;padding:0 10px;font-size:14px;white-space:nowrap;">${text}</span></div>`;

export const UPDATE_DECK = authoredDeck(
  "starter-product-readout",
  "Product team readout",
  "update",
  "A quiet, precise weekly readout: status at a glance, a shipped table, a progress chart, open decisions, and the next six weeks.",
  [
    {
      layout: "title",
      content: slide(
        1,
        `<h1 style="${h1}margin-top:72px;font-size:58px;line-height:1.02;">Platform readout,<br>week 00</h1>
<p style="margin:16px 0 0;font-size:20px;line-height:1.45;color:var(--deck-muted);max-width:560px;">What shipped, what moved, and the two decisions we need from this room.</p>
<div style="margin-top:auto;display:grid;grid-template-columns:repeat(3,1fr) 1.5fr;border:1px solid var(--up-line);border-radius:var(--deck-radius);background:var(--deck-bg);">
<div style="padding:16px 18px;">${chip("ok", "Shipped")}<span style="display:block;margin-top:12px;font-size:36px;font-weight:600;letter-spacing:-0.03em;font-variant-numeric:tabular-nums;">00</span><span style="font-size:14px;color:var(--deck-muted);">items this cycle</span></div>
<div style="padding:16px 18px;border-left:1px solid var(--up-line);">${chip("warn", "In progress")}<span style="display:block;margin-top:12px;font-size:36px;font-weight:600;letter-spacing:-0.03em;">00</span><span style="font-size:14px;color:var(--deck-muted);">carried forward</span></div>
<div style="padding:16px 18px;border-left:1px solid var(--up-line);">${chip("risk", "At risk")}<span style="display:block;margin-top:12px;font-size:36px;font-weight:600;letter-spacing:-0.03em;">0</span><span style="font-size:14px;color:var(--deck-muted);">need a decision</span></div>
<div style="padding:16px 18px;border-left:1px solid var(--up-line);display:flex;flex-direction:column;"><span style="font-size:14px;font-weight:500;">Quarter goal</span><span style="display:flex;align-items:baseline;gap:8px;margin-top:14px;"><span style="font-size:36px;font-weight:600;letter-spacing:-0.03em;">00%</span><span style="font-size:14px;color:var(--deck-muted);">of Q0 scope complete</span></span><span style="margin-top:auto;height:8px;border-radius:4px;background:var(--deck-surface);"><span style="display:block;width:62%;height:8px;border-radius:4px;background:var(--deck-accent);"></span></span></div>
</div>`,
      ),
      notes:
        "Give the headline in one sentence: what shipped and what you need. The counts are placeholders; fill them from your tracker before the meeting and keep the at-risk number honest.",
    },
    {
      layout: "content",
      content: slide(
        2,
        `<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:40px;margin-top:28px;">
<h1 style="${h1}font-size:36px;line-height:1.05;">Shipped this cycle</h1>
<p style="margin:0;font-size:16px;line-height:1.45;color:var(--deck-muted);max-width:360px;">Five changes reached production. Two need a small follow-up next week.</p>
</div>
<table style="margin-top:22px;width:100%;border-collapse:collapse;font-size:15px;line-height:1.3;">
<thead><tr style="text-align:left;font-size:14px;color:var(--deck-muted);"><th style="font-weight:500;padding:0 12px 10px 0;width:92px;">ID</th><th style="font-weight:500;padding:0 12px 10px;">Change</th><th style="font-weight:500;padding:0 12px 10px;width:60px;">Owner</th><th style="font-weight:500;padding:0 12px 10px;width:140px;">Status</th><th style="font-weight:500;padding:0 0 10px 12px;width:210px;">Note</th></tr></thead>
<tbody>
${row("PLT-000", "Faster search indexing", "AB", chip("ok", "Shipped"), "Sample: p95 down 00%")}
${row("PLT-000", "Single sign-on for workspaces", "CD", chip("ok", "Shipped"), "Rolled out to all plans")}
${row("PLT-000", "Audit log export", "EF", chip("ok", "Shipped"), "Docs update pending")}
${row("PLT-000", "Usage-based billing meter", "GH", chip("warn", "In progress"), "Behind by one week")}
${row("PLT-000", "Regional data residency", "IJ", chip("risk", "At risk"), "Blocked on vendor review")}
</tbody></table>`,
      ),
      notes:
        "Read the table top to bottom and spend your time on the last two rows. Replace IDs, owners, and notes with your tracker's data; keep the sample note format short enough to fit one line.",
    },
    {
      layout: "content",
      content: slide(
        3,
        `<div style="display:grid;grid-template-columns:300px 1fr;gap:40px;flex:1;margin-top:28px;">
<div style="display:flex;flex-direction:column;">
<h1 style="${h1}font-size:36px;line-height:1.05;">Progress toward the Q0 goal</h1>
<p style="margin:14px 0 0;font-size:16px;line-height:1.5;color:var(--deck-muted);">Scope burned steadily through week eight. The remaining work is concentrated in billing and residency.</p>
<div style="margin-top:auto;padding-top:18px;border-top:1px solid var(--up-line);"><span style="display:block;font-size:40px;font-weight:600;letter-spacing:-0.03em;">00 pts</span><span style="font-size:15px;color:var(--deck-muted);">remaining across three workstreams</span></div>
<div style="margin-top:24px;display:flex;flex-direction:column;gap:8px;font-size:14px;color:var(--deck-muted);"><span style="display:flex;align-items:center;gap:8px;"><span style="width:10px;height:10px;border-radius:2px;background:var(--deck-accent);"></span>Completed scope, cumulative</span><span style="display:flex;align-items:center;gap:8px;"><span style="width:10px;height:10px;border-radius:2px;border:1px dashed var(--deck-muted);"></span>Planned, not yet started</span></div>
</div>
<div style="border:1px solid var(--up-line);border-radius:var(--deck-radius);padding:18px 20px;display:flex;flex-direction:column;">
<div style="display:flex;justify-content:space-between;font-size:14px;"><span style="font-weight:500;">Cumulative scope by week</span><span style="${mono}color:var(--deck-muted);">W1 to W12</span></div>
<div style="position:relative;display:flex;align-items:flex-end;gap:8px;height:150px;margin-top:14px;padding-bottom:1px;border-bottom:1px solid var(--up-line);">${weeks}<span style="position:absolute;left:66.6%;top:-6px;bottom:0;border-left:1px dashed var(--deck-ink);"></span><span style="${mono}position:absolute;left:67.6%;top:-8px;font-size:14px;">today</span></div>
<div style="display:flex;flex-direction:column;gap:12px;margin-top:20px;">
${bar("Search", 100, "var(--up-ok)", "100%")}
${bar("Identity", 86, "var(--deck-accent)", "00%")}
${bar("Billing", 48, "var(--up-warn)", "00%")}
${bar("Residency", 21, "var(--up-risk)", "00%")}
</div>
</div>
</div>`,
      ),
      notes:
        "Point at the today line first, then the two lagging workstreams. Chart heights and percentages are sample shapes; replace them with your real burn-up before presenting.",
    },
    {
      layout: "content",
      content: slide(
        4,
        `<h1 style="${h1}margin-top:28px;font-size:36px;line-height:1.05;">Two decisions we need today</h1>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:22px;flex:1;">
<div style="border:1px solid var(--up-line);border-radius:var(--deck-radius);padding:20px 22px;display:flex;flex-direction:column;">
${chip("risk", "At risk")}
<h3 style="margin:14px 0 6px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">Data residency slips past Q0</h3>
<p style="margin:0;font-size:15px;line-height:1.5;color:var(--deck-muted);">Vendor security review has not started. Without it, the EU region cannot launch this quarter.</p>
<dl style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:16px 0 0;font-size:15px;"><dt style="${mono}color:var(--deck-muted);">Owner</dt><dd style="margin:0;">Name Surname</dd><dt style="${mono}color:var(--deck-muted);">Decide by</dt><dd style="margin:0;">Friday, W1</dd><dt style="${mono}color:var(--deck-muted);">If we wait</dt><dd style="margin:0;">Launch moves a full quarter</dd></dl>
<div style="margin-top:auto;display:flex;flex-direction:column;gap:8px;font-size:15px;">
<div style="display:grid;grid-template-columns:24px 1fr auto;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:var(--deck-surface);"><span style="${mono}color:var(--deck-muted);">A</span><span>Escalate the review this week</span><span style="font-size:14px;font-weight:500;color:var(--deck-accent);">Recommended</span></div>
<div style="display:grid;grid-template-columns:24px 1fr auto;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;border:1px solid var(--up-line);"><span style="${mono}color:var(--deck-muted);">B</span><span>Move the launch to Q0 + 1</span><span></span></div>
</div>
</div>
<div style="border:1px solid var(--up-line);border-radius:var(--deck-radius);padding:20px 22px;display:flex;flex-direction:column;">
${chip("warn", "Needs decision")}
<h3 style="margin:14px 0 6px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">Billing meter scope</h3>
<p style="margin:0;font-size:15px;line-height:1.5;color:var(--deck-muted);">Metering every event doubles the work. Metering daily totals ships on time.</p>
<dl style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:16px 0 0;font-size:15px;"><dt style="${mono}color:var(--deck-muted);">Owner</dt><dd style="margin:0;">Name Surname</dd><dt style="${mono}color:var(--deck-muted);">Decide by</dt><dd style="margin:0;">Wednesday, W1</dd><dt style="${mono}color:var(--deck-muted);">If we wait</dt><dd style="margin:0;">Invoices slip two weeks</dd></dl>
<div style="margin-top:auto;display:flex;flex-direction:column;gap:8px;font-size:15px;">
<div style="display:grid;grid-template-columns:24px 1fr auto;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:var(--deck-surface);"><span style="${mono}color:var(--deck-muted);">A</span><span>Ship daily totals first</span><span style="font-size:14px;font-weight:500;color:var(--deck-accent);">Recommended</span></div>
<div style="display:grid;grid-template-columns:24px 1fr auto;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;border:1px solid var(--up-line);"><span style="${mono}color:var(--deck-muted);">B</span><span>Hold for per-event metering</span><span></span></div>
</div>
</div>
</div>`,
      ),
      notes:
        "Ask for each decision explicitly and write the answer into the deck before you leave the room. Replace both examples with your real trade-offs, and keep a recommendation on every one.",
    },
    {
      layout: "content",
      content: slide(
        5,
        `<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:40px;margin-top:28px;">
<h1 style="${h1}font-size:36px;line-height:1.05;">The next six weeks</h1>
<p style="margin:0;font-size:16px;line-height:1.45;color:var(--deck-muted);max-width:380px;">Finish billing, unblock residency, and start the reliability track.</p>
</div>
<div style="margin-top:24px;position:relative;">
<div style="${mono}display:grid;grid-template-columns:150px repeat(6,1fr);font-size:14px;color:var(--deck-muted);padding-bottom:8px;"><span></span><span>W1</span><span>W2</span><span>W3</span><span>W4</span><span>W5</span><span>W6</span></div>
${gantt("Billing", 1, 3, "color-mix(in srgb,var(--up-warn) 16%,transparent)", "Daily totals, then invoices")}
${gantt("Residency", 2, 4, "color-mix(in srgb,var(--up-risk) 13%,transparent)", "Vendor review and EU region")}
${gantt("Reliability", 3, 4, "color-mix(in srgb,var(--deck-accent) 14%,transparent)", "On-call and error budgets")}
${gantt("Search", 1, 2, "var(--deck-surface)", "Tuning and cleanup")}
${gantt("Identity", 5, 2, "var(--deck-surface)", "SCIM provisioning")}
<span style="position:absolute;left:calc(150px + (100% - 150px) / 6 * 4);top:26px;bottom:0;border-left:1px dashed var(--deck-ink);"></span>
</div>
<div style="margin-top:auto;display:flex;gap:24px;font-size:14px;color:var(--deck-muted);"><span style="display:flex;align-items:center;gap:8px;"><span style="width:14px;border-top:1px dashed var(--deck-ink);"></span>Planned release, end of W4</span><span>Owners and dates are placeholders.</span></div>`,
      ),
      notes:
        "Show the plan as commitments, not wishes: every bar needs an owner. Replace the workstreams and spans with your own schedule, and move the release marker to your real date.",
    },
  ],
);
