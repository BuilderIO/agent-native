import type { DesignTemplatePreset } from "../design-template-presets.js";

/**
 * The original generated starters, kept verbatim under their original ids so
 * existing links, tests, and the Figma export baseline keep resolving. New
 * presets are hand-authored in their own files; do not extend this generator.
 */
interface PresetCopy {
  eyebrow: string;
  headline: string;
  body: string;
  cta: string;
  metric: string;
  metricLabel: string;
}

type PresetDirection = "signal" | "flare" | "editorial" | "grid";

interface PresetTheme {
  background: string;
  ink: string;
  muted: string;
  accent: string;
  secondary: string;
  canvas: string;
  displayFont: string;
}

const PRESET_THEMES: Record<PresetDirection, PresetTheme> = {
  signal: {
    // guard:allow-raw-color — authored template palette, not app chrome.
    background: "#101820",
    // guard:allow-raw-color — authored template palette, not app chrome.
    ink: "#F7F3E8",
    // guard:allow-raw-color — authored template palette, not app chrome.
    muted: "#B8C5C7",
    // guard:allow-raw-color — authored template palette, not app chrome.
    accent: "#D7FF4F",
    // guard:allow-raw-color — authored template palette, not app chrome.
    secondary: "#FF6B4A",
    // guard:allow-raw-color — authored template palette, not app chrome.
    canvas: "#C9D1CC",
    displayFont: "Arial Black, Arial, sans-serif",
  },
  flare: {
    // guard:allow-raw-color — authored template palette, not app chrome.
    background: "#F4EEE5",
    // guard:allow-raw-color — authored template palette, not app chrome.
    ink: "#19161C",
    // guard:allow-raw-color — authored template palette, not app chrome.
    muted: "#706878",
    // guard:allow-raw-color — authored template palette, not app chrome.
    accent: "#FF4F79",
    // guard:allow-raw-color — authored template palette, not app chrome.
    secondary: "#FFB84D",
    // guard:allow-raw-color — authored template palette, not app chrome.
    canvas: "#D7D1C8",
    displayFont: "Georgia, serif",
  },
  editorial: {
    // guard:allow-raw-color — authored template palette, not app chrome.
    background: "#E9E3D8",
    // guard:allow-raw-color — authored template palette, not app chrome.
    ink: "#171B2B",
    // guard:allow-raw-color — authored template palette, not app chrome.
    muted: "#5C6577",
    // guard:allow-raw-color — authored template palette, not app chrome.
    accent: "#175BFF",
    // guard:allow-raw-color — authored template palette, not app chrome.
    secondary: "#F05A3C",
    // guard:allow-raw-color — authored template palette, not app chrome.
    canvas: "#C8C5BF",
    displayFont: "Georgia, serif",
  },
  grid: {
    // guard:allow-raw-color — authored template palette, not app chrome.
    background: "#EAF4EF",
    // guard:allow-raw-color — authored template palette, not app chrome.
    ink: "#102A2A",
    // guard:allow-raw-color — authored template palette, not app chrome.
    muted: "#55706D",
    // guard:allow-raw-color — authored template palette, not app chrome.
    accent: "#00A896",
    // guard:allow-raw-color — authored template palette, not app chrome.
    secondary: "#FF7A59",
    // guard:allow-raw-color — authored template palette, not app chrome.
    canvas: "#C6D7D0",
    displayFont: "Courier New, monospace",
  },
};

function motif(direction: PresetDirection): string {
  if (direction === "signal") {
    return `<div class="orbit orbit-a"></div><div class="orbit orbit-b"></div><div class="signal-dot"></div><div class="signal-word">MOVE<br />WITH<br />INTENT</div>`;
  }
  if (direction === "flare") {
    return `<div class="flare-sun"></div><div class="flare-ring ring-a"></div><div class="flare-ring ring-b"></div><div class="flare-label">FIELD<br />NOTES<br /><span>04—24</span></div>`;
  }
  if (direction === "editorial") {
    return `<div class="editorial-block"></div><div class="editorial-circle"></div><div class="editorial-number">01</div><div class="editorial-rule"></div>`;
  }
  return `<div class="grid-panel"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div><div class="grid-sticker">MAKE<br />IT<br />REAL</div>`;
}

function presetHtml({
  title,
  width,
  height,
  copy,
  layout,
  direction,
}: {
  title: string;
  width: number;
  height: number;
  copy: PresetCopy;
  layout: "square" | "wide" | "page" | "landing";
  direction: PresetDirection;
}): string {
  const isPage = layout === "page" || layout === "landing";
  const theme = PRESET_THEMES[direction];
  if (!theme) {
    throw new Error(`Unknown design template direction: ${String(direction)}`);
  }
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script>
    <style>
      :root { --ink:${theme.ink}; --paper:${theme.background}; --muted:${theme.muted}; --accent:${theme.accent}; --secondary:${theme.secondary}; --line:color-mix(in srgb, var(--ink) 18%, transparent); }
      * { box-sizing:border-box; }
      [x-cloak] { display:none !important; }
      html,body { margin:0; min-height:100%; background:${theme.canvas}; font-family:Arial,sans-serif; color:var(--ink); }
      body { display:grid; place-items:center; padding:24px; }
      /* guard:allow-raw-color — authored template shadow, not app chrome. */
      .artboard { position:relative; width:${width}px; height:${height}px; max-width:100%; overflow:hidden; background:var(--paper); box-shadow:0 24px 70px rgba(22,20,16,.2); }
      .backdrop { position:absolute; inset:0; background:linear-gradient(135deg, color-mix(in srgb, var(--paper) 86%, var(--accent)), var(--paper) 58%); pointer-events:none; }
      .brand { position:absolute; top:${isPage ? 48 : 36}px; left:${isPage ? 56 : 42}px; z-index:3; display:flex; align-items:center; gap:10px; font-size:13px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; }
      .brand-mark { width:24px; height:24px; border-radius:50% 50% 8% 50%; background:var(--ink); box-shadow:8px 8px 0 var(--secondary); }
      .content { position:relative; z-index:2; height:100%; display:grid; align-content:${layout === "landing" ? "start" : "end"}; padding:${isPage ? "132px 56px 56px" : "108px 42px 42px"}; }
      .hero { position:relative; z-index:2; max-width:78%; }
      .eyebrow { margin:0 0 20px; color:var(--accent); font-size:13px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; }
      h1 { max-width:${layout === "wide" || layout === "landing" ? "820px" : "680px"}; margin:0; font-family:${theme.displayFont}; font-size:${layout === "square" ? "82px" : layout === "wide" ? "72px" : "64px"}; line-height:.94; letter-spacing:-.055em; }
      .body { max-width:650px; margin:24px 0 0; color:var(--muted); font-size:${isPage ? "20px" : "18px"}; line-height:1.45; }
      .footer { position:relative; z-index:3; display:flex; align-items:end; justify-content:space-between; gap:24px; margin-top:${layout === "landing" ? "72px" : "42px"}; padding-top:24px; border-top:1px solid var(--line); }
      .cta { display:inline-flex; align-items:center; justify-content:center; min-height:48px; padding:0 22px; border-radius:999px; background:var(--ink); color:var(--paper); font-size:14px; font-weight:700; }
      button.cta { border:0; cursor:pointer; font:inherit; }
      /* guard:allow-raw-color — authored template shadow, not app chrome. */
      .live-panel { position:absolute; left:${isPage ? 56 : 42}px; bottom:${isPage ? 56 : 42}px; z-index:6; width:min(360px,calc(100% - 84px)); padding:22px; border:1px solid color-mix(in srgb, var(--ink) 16%, transparent); border-radius:18px; background:color-mix(in srgb, var(--paper) 92%, white); box-shadow:0 18px 50px rgba(22,20,16,.18); }
      .live-panel p { margin:0; color:var(--muted); font-size:15px; line-height:1.45; }
      .live-panel strong { display:block; margin-bottom:6px; color:var(--ink); font-size:16px; }
      .live-panel-close { margin-top:16px; border:0; background:transparent; color:var(--ink); cursor:pointer; font:inherit; font-size:13px; font-weight:700; text-decoration:underline; }
      .metric strong { display:block; font-size:36px; letter-spacing:-.04em; }
      .metric span { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.12em; }
      .motif { position:absolute; inset:0; z-index:1; overflow:hidden; pointer-events:none; }
      .orbit { position:absolute; border:1px solid color-mix(in srgb, var(--accent) 66%, transparent); border-radius:50%; transform:rotate(-18deg); }
      .orbit-a { width:72%; aspect-ratio:1; right:-16%; top:6%; }
      .orbit-b { width:46%; aspect-ratio:1; right:5%; top:23%; border-width:18px; border-color:color-mix(in srgb, var(--secondary) 72%, transparent); }
      .signal-dot { position:absolute; width:18%; aspect-ratio:1; right:17%; top:35%; border-radius:50%; background:var(--accent); box-shadow:0 0 0 18px color-mix(in srgb, var(--accent) 20%, transparent), 0 0 80px var(--accent); }
      .signal-word { position:absolute; right:7%; bottom:19%; color:var(--ink); font-size:12px; font-weight:800; letter-spacing:.18em; line-height:1.25; text-align:right; }
      .flare-sun { position:absolute; width:52%; aspect-ratio:1; right:-12%; top:2%; border-radius:50%; background:radial-gradient(circle at 32% 32%, var(--secondary), var(--accent) 44%, color-mix(in srgb, var(--accent) 35%, transparent) 45%, transparent 68%); }
      .flare-ring { position:absolute; border:1px solid color-mix(in srgb, var(--accent) 70%, transparent); border-radius:50%; }
      .ring-a { width:78%; aspect-ratio:1; right:-23%; top:-18%; }
      .ring-b { width:64%; aspect-ratio:1; right:-10%; top:8%; border-width:12px; border-color:color-mix(in srgb, var(--secondary) 48%, transparent); }
      .flare-label { position:absolute; right:8%; bottom:18%; color:var(--accent); font-size:12px; font-weight:800; letter-spacing:.2em; line-height:1.35; text-align:right; }
      .flare-label span { color:var(--ink); }
      .editorial-block { position:absolute; width:48%; height:68%; right:8%; top:16%; background:var(--accent); transform:rotate(7deg); box-shadow:22px 22px 0 var(--secondary); }
      .editorial-circle { position:absolute; width:20%; aspect-ratio:1; right:25%; top:30%; border-radius:50%; background:var(--paper); mix-blend-mode:screen; }
      .editorial-number { position:absolute; right:15%; top:19%; color:var(--paper); font-family:${theme.displayFont}; font-size:110px; line-height:1; }
      .editorial-rule { position:absolute; width:30%; right:20%; bottom:22%; border-top:2px solid var(--paper); }
      .grid-panel { position:absolute; width:54%; height:64%; right:8%; top:18%; display:grid; grid-template-columns:repeat(3,1fr); gap:10px; transform:rotate(-8deg); }
      .grid-panel span { background:var(--accent); border-radius:50%; box-shadow:inset 0 0 0 10px color-mix(in srgb, var(--paper) 45%, transparent); }
      .grid-panel span:nth-child(2n) { background:var(--secondary); border-radius:10px; }
      .grid-panel span:nth-child(5) { background:var(--ink); border-radius:50%; }
      .grid-sticker { position:absolute; right:11%; top:31%; padding:14px 16px; background:var(--paper); color:var(--ink); font-size:12px; font-weight:800; letter-spacing:.14em; line-height:1.15; transform:rotate(8deg); box-shadow:8px 8px 0 var(--ink); }
      ${layout === "landing" ? ".content{grid-template-rows:auto 1fr}.hero{padding-top:90px}.footer{align-self:end}" : ""}
      @media (max-width:700px) { body{padding:0}.artboard{width:100vw;height:auto;min-height:100vh}.content{padding:110px 28px 32px}.brand{left:28px}.hero{max-width:100%}h1{font-size:54px}.footer{align-items:start;flex-direction:column}.metric{display:none}.motif{opacity:.72} }
    </style>
  </head>
  <body x-data="{ open: false }">
    <main class="artboard" data-agent-native-node-id="template-artboard">
      <div class="backdrop" style="position:absolute;inset:0;background:linear-gradient(135deg, #${theme.background.slice(1)} 0%, #${theme.background.slice(1)} 100%);pointer-events:none" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <div class="brand" style="position:absolute;top:${isPage ? 48 : 36}px;left:${isPage ? 56 : 42}px;z-index:2;display:flex;align-items:center;gap:10px;font-size:13px;font-weight:800;letter-spacing:.16em;text-transform:uppercase" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <span class="brand-mark" style="width:24px;height:24px;border-radius:50% 50% 8% 50%;background:${theme.ink}"></span><span>Northstar</span>
      </div>
      <div class="motif" aria-hidden="true">${motif(direction)}</div>
      <section class="content" data-agent-native-node-id="template-content">
        <div class="hero">
          <p class="eyebrow">${copy.eyebrow}</p>
          <h1>${copy.headline}</h1>
          <p class="body">${copy.body}</p>
        </div>
        <div class="footer">
          <button class="cta" type="button" @click="open = !open" :aria-expanded="open">${copy.cta}</button>
          <div class="metric"><strong>${copy.metric}</strong><span>${copy.metricLabel}</span></div>
        </div>
      </section>
      <aside class="live-panel" x-cloak x-show="open" aria-live="polite">
        <strong>Keep exploring.</strong>
        <p>This is a working preview. Try the controls, links, and responsive behavior before you use the template.</p>
        <button class="live-panel-close" type="button" @click="open = false">Close details</button>
      </aside>
    </main>
  </body>
</html>`;
}

export const LEGACY_DESIGN_TEMPLATE_PRESETS: DesignTemplatePreset[] = [
  {
    id: "preset-social-square",
    title: "Social ad — square",
    description:
      "A 1080 × 1080 campaign unit with locked brand and background layers.",
    category: "social",
    width: 1080,
    height: 1080,
    filename: "social-square.html",
    content: presetHtml({
      title: "Social ad — square",
      width: 1080,
      height: 1080,
      layout: "square",
      direction: "signal",
      copy: {
        eyebrow: "New release",
        headline: "Make the work feel lighter.",
        body: "A flexible campaign canvas for bold product stories, offers, and launches.",
        cta: "Start free",
        metric: "2.4×",
        metricLabel: "faster setup",
      },
    }),
  },
  {
    id: "preset-display-ad",
    title: "Display ad — landscape",
    description:
      "A 1200 × 628 ad unit with a fixed brand signature and editable offer.",
    category: "ad",
    width: 1200,
    height: 628,
    filename: "display-ad.html",
    content: presetHtml({
      title: "Display ad — landscape",
      width: 1200,
      height: 628,
      layout: "wide",
      direction: "flare",
      copy: {
        eyebrow: "Built for momentum",
        headline: "Your next launch starts here.",
        body: "Swap the message and offer while the delivery format stays exactly on spec.",
        cta: "See what’s new",
        metric: "40%",
        metricLabel: "more reach",
      },
    }),
  },
  {
    id: "preset-one-pager",
    title: "Product one-pager",
    description:
      "An 816 × 1056 letter-format brief for launches, sales, and handouts.",
    category: "one-pager",
    width: 816,
    height: 1056,
    filename: "product-one-pager.html",
    content: presetHtml({
      title: "Product one-pager",
      width: 816,
      height: 1056,
      layout: "page",
      direction: "editorial",
      copy: {
        eyebrow: "Product brief / 01",
        headline: "One clear page. One strong idea.",
        body: "Turn a complex product story into a focused narrative with room for proof, positioning, and a next step.",
        cta: "Book a demo",
        metric: "8.5 × 11",
        metricLabel: "print ready",
      },
    }),
  },
  {
    id: "preset-landing-page",
    title: "Launch landing page",
    description:
      "A 1440 × 1024 responsive hero starter with a protected brand frame.",
    category: "landing-page",
    width: 1440,
    height: 1024,
    filename: "launch-landing-page.html",
    content: presetHtml({
      title: "Launch landing page",
      width: 1440,
      height: 1024,
      layout: "landing",
      direction: "grid",
      copy: {
        eyebrow: "Introducing Northstar",
        headline: "A launch page with somewhere to go.",
        body: "Start with the right proportions, hierarchy, and locked brand anchors—then prompt the rest into place.",
        cta: "Explore the product",
        metric: "1440px",
        metricLabel: "desktop canvas",
      },
    }),
  },
];
