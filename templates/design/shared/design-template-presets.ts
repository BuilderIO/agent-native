export type DesignTemplateCategory =
  | "ad"
  | "one-pager"
  | "landing-page"
  | "social"
  | "presentation"
  | "other";

export interface DesignTemplatePreset {
  id: string;
  title: string;
  description: string;
  category: DesignTemplateCategory;
  width: number;
  height: number;
  filename: string;
  content: string;
}

interface PresetCopy {
  eyebrow: string;
  headline: string;
  body: string;
  cta: string;
  metric: string;
  metricLabel: string;
}

function presetHtml({
  title,
  width,
  height,
  copy,
  layout,
}: {
  title: string;
  width: number;
  height: number;
  copy: PresetCopy;
  layout: "square" | "wide" | "page" | "landing";
}): string {
  const isPage = layout === "page" || layout === "landing";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      :root { --ink:#11110f; --paper:#f3efe6; --accent:#ff5a36; --line:rgba(17,17,15,.14); }
      * { box-sizing:border-box; }
      html,body { margin:0; min-height:100%; background:#d9d6cf; font-family:Inter,Arial,sans-serif; color:var(--ink); }
      body { display:grid; place-items:center; padding:24px; }
      .artboard { position:relative; width:${width}px; height:${height}px; max-width:100%; overflow:hidden; background:var(--paper); box-shadow:0 24px 70px rgba(22,20,16,.18); }
      .backdrop { position:absolute; inset:0; background:radial-gradient(circle at 82% 18%, rgba(255,90,54,.28), transparent 30%), linear-gradient(145deg, transparent 55%, rgba(17,17,15,.07)); pointer-events:none; }
      .brand { position:absolute; top:${isPage ? 48 : 36}px; left:${isPage ? 56 : 42}px; z-index:2; display:flex; align-items:center; gap:10px; font-size:13px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; }
      .brand-mark { width:24px; height:24px; border-radius:50% 50% 8% 50%; background:var(--ink); }
      .content { position:relative; z-index:1; height:100%; display:grid; align-content:${layout === "landing" ? "start" : "end"}; padding:${isPage ? "132px 56px 56px" : "108px 42px 42px"}; }
      .eyebrow { margin:0 0 20px; color:var(--accent); font-size:13px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; }
      h1 { max-width:${layout === "wide" || layout === "landing" ? "820px" : "680px"}; margin:0; font-size:${layout === "square" ? "82px" : layout === "wide" ? "72px" : "64px"}; line-height:.94; letter-spacing:-.055em; }
      .body { max-width:650px; margin:24px 0 0; color:rgba(17,17,15,.66); font-size:${isPage ? "20px" : "18px"}; line-height:1.45; }
      .footer { display:flex; align-items:end; justify-content:space-between; gap:24px; margin-top:${layout === "landing" ? "72px" : "42px"}; padding-top:24px; border-top:1px solid var(--line); }
      .cta { display:inline-flex; align-items:center; justify-content:center; min-height:48px; padding:0 22px; border-radius:999px; background:var(--ink); color:white; font-size:14px; font-weight:700; }
      .metric strong { display:block; font-size:36px; letter-spacing:-.04em; }
      .metric span { color:rgba(17,17,15,.55); font-size:12px; text-transform:uppercase; letter-spacing:.12em; }
      ${layout === "landing" ? ".content{grid-template-rows:auto 1fr}.hero{padding-top:90px}.footer{align-self:end}" : ""}
      @media (max-width:700px) { body{padding:0}.artboard{width:100vw;height:auto;min-height:100vh}.content{padding:110px 28px 32px}.brand{left:28px}h1{font-size:54px}.footer{align-items:start;flex-direction:column}.metric{display:none} }
    </style>
  </head>
  <body>
    <main class="artboard" data-agent-native-node-id="template-artboard">
      <div class="backdrop" style="position:absolute;inset:0;background:radial-gradient(circle at 82% 18%, rgba(255,90,54,.28), transparent 30%),linear-gradient(145deg, transparent 55%, rgba(17,17,15,.07));pointer-events:none" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <div class="brand" style="position:absolute;top:${isPage ? 48 : 36}px;left:${isPage ? 56 : 42}px;z-index:2;display:flex;align-items:center;gap:10px;font-size:13px;font-weight:800;letter-spacing:.16em;text-transform:uppercase" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <span class="brand-mark" style="width:24px;height:24px;border-radius:50% 50% 8% 50%;background:#11110f"></span><span>Northstar</span>
      </div>
      <section class="content" data-agent-native-node-id="template-content">
        <div class="hero">
          <p class="eyebrow">${copy.eyebrow}</p>
          <h1>${copy.headline}</h1>
          <p class="body">${copy.body}</p>
        </div>
        <div class="footer">
          <span class="cta">${copy.cta}</span>
          <div class="metric"><strong>${copy.metric}</strong><span>${copy.metricLabel}</span></div>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

export const DESIGN_TEMPLATE_PRESETS: DesignTemplatePreset[] = [
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

export function getDesignTemplatePreset(
  id: string,
): DesignTemplatePreset | undefined {
  return DESIGN_TEMPLATE_PRESETS.find((preset) => preset.id === id);
}
