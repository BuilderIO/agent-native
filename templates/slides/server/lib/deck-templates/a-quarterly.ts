import { authoredDeck, slideRoot } from "./a-shared.js";

// guard:allow-raw-color — authored slide palette, not app chrome.
const [navy, ink, muted, teal, surface] = [
  "#0A0F1C", // guard:allow-raw-color
  "#E6EAF2", // guard:allow-raw-color
  "#8B96AC", // guard:allow-raw-color
  "#2DD4BF", // guard:allow-raw-color
  "#111A2D", // guard:allow-raw-color
];
// guard:allow-raw-color — authored data colors, not app chrome.
const [amber, loss, gridline] = ["#F5B64C", "#F4776F", "#1F2A42"];

const tokens = `--deck-bg:${navy};--deck-ink:${ink};--deck-muted:${muted};--deck-accent:${teal};--deck-surface:${surface};--deck-heading-font:'IBM Plex Sans',sans-serif;--deck-body-font:'IBM Plex Sans',sans-serif;--deck-radius:6px;--qt-amber:${amber};--qt-loss:${loss};--qt-grid:${gridline};`;

const mono = "font-family:'JetBrains Mono',monospace;";
const h1 =
  "font-family:'IBM Plex Sans',sans-serif;font-weight:700;letter-spacing:-0.02em;margin:0;";
const label = `${mono}font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:var(--deck-muted);`;

const slide = (page: number, body: string) =>
  slideRoot(
    tokens,
    "font-family:'IBM Plex Sans',sans-serif;padding:24px 40px 26px;display:flex;flex-direction:column;",
    `<div style="${mono}display:flex;justify-content:space-between;align-items:center;font-size:14px;color:var(--deck-muted);padding-bottom:12px;border-bottom:1px solid var(--qt-grid);"><span style="display:flex;align-items:center;gap:10px;"><span style="width:8px;height:8px;background:var(--deck-accent);"></span><span style="color:var(--deck-ink);">QBR / Q0 20XX</span></span><span>SAMPLE DATA</span><span>0${page} / 06</span></div>${body}`,
  );

const delta = (value: string, up = true) =>
  `<span style="${mono}display:inline-block;padding:2px 7px;border-radius:4px;font-size:14px;font-weight:700;background:color-mix(in srgb,${up ? "var(--deck-accent)" : "var(--qt-loss)"} 16%,transparent);color:${up ? "var(--deck-accent)" : "var(--qt-loss)"};">${value}</span>`;

/** A polyline drawn as a thin clip-path band, since the slide sanitizer drops inline SVG. */
function band(points: readonly number[], w: number, h: number, t: number) {
  const xy = points.map((v, i) => [(i / (points.length - 1)) * w, h - v * h]);
  const top = xy.map(
    ([x, y]) => `${x.toFixed(1)}px ${(y - t / 2).toFixed(1)}px`,
  );
  const bottom = xy
    .reverse()
    .map(([x, y]) => `${x.toFixed(1)}px ${(y + t / 2).toFixed(1)}px`);
  return `polygon(${[...top, ...bottom].join(",")})`;
}

function area(points: readonly number[], w: number, h: number) {
  const xy = points.map(
    (v, i) =>
      `${((i / (points.length - 1)) * w).toFixed(1)}px ${(h - v * h).toFixed(1)}px`,
  );
  return `polygon(0px ${h}px,${xy.join(",")},${w}px ${h}px)`;
}

const cover = [0.18, 0.24, 0.22, 0.35, 0.41, 0.52, 0.58, 0.74];
const actual = [0.42, 0.46, 0.44, 0.55, 0.58, 0.63, 0.61, 0.72];
const target = [0.5, 0.52, 0.54, 0.56, 0.58, 0.6, 0.62, 0.64];

const kpi = (
  name: string,
  value: string,
  change: string,
  pct: number,
  up = true,
) =>
  `<div style="background:var(--deck-surface);border:1px solid var(--qt-grid);border-radius:var(--deck-radius);padding:16px 18px;display:flex;flex-direction:column;"><span style="${label}">${name}</span><span style="display:flex;align-items:baseline;justify-content:space-between;margin-top:10px;"><span style="font-size:38px;font-weight:700;letter-spacing:-0.02em;font-variant-numeric:tabular-nums;">${value}</span>${delta(change, up)}</span><span style="position:relative;display:block;height:6px;margin-top:16px;border-radius:3px;background:var(--qt-grid);"><span style="display:block;height:6px;width:${pct}%;border-radius:3px;background:${up ? "var(--deck-accent)" : "var(--qt-loss)"};"></span><span style="position:absolute;left:80%;top:-4px;height:14px;border-left:2px solid var(--qt-amber);"></span></span><span style="${mono}margin-top:8px;font-size:14px;color:var(--deck-muted);">00% of plan</span></div>`;

const months = [
  [30, 8],
  [34, 9],
  [31, 12],
  [38, 11],
  [42, 13],
  [40, 16],
  [47, 15],
  [51, 18],
  [49, 20],
  [56, 21],
  [60, 24],
  [66, 26],
];

const bars = months
  .map(
    ([core, expansion]) =>
      `<div style="flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;gap:2px;"><span style="height:${expansion}%;background:var(--qt-amber);border-radius:2px 2px 0 0;"></span><span style="height:${core}%;background:var(--deck-accent);"></span></div>`,
  )
  .join("");

const monthLabels = months
  .map((_, i) => `<span style="flex:1;text-align:center;">M${i + 1}</span>`)
  .join("");

const gridLines = (count: number, labels: readonly string[], gutter = 0) =>
  Array.from(
    { length: count },
    (_, i) =>
      `<div style="position:absolute;left:0;right:0;top:${(i / (count - 1)) * 100}%;border-top:1px ${i === count - 1 ? "solid" : "dashed"} var(--qt-grid);"><span style="${mono}position:absolute;left:${gutter}px;top:${gutter ? -10 : -20}px;font-size:14px;color:var(--deck-muted);">${labels[i]}</span></div>`,
  ).join("");

const segment = (
  name: string,
  cells: readonly string[],
  mix: number,
  total = false,
) =>
  `<tr style="border-top:1px solid ${total ? "var(--deck-muted)" : "var(--qt-grid)"};${total ? "font-weight:700;" : ""}"><td style="padding:15px 0;font-size:16px;">${name}</td>${cells.map((c) => `<td style="${mono}padding:15px 0 15px 16px;text-align:right;font-size:15px;color:${c.startsWith("+") ? "var(--deck-accent)" : c.startsWith("-") ? "var(--qt-loss)" : "var(--deck-ink)"};">${c}</td>`).join("")}<td style="padding:15px 0 15px 24px;width:170px;"><span style="display:block;height:10px;border-radius:2px;background:var(--qt-grid);"><span style="display:block;height:10px;width:${mix}%;border-radius:2px;background:${total ? "var(--deck-ink)" : "var(--deck-accent)"};"></span></span></td></tr>`;

const guide = (name: string, lo: number, hi: number, base: number) =>
  `<div style="display:grid;grid-template-columns:120px 1fr;align-items:center;gap:18px;padding:24px 0 20px;border-top:1px solid var(--qt-grid);"><span style="font-size:16px;font-weight:700;">${name}</span><span style="position:relative;height:36px;"><span style="position:absolute;left:0;right:0;top:12px;border-top:1px dashed var(--qt-grid);"></span><span style="position:absolute;left:${lo}%;width:${hi - lo}%;top:6px;height:12px;border-radius:6px;background:color-mix(in srgb,var(--deck-accent) 28%,transparent);"></span><span style="position:absolute;left:${base}%;top:2px;width:4px;height:20px;margin-left:-2px;border-radius:2px;background:var(--deck-accent);"></span><span style="${mono}position:absolute;left:${lo}%;top:22px;font-size:14px;color:var(--deck-muted);">$00.0M</span><span style="${mono}position:absolute;left:${hi}%;top:22px;transform:translateX(-100%);font-size:14px;color:var(--deck-muted);">$00.0M</span></span></div>`;

export const QUARTERLY_DECK = authoredDeck(
  "starter-qbr",
  "Quarterly business review",
  "quarterly",
  "A disciplined dark data-terminal review: KPI scorecard, revenue and retention charts, a segment table, and guidance for next quarter.",
  [
    {
      layout: "title",
      content: slide(
        1,
        `<div style="display:grid;grid-template-columns:1fr 420px;gap:36px;flex:1;margin-top:34px;">
<div style="display:flex;flex-direction:column;">
<h1 style="${h1}font-size:58px;line-height:1.02;">Q0 20XX<br>business review</h1>
<p style="margin:16px 0 0;font-size:19px;line-height:1.45;color:var(--deck-muted);max-width:400px;">Results, drivers, and the plan for next quarter, prepared for the leadership team.</p>
<span style="${mono}margin-top:auto;font-size:14px;color:var(--deck-muted);">Finance / Name Surname / 20XX-00-00</span>
</div>
<div style="position:relative;border:1px solid var(--qt-grid);border-radius:var(--deck-radius);background:var(--deck-surface);padding:16px 18px;">
<div style="display:flex;justify-content:space-between;"><span style="${label}">Revenue, 8 qtrs</span>${delta("+00.0%")}</div>
<div style="position:relative;height:180px;margin-top:22px;">
<div style="position:absolute;inset:0;clip-path:${area(cover, 382, 180)};background:linear-gradient(180deg,color-mix(in srgb,var(--deck-accent) 34%,transparent),transparent);"></div>
<div style="position:absolute;inset:0;clip-path:${band(cover, 382, 180, 3)};background:var(--deck-accent);"></div>
<span style="position:absolute;right:-6px;top:${180 - 0.74 * 180 - 6}px;width:12px;height:12px;border-radius:50%;background:var(--deck-accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--deck-accent) 25%,transparent);"></span>
</div>
<div style="${mono}display:flex;justify-content:space-between;margin-top:10px;font-size:14px;color:var(--deck-muted);"><span>Q0-7</span><span style="color:var(--deck-ink);font-weight:700;">$00.0M</span></div>
</div>
</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);margin-top:22px;border-top:1px solid var(--qt-grid);">
<div style="padding:14px 16px 0 0;"><span style="${label}">Revenue</span><span style="display:flex;align-items:baseline;gap:10px;margin-top:6px;"><span style="font-size:26px;font-weight:700;">$00.0M</span>${delta("+0.0%")}</span></div>
<div style="padding:14px 16px 0;border-left:1px solid var(--qt-grid);"><span style="${label}">Gross margin</span><span style="display:flex;align-items:baseline;gap:10px;margin-top:6px;"><span style="font-size:26px;font-weight:700;">00.0%</span>${delta("+0.0pt")}</span></div>
<div style="padding:14px 16px 0;border-left:1px solid var(--qt-grid);"><span style="${label}">Net retention</span><span style="display:flex;align-items:baseline;gap:10px;margin-top:6px;"><span style="font-size:26px;font-weight:700;">000%</span>${delta("-0.0pt", false)}</span></div>
<div style="padding:14px 0 0 16px;border-left:1px solid var(--qt-grid);"><span style="${label}">Customers</span><span style="display:flex;align-items:baseline;gap:10px;margin-top:6px;"><span style="font-size:26px;font-weight:700;">0,000</span>${delta("+000")}</span></div>
</div>`,
      ),
      notes:
        "Open with the four headline numbers, then say in one sentence whether the quarter beat plan. Every figure and chart shape is sample data; replace them from your finance system before presenting.",
    },
    {
      layout: "content",
      content: slide(
        2,
        `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:32px;margin-top:22px;">
<h1 style="${h1}font-size:36px;line-height:1.05;">Scorecard</h1>
<p style="margin:0;font-size:16px;line-height:1.45;color:var(--deck-muted);max-width:430px;">Five of six metrics finished ahead of plan. The amber tick marks the plan for each metric.</p>
</div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:1fr 1fr;gap:14px;flex:1;margin-top:20px;">
${kpi("Revenue", "$00.0M", "+0.0%", 92)}
${kpi("Annual recurring", "$00.0M", "+0.0%", 88)}
${kpi("Gross margin", "00.0%", "+0.0pt", 84)}
${kpi("Net retention", "000%", "-0.0pt", 71, false)}
${kpi("New customers", "000", "+00", 96)}
${kpi("Burn multiple", "0.0x", "+0.0x", 82)}
</div>`,
      ),
      notes:
        "Scan the grid left to right and call out the one metric that missed. Replace every value, delta, and bar with actuals; keep the plan marker at each metric's real target.",
    },
    {
      layout: "content",
      content: slide(
        3,
        `<div style="display:grid;grid-template-columns:1fr 250px;gap:32px;flex:1;margin-top:22px;">
<div style="display:flex;flex-direction:column;">
<h1 style="${h1}font-size:32px;line-height:1.05;">Revenue by month</h1>
<div style="display:flex;gap:18px;margin-top:10px;font-size:14px;color:var(--deck-muted);"><span style="display:flex;align-items:center;gap:8px;"><span style="width:10px;height:10px;background:var(--deck-accent);"></span>Core subscriptions</span><span style="display:flex;align-items:center;gap:8px;"><span style="width:10px;height:10px;background:var(--qt-amber);"></span>Expansion</span></div>
<div style="position:relative;height:270px;margin-top:34px;">
${gridLines(4, ["$0.0M", "$0.0M", "$0.0M", "$0"])}
<div style="position:absolute;left:64px;right:0;top:0;bottom:0;display:flex;gap:10px;">${bars}</div>
<div style="${mono}position:absolute;left:calc(64px + (100% - 64px) * 0.75 + 4px);right:0;top:-24px;padding-top:4px;border-top:1px solid var(--deck-ink);font-size:14px;text-align:center;">THIS QUARTER</div>
</div>
<div style="${mono}display:flex;gap:10px;margin:8px 0 0 64px;font-size:14px;color:var(--deck-muted);">${monthLabels}</div>
</div>
<div style="border-left:1px solid var(--qt-grid);padding-left:24px;display:flex;flex-direction:column;gap:18px;">
<span style="${label}">What drove it</span>
<div><h3 style="margin:0 0 4px;font-size:17px;font-weight:700;">Annual upgrades</h3><p style="margin:0;font-size:15px;line-height:1.45;color:var(--deck-muted);">Most expansion came from teams moving to annual plans in M10 to M12.</p></div>
<div><h3 style="margin:0 0 4px;font-size:17px;font-weight:700;">Price change</h3><p style="margin:0;font-size:15px;line-height:1.45;color:var(--deck-muted);">New list prices applied to new customers from M7.</p></div>
<div><h3 style="margin:0 0 4px;font-size:17px;font-weight:700;">Seasonality</h3><p style="margin:0;font-size:15px;line-height:1.45;color:var(--deck-muted);">M6 dipped with the usual mid-year slowdown.</p></div>
</div>
</div>`,
      ),
      notes:
        "Walk the chart from left to right, then land on the three drivers. The bars are illustrative shapes; rebuild them from your monthly revenue, and relabel months to match your fiscal calendar.",
    },
    {
      layout: "content",
      content: slide(
        4,
        `<div style="display:grid;grid-template-columns:1fr 240px;gap:32px;flex:1;margin-top:22px;">
<div style="display:flex;flex-direction:column;">
<h1 style="${h1}font-size:32px;line-height:1.05;">Net retention against target</h1>
<div style="display:flex;gap:18px;margin-top:10px;font-size:14px;color:var(--deck-muted);"><span style="display:flex;align-items:center;gap:8px;"><span style="width:16px;height:3px;background:var(--deck-accent);"></span>Actual</span><span style="display:flex;align-items:center;gap:8px;"><span style="width:16px;border-top:2px dashed var(--qt-amber);"></span>Target</span></div>
<div style="position:relative;height:250px;margin-top:30px;margin-left:56px;">
${gridLines(5, ["000%", "000%", "000%", "000%", "00%"], -56)}
<div style="position:absolute;inset:0;clip-path:${area(actual, 574, 250)};background:linear-gradient(180deg,color-mix(in srgb,var(--deck-accent) 22%,transparent),transparent);"></div>
<div style="position:absolute;inset:0;clip-path:${band(target, 574, 250, 2.5)};background:repeating-linear-gradient(90deg,var(--qt-amber) 0 9px,transparent 9px 15px);"></div>
<div style="position:absolute;inset:0;clip-path:${band(actual, 574, 250, 3)};background:var(--deck-accent);"></div>
<span style="position:absolute;right:-6px;top:${250 - 0.72 * 250 - 6}px;width:12px;height:12px;border-radius:50%;background:var(--deck-accent);"></span>
<div style="${mono}position:absolute;left:0;right:0;bottom:-28px;display:flex;justify-content:space-between;font-size:14px;color:var(--deck-muted);"><span>Q0-7</span><span>Q0-6</span><span>Q0-5</span><span>Q0-4</span><span>Q0-3</span><span>Q0-2</span><span>Q0-1</span><span>Q0</span></div>
</div>
</div>
<div style="border-left:1px solid var(--qt-grid);padding-left:24px;display:flex;flex-direction:column;gap:22px;">
<div><span style="${label}">This quarter</span><span style="display:block;margin-top:6px;font-size:40px;font-weight:700;letter-spacing:-0.02em;">000%</span>${delta("+0.0pt vs target")}</div>
<div><span style="${label}">Gross churn</span><span style="display:block;margin-top:6px;font-size:40px;font-weight:700;letter-spacing:-0.02em;">0.0%</span>${delta("-0.0pt QoQ", false)}</div>
<p style="margin:auto 0 0;font-size:15px;line-height:1.45;color:var(--deck-muted);">Retention crossed target in Q0-1 after the onboarding changes shipped.</p>
</div>
</div>`,
      ),
      notes:
        "Point to where the actual line crosses the target and explain what changed. Both series are sample shapes; regenerate them from your cohort data and keep the target line honest.",
    },
    {
      layout: "content",
      content: slide(
        5,
        `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:32px;margin-top:22px;">
<h1 style="${h1}font-size:32px;line-height:1.05;">Performance by segment</h1>
<p style="margin:0;font-size:15px;line-height:1.45;color:var(--deck-muted);max-width:380px;">Mid-market carried the quarter; self-serve contracted as we raised prices.</p>
</div>
<table style="width:100%;border-collapse:collapse;margin-top:22px;">
<thead><tr style="${label}"><th style="text-align:left;font-weight:400;padding:0 0 10px;">Segment</th><th style="text-align:right;font-weight:400;padding:0 0 10px 16px;">Revenue</th><th style="text-align:right;font-weight:400;padding:0 0 10px 16px;">QoQ</th><th style="text-align:right;font-weight:400;padding:0 0 10px 16px;">YoY</th><th style="text-align:right;font-weight:400;padding:0 0 10px 16px;">Margin</th><th style="text-align:left;font-weight:400;padding:0 0 10px 24px;">Mix</th></tr></thead>
<tbody>
${segment("Enterprise", ["$00.0M", "+0.0%", "+00.0%", "00.0%"], 38)}
${segment("Mid-market", ["$00.0M", "+0.0%", "+00.0%", "00.0%"], 31)}
${segment("Small business", ["$0.0M", "+0.0%", "+0.0%", "00.0%"], 17)}
${segment("Self-serve", ["$0.0M", "-0.0%", "-0.0%", "00.0%"], 9)}
${segment("Partners", ["$0.0M", "+0.0%", "+00.0%", "00.0%"], 5)}
${segment("Total", ["$00.0M", "+0.0%", "+00.0%", "00.0%"], 100, true)}
</tbody></table>`,
      ),
      notes:
        "Read the total row first, then explain the one segment that moved against the trend. All figures are placeholders; paste your segment actuals and recompute the mix bars.",
    },
    {
      layout: "content",
      content: slide(
        6,
        `<div style="display:grid;grid-template-columns:1fr 300px;gap:36px;flex:1;margin-top:22px;">
<div style="display:flex;flex-direction:column;">
<h1 style="${h1}font-size:32px;line-height:1.05;">Guidance for Q0 + 1</h1>
<p style="margin:10px 0 18px;font-size:15px;line-height:1.45;color:var(--deck-muted);">Ranges show low and high cases; the bright marker is the base case we plan against.</p>
${guide("Revenue", 18, 72, 50)}
${guide("Gross margin", 34, 80, 60)}
${guide("Operating cost", 22, 58, 40)}
<span style="${mono}margin-top:auto;font-size:14px;color:var(--deck-muted);">Sample ranges. Replace with your finance model.</span>
</div>
<div style="align-self:start;margin-top:52px;background:var(--deck-surface);border:1px solid var(--qt-grid);border-radius:var(--deck-radius);padding:18px 20px;display:flex;flex-direction:column;gap:16px;">
<span style="${label}">Priorities</span>
<div style="display:grid;grid-template-columns:28px 1fr;gap:8px;"><span style="${mono}font-size:14px;color:var(--qt-amber);">P1</span><span style="font-size:16px;line-height:1.4;">Lift net retention above target in every segment</span></div>
<div style="display:grid;grid-template-columns:28px 1fr;gap:8px;"><span style="${mono}font-size:14px;color:var(--qt-amber);">P2</span><span style="font-size:16px;line-height:1.4;">Launch annual plans for small business</span></div>
<div style="display:grid;grid-template-columns:28px 1fr;gap:8px;"><span style="${mono}font-size:14px;color:var(--qt-amber);">P3</span><span style="font-size:16px;line-height:1.4;">Hold operating cost growth below revenue growth</span></div>
</div>
</div>`,
      ),
      notes:
        "Frame the ranges as the conditions for each case, not predictions. Replace the ranges and base-case markers with your finance model, and name an owner for each priority.",
    },
  ],
);
