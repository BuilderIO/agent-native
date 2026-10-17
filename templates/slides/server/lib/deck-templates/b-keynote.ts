import { bDeck, bRoot, tint } from "./b-shared.js";

const C = {
  bg: "#050507", // guard:allow-raw-color — authored slide palette, not app chrome.
  ink: "#F4F4F6", // guard:allow-raw-color — authored slide palette, not app chrome.
  muted: "#9A9AA6", // guard:allow-raw-color — authored slide palette, not app chrome.
  surface: "#111117", // guard:allow-raw-color — authored slide palette, not app chrome.
  violet: "#7B5CFF", // guard:allow-raw-color — authored slide palette, not app chrome.
  magenta: "#FF4F9E", // guard:allow-raw-color — authored slide palette, not app chrome.
  amber: "#FFB45C", // guard:allow-raw-color — authored slide palette, not app chrome.
};

const TOKENS = `--deck-bg:${C.bg};--deck-ink:${C.ink};--deck-muted:${C.muted};--deck-accent:${C.violet};--deck-surface:${C.surface};--deck-heading-font:'Syne',sans-serif;--deck-body-font:'Geist',sans-serif;--deck-radius:28px;font-family:'Geist',sans-serif;`;

const slide = (style: string, body: string) =>
  bRoot(TOKENS, `clip-path:inset(0);${style}`, body);

const H1 = `margin:0;font-family:'Syne',sans-serif;font-weight:700;color:var(--deck-ink);letter-spacing:-0.04em;`;
const SOFT = tint(C.ink, 70);
const LABEL = `font-size:14px;font-weight:500;letter-spacing:0.28em;text-transform:uppercase;color:var(--deck-muted);`;

const horizon = (color: string) =>
  `<div style="position:absolute;left:0;right:0;bottom:92px;height:1px;background:linear-gradient(90deg,transparent,${tint(color, 90)} 50%,transparent);"></div>`;

const feature = (mark: string, title: string, body: string) => `
  <div style="display:flex;flex-direction:column;gap:14px;padding-top:26px;border-top:1px solid ${tint(C.ink, 18)};">
    ${mark}
    <h2 style="margin:0;font-family:var(--deck-heading-font);font-weight:700;font-size:28px;line-height:1.05;letter-spacing:-0.03em;color:var(--deck-ink);">${title}</h2>
    <p style="margin:0;font-size:17px;line-height:1.5;color:var(--deck-muted);">${body}</p>
  </div>`;

const spec = (value: string, unit: string, label: string) => `
  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:1px solid ${tint(C.ink, 14)};">
    <span style="font-family:var(--deck-heading-font);font-weight:700;font-size:42px;letter-spacing:-0.04em;color:var(--deck-ink);">${value}<span style="font-size:22px;color:var(--deck-muted);letter-spacing:-0.01em;"> ${unit}</span></span>
    <span style="font-size:17px;color:var(--deck-muted);text-align:right;">${label}</span>
  </div>`;

export const KEYNOTE_DECK = bDeck(
  "starter-keynote",
  "Launch Keynote",
  "keynote",
  "A cinematic product launch: near-black stage, one luminous glow per slide, and enormous type that lands one idea at a time.",
  [
    [
      "title",
      slide(
        `padding:72px 80px;align-items:center;justify-content:center;text-align:center;gap:26px;background:radial-gradient(70% 64% at 50% 122%,${C.violet} 0%,${tint(C.magenta, 55)} 40%,transparent 74%),radial-gradient(30% 22% at 50% 104%,${C.amber},transparent 80%),var(--deck-bg);`,
        `${horizon(C.amber)}
        <h1 style="${H1}font-size:112px;line-height:0.9;white-space:nowrap;">Meet Lumen.</h1>
        <p style="margin:0;max-width:540px;font-size:22px;line-height:1.45;color:${SOFT};">The shortest path from a first idea to a finished thing. Replace this line with your one-sentence promise.</p>
        <span style="position:absolute;left:0;right:0;bottom:40px;${LABEL}">Sample launch event · Month 00, 2026</span>`,
      ),
      "Open in silence and let the glow do the work. Replace the product name and the promise line with your own, then say the promise out loud exactly as written. The date line is a placeholder; set it to the real event date.",
    ],
    [
      "statement",
      slide(
        `padding:80px;justify-content:flex-end;gap:28px;background:radial-gradient(55% 85% at 94% -14%,${C.violet} 0%,${tint(C.magenta, 35)} 46%,transparent 74%),var(--deck-bg);`,
        `<h1 style="${H1}font-size:92px;line-height:0.95;max-width:780px;">Great work shouldn't <span style="color:var(--deck-muted);">wait on its tools.</span></h1>
        <p style="margin:0;max-width:520px;font-size:21px;line-height:1.5;color:${SOFT};">For years the process got in the way of the product. Name the tension your audience already feels before you show them the answer.</p>`,
      ),
      "This is the problem beat. Keep it to one sentence and one breath. Swap in the frustration your audience recognizes; the muted half of the headline should be the part they nod at.",
    ],
    [
      "statement",
      slide(
        `padding:64px 80px;align-items:center;justify-content:center;text-align:center;gap:6px;background:radial-gradient(34% 44% at 50% 44%,${tint(C.violet, 70)} 0%,${tint(C.magenta, 18)} 55%,transparent 78%),var(--deck-bg);`,
        `<span style="font-family:var(--deck-heading-font);font-weight:700;font-size:210px;line-height:0.86;letter-spacing:-0.05em;color:var(--deck-ink);">00×</span>
        <h1 style="${H1}font-size:44px;line-height:1.1;margin-top:18px;">faster, from first draft to final.</h1>
        <p style="margin:12px 0 0;font-size:16px;line-height:1.5;color:var(--deck-muted);">Sample benchmark. Replace with a measured result and cite its source.</p>`,
      ),
      "The reveal. Click to this slide, pause, and let the number sit before you read the line under it. The 00× figure is a placeholder: only use a number you can source, and name the comparison and test conditions if asked.",
    ],
    [
      "content",
      slide(
        `padding:72px 80px 64px;justify-content:space-between;background:radial-gradient(40% 50% at 8% -6%,${tint(C.violet, 55)},transparent 70%),var(--deck-bg);`,
        `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:40px;">
          <h1 style="${H1}font-size:64px;line-height:0.98;max-width:520px;">Three ideas. One product.</h1>
          <p style="margin:0;max-width:280px;font-size:17px;line-height:1.5;color:var(--deck-muted);">Everything else in the launch hangs off these three. Keep each to a single line.</p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:40px;">
          ${feature(`<div style="width:36px;height:36px;border-radius:50%;background:radial-gradient(circle at 35% 35%,${C.ink},${C.violet} 55%,transparent 72%);"></div>`, "Instant", "Opens before you finish thinking about it. Describe your fastest moment here.")}
          ${feature(`<div style="width:36px;height:36px;border-radius:10px;background:conic-gradient(from 200deg,${C.violet},${C.magenta},${C.amber},${C.violet});"></div>`, "Together", "Everyone on the same page, live. Describe how people share and collaborate.")}
          ${feature(`<div style="box-sizing:border-box;width:36px;height:36px;border-radius:50%;border:2px solid ${C.amber};box-shadow:0 0 18px ${tint(C.amber, 60)};"></div>`, "Private", "Your work stays yours by default. Describe the promise you can keep.")}
        </div>`,
      ),
      "Walk the three pillars left to right, about twenty seconds each. Rename them to your real features; if you have more than three, cut rather than shrink. Each description should be one plain sentence.",
    ],
    [
      "content",
      slide(
        `padding:72px 80px 72px 500px;justify-content:center;gap:10px;background:radial-gradient(34% 58% at 26% 50%,${tint(C.violet, 40)},transparent 72%),var(--deck-bg);`,
        `<div style="position:absolute;left:92px;top:110px;width:320px;height:320px;border-radius:50%;background:conic-gradient(from 210deg,${C.violet},${C.magenta},${C.amber},${C.violet});filter:blur(46px);opacity:0.55;"></div>
        <div style="position:absolute;left:92px;top:110px;width:320px;height:320px;border-radius:50%;background:conic-gradient(from 210deg,${C.violet},${C.magenta},${C.amber},${C.violet});mask:radial-gradient(circle,transparent 60%,${C.ink} 61%);"></div>
        <span style="position:absolute;left:92px;top:258px;width:320px;text-align:center;${LABEL}letter-spacing:0.2em;">Product render</span>
        <h1 style="${H1}font-size:40px;line-height:1.02;margin-bottom:12px;">Built to disappear into your day.</h1>
        <p style="margin:0 0 8px;font-size:17px;line-height:1.5;color:var(--deck-muted);">Sample specifications. Swap in verified figures before you present.</p>
        ${spec("00", "hr", "Battery, typical use")}
        ${spec("0.0", "kg", "Weight")}
        ${spec("00", "ms", "Response time")}`,
      ),
      "The spec beat. Replace the ring with your product render when you have one; keep the three specs your audience asks about most. Every number here is a placeholder, so confirm each with engineering before the event.",
    ],
    [
      "statement",
      slide(
        `padding:64px 80px;align-items:center;justify-content:center;text-align:center;gap:18px;background:radial-gradient(30% 22% at 50% 52%,${tint(C.violet, 42)},transparent 75%),var(--deck-bg);`,
        `<div style="position:absolute;left:479px;top:0;width:2px;height:218px;background:linear-gradient(180deg,transparent,${tint(C.violet, 80)} 55%,${C.ink});box-shadow:0 0 22px 2px ${tint(C.violet, 70)};"></div>
        <h1 style="${H1}font-size:76px;line-height:1;margin-top:120px;">One more thing.</h1>
        <p style="margin:0;max-width:460px;font-size:19px;line-height:1.5;color:var(--deck-muted);">The surprise you saved for last. Keep this slide up for a full beat before you speak.</p>`,
      ),
      "Pause before you advance to this slide and again after it appears. Say the line, then cut to your reveal. If there is no surprise, delete this slide rather than filling it.",
    ],
    [
      "title",
      slide(
        `padding:72px 80px;justify-content:space-between;background:radial-gradient(80% 75% at 0% 120%,${C.amber} 0%,${tint(C.magenta, 60)} 36%,${tint(C.violet, 25)} 58%,transparent 76%),var(--deck-bg);`,
        `<span style="${LABEL}">Available</span>
        <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:40px;">
          <h1 style="${H1}font-size:100px;line-height:0.9;white-space:nowrap;">Month 00.</h1>
          <div style="flex:none;width:250px;display:flex;flex-direction:column;gap:10px;align-items:flex-end;text-align:right;padding-bottom:10px;">
            <span style="font-family:var(--deck-heading-font);font-weight:700;font-size:40px;letter-spacing:-0.03em;">From $000</span>
            <p style="margin:0;font-size:18px;line-height:1.5;color:${SOFT};">Pre-orders open today at yourproduct.example</p>
          </div>
        </div>`,
      ),
      "Close on the date, the price, and where to go. Read the date slowly. All three are placeholders; confirm availability, pricing, and the link before this slide goes on a stage.",
    ],
  ],
);
