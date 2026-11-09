import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";
import { guideFrame } from "./guide.js";

// A grayscale wireframe and a one-page brief, side by side. The brief's
// palette is the template's palette, so when the agent turns the wireframe
// into a finished page it already has real colors and fonts to use.
const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  surface: "#FFFFFF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#F4F4F2",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#1F1F1E",
  // guard:allow-raw-color — authored template palette, not app chrome.
  soft: "#5E5E5B",
  // guard:allow-raw-color — authored template palette, not app chrome.
  line: "rgba(31, 31, 30, 0.14)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  wireFill: "#EDEDEB",
  // guard:allow-raw-color — authored template palette, not app chrome.
  wireStroke: "#B5B5B1",
  // guard:allow-raw-color — authored template palette, not app chrome.
  wireBar: "#D9D9D6",
  // guard:allow-raw-color — authored template palette, not app chrome.
  wireInk: "#3A3A38",
  // guard:allow-raw-color — authored template palette, not app chrome.
  note: "#FFE58A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  noteInk: "#4A3B00",
  // guard:allow-raw-color — authored template palette, not app chrome.
  basil: "#2F5D3A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  terracotta: "#C8553D",
  // guard:allow-raw-color — authored template palette, not app chrome.
  oat: "#F3EBDD",
  // guard:allow-raw-color — authored template palette, not app chrome.
  soil: "#2A211C",
  // guard:allow-raw-color — authored template palette, not app chrome.
  shadow: "rgba(31, 31, 30, 0.12)",
};

const PALETTE = {
  canvas: C.surface,
  surface: C.surface,
  paper: C.paper,
  ink: C.ink,
  soft: C.soft,
  line: C.line,
  "wire-fill": C.wireFill,
  "wire-stroke": C.wireStroke,
  "wire-bar": C.wireBar,
  "wire-ink": C.wireInk,
  note: C.note,
  "note-ink": C.noteInk,
  basil: C.basil,
  terracotta: C.terracotta,
  oat: C.oat,
  soil: C.soil,
  shadow: C.shadow,
};

const FONTS =
  "family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Work+Sans:wght@400;500;600&family=Inter:wght@400;500;600;700&family=Kalam:wght@400;700&family=JetBrains+Mono:wght@500";

const BRAND = {
  name: "Fennick",
  product: "Fennick One",
};

const BASE_CSS = `
      .artboard { color:var(--ink); font-family:'Inter', sans-serif; }
      .page { position:relative; z-index:1; }
      .tag { display:inline-block; color:var(--soft); font:500 12px/1 'JetBrains Mono', monospace; letter-spacing:.12em; text-transform:uppercase; }
      .bar { display:block; height:12px; border-radius:6px; background:var(--wire-bar); }
      .box { border:2px solid var(--wire-stroke); border-radius:14px; background:var(--wire-fill); }
      .ph { position:relative; display:grid; place-items:center; border:2px solid var(--wire-stroke); border-radius:14px; background:var(--wire-fill); overflow:hidden; }
      .ph svg { position:absolute; inset:0; width:100%; height:100%; }
      .ph span { position:relative; padding:8px 14px; border-radius:999px; background:var(--surface); color:var(--soft); font-size:14px; font-weight:600; }
      .rough { color:var(--wire-ink); font-weight:700; letter-spacing:-.02em; }
      .wbtn { display:inline-flex; align-items:center; justify-content:center; height:52px; padding:0 26px; border-radius:10px; font-size:16px; font-weight:600; }
      .wbtn-fill { background:var(--wire-ink); color:var(--surface); }
      .wbtn-line { border:2px solid var(--wire-stroke); color:var(--wire-ink); }
      .note { position:absolute; z-index:4; width:250px; padding:18px 20px 20px; background:var(--note); color:var(--note-ink); font:400 20px/1.3 'Kalam', cursive; box-shadow:0 12px 28px var(--shadow); }
      .note b { display:block; margin-bottom:4px; font-weight:700; font-size:14px; font-family:'Inter', sans-serif; letter-spacing:.08em; text-transform:uppercase; }
      .section { position:relative; padding:0 120px; }
      .section > .tag { margin-bottom:20px; }
`;

const cross = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="0" x2="100" y2="100" style="stroke:var(--wire-stroke)" stroke-width="1.5" vector-effect="non-scaling-stroke"/><line x1="100" y1="0" x2="0" y2="100" style="stroke:var(--wire-stroke)" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;

const placeholder = (id: string, name: string, label: string, style: string) =>
  `<div class="ph" style="${style}" data-agent-native-node-id="${id}" data-agent-native-layer-name="${name}">${cross}<span>${label}</span></div>`;

const bars = (widths: number[], gap = 14) =>
  `<div style="display:flex;flex-direction:column;gap:${gap}px">${widths.map((w) => `<i class="bar" style="width:${w}%"></i>`).join("")}</div>`;

const note = (id: string, label: string, text: string, style: string) =>
  `<div class="note" style="${style}" data-agent-native-node-id="${id}" data-agent-native-layer-name="Note: ${label}"><b>${label}</b>${text}</div>`;

const wireBackground = `<div style="position:absolute;inset:0;background:var(--surface)" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>`;

// A wireframe-style stand-in for the logo: dashed box, crossed circle.
const wireLogo = `<div style="position:absolute;top:40px;left:120px;z-index:3;display:flex;align-items:center;gap:10px;height:48px;padding:0 16px;border:2px dashed var(--wire-stroke);border-radius:10px;color:var(--soft);font:600 14px/1 'Inter',sans-serif;letter-spacing:.14em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo placeholder" data-agent-native-locked="true">
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" style="fill:var(--wire-fill);stroke:var(--wire-stroke)" stroke-width="2"/><path d="M5 5l14 14M19 5L5 19" style="stroke:var(--wire-stroke)" stroke-width="1.5"/></svg>
        <span>LOGO</span>
      </div>`;

// The real brand mark, used on the brief and the guide.
const brandLogo = (size: number, top: number, left: number) =>
  `<div style="position:absolute;top:${top}px;left:${left}px;z-index:3;display:flex;align-items:center;gap:${Math.round(size * 0.36)}px;color:var(--soil);font:600 ${size}px/1 'Fraunces',serif;letter-spacing:-.02em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="${Math.round(size * 1.2)}" height="${Math.round(size * 1.2)}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="16" style="fill:var(--basil)"/><path d="M16 25V13M16 17c0-5 3-8 8-8 0 5-3 8-8 8zM16 20c0-4-2.5-6.5-7-6.5 0 4 2.5 6.5 7 6.5z" style="fill:var(--oat);stroke:var(--oat)" stroke-width="1.6" stroke-linejoin="round"/></svg>
        <span>${BRAND.name}</span>
      </div>`;

const feature = (id: string, title: string, widths: number[]) => `
          <div class="box" style="padding:32px;background:var(--surface)" data-agent-native-node-id="${id}" data-agent-native-layer-name="Feature: ${title}">
            <div style="width:64px;height:64px;border-radius:50%;border:2px solid var(--wire-stroke);background:var(--wire-fill)"></div>
            <div class="rough" style="margin-top:24px;font-size:24px">${title}</div>
            <div style="margin-top:18px">${bars(widths, 12)}</div>
          </div>`;

const howStep = (n: string, title: string, id: string) => `
            <li style="display:flex;gap:20px;align-items:flex-start" data-agent-native-node-id="${id}" data-agent-native-layer-name="Step ${n}">
              <span style="flex:none;display:grid;place-items:center;width:44px;height:44px;border-radius:50%;border:2px solid var(--wire-stroke);color:var(--wire-ink);font-weight:700;font-size:18px">${n}</span>
              <div style="flex:1;padding-top:8px"><div class="rough" style="font-size:22px">${title}</div><div style="margin-top:14px">${bars([90, 60], 10)}</div></div>
            </li>`;

const WIRE_HEIGHT = 2520;

const wireframe = presetDocument({
  title: `${BRAND.name} — Landing page wireframe`,
  width: 1440,
  height: WIRE_HEIGHT,
  fonts: FONTS,
  palette: PALETTE,
  css: `${BASE_CSS}
      .nav { display:flex; align-items:center; justify-content:flex-end; gap:40px; height:128px; padding:0 120px 0 420px; }
      .nav .bar { width:72px; }
      .rule { height:0; margin:0 120px; border-top:2px dashed var(--wire-bar); }
      .hero { display:grid; grid-template-columns:540px 1fr; gap:60px; align-items:center; padding-top:48px; padding-bottom:72px; }
      .hero h1 { font-size:64px; line-height:1.04; }
      .proof { padding-top:56px; padding-bottom:60px; }
      .proof-row { display:flex; align-items:center; gap:24px; }
      .proof-row .box { flex:1; height:64px; border-radius:10px; }
      .features { padding-top:60px; padding-bottom:72px; }
      .features-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:30px; margin-top:36px; }
      .how { display:grid; grid-template-columns:560px 1fr; gap:80px; align-items:center; padding-top:64px; padding-bottom:64px; }
      .how ol { display:flex; flex-direction:column; gap:32px; margin-top:36px; }
      .cta { padding-top:56px; padding-bottom:48px; }
      .cta-band { display:flex; align-items:center; justify-content:space-between; gap:40px; padding:56px 64px; }
      .footer { display:flex; align-items:center; justify-content:space-between; padding-top:32px; }
    `,
  body: `
      ${wireBackground}
      ${wireLogo}
      <div class="page" data-agent-native-node-id="wireframe-page" data-agent-native-layer-name="Wireframe page">
        <nav class="nav" data-agent-native-node-id="nav" data-agent-native-layer-name="Navigation">
          <i class="bar"></i><i class="bar"></i><i class="bar"></i><i class="bar" style="width:56px"></i>
          <span class="wbtn wbtn-line" style="height:44px;padding:0 20px;font-size:15px">Get started</span>
        </nav>
        <div class="rule"></div>

        <section class="section hero" data-agent-native-node-id="hero" data-agent-native-layer-name="Hero">
          <div data-agent-native-node-id="hero-copy" data-agent-native-layer-name="Hero copy">
            <span class="tag">01 · Hero</span>
            <h1 class="rough" style="margin-top:24px" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">Fresh herbs on your counter, all year round</h1>
            <div style="margin-top:32px" data-agent-native-node-id="hero-lede" data-agent-native-layer-name="Lede placeholder">${bars([100, 92, 64])}</div>
            <div style="display:flex;gap:14px;margin-top:40px" data-agent-native-node-id="hero-buttons" data-agent-native-layer-name="Buttons">
              <span class="wbtn wbtn-fill">Get ${BRAND.product}</span>
              <span class="wbtn wbtn-line">How it works</span>
            </div>
          </div>
          ${placeholder("hero-image", "Hero image", "Product shot", "height:480px")}
          ${note("note-hero", "Hero", "Hero needs a product shot: the planter with basil in it, on a real kitchen counter.", "right:84px;bottom:52px;transform:rotate(2.5deg)")}
        </section>
        <div class="rule"></div>

        <section class="section proof" data-agent-native-node-id="social-proof" data-agent-native-layer-name="Social proof">
          <span class="tag">02 · Social proof</span>
          <div class="proof-row">
            <div style="flex:none;width:220px;color:var(--soft);font-size:16px;font-weight:600;line-height:1.35">Growing in 12,000 kitchens</div>
            <div class="box"></div><div class="box"></div><div class="box"></div><div class="box"></div><div class="box"></div>
          </div>
        </section>
        <div class="rule"></div>

        <section class="section features" data-agent-native-node-id="features" data-agent-native-layer-name="Features">
          <span class="tag">03 · Features</span>
          <h2 class="rough" style="font-size:44px" data-agent-native-node-id="features-heading" data-agent-native-layer-name="Features heading">Why it keeps your basil alive</h2>
          <div class="features-grid">
            ${feature("feature-water", "Waters itself", [100, 86, 54])}
            ${feature("feature-light", "Grows in any light", [100, 78, 62])}
            ${feature("feature-pods", "Pods you can compost", [100, 90, 46])}
          </div>
          ${note("note-features", "Features", "Keep it to three. Simple icons, not photos.", "right:150px;top:28px;transform:rotate(-2deg)")}
        </section>
        <div class="rule"></div>

        <section class="section how" data-agent-native-node-id="how-it-works" data-agent-native-layer-name="How it works">
          ${placeholder("how-image", "Lifestyle image", "Lifestyle photo", "height:400px")}
          <div>
            <span class="tag">04 · How it works</span>
            <h2 class="rough" style="margin-top:20px;font-size:44px;line-height:1.08" data-agent-native-node-id="how-heading" data-agent-native-layer-name="How it works heading">Harvest in three weeks</h2>
            <ol data-agent-native-node-id="how-steps" data-agent-native-layer-name="Steps">
              ${howStep("1", "Drop in a seed pod", "how-step-1")}
              ${howStep("2", "Fill the tank once a month", "how-step-2")}
              ${howStep("3", "Snip what you need", "how-step-3")}
            </ol>
          </div>
          ${note("note-quote", "Idea", "Could use a short customer quote somewhere in here?", "left:520px;bottom:40px;transform:rotate(-3deg)")}
        </section>
        <div class="rule"></div>

        <section class="section cta" data-agent-native-node-id="final-cta" data-agent-native-layer-name="Final call to action">
          <span class="tag">05 · Final CTA</span>
          <div class="box cta-band">
            <div>
              <h2 class="rough" style="font-size:40px" data-agent-native-node-id="cta-heading" data-agent-native-layer-name="CTA heading">Start growing this weekend</h2>
              <div style="width:420px;margin-top:20px">${bars([100, 70], 10)}</div>
            </div>
            <span class="wbtn wbtn-fill" style="height:60px;padding:0 32px;font-size:17px" data-agent-native-node-id="cta-button" data-agent-native-layer-name="CTA button">Get ${BRAND.product}</span>
          </div>
          ${note("note-cta", "CTA", "Repeat the price right next to this button.", "right:72px;top:4px;transform:rotate(2deg)")}
        </section>

        <footer class="section footer" data-agent-native-node-id="footer" data-agent-native-layer-name="Footer">
          <div style="display:flex;align-items:center;gap:40px">
            <div style="width:120px;height:40px;border:2px dashed var(--wire-stroke);border-radius:8px"></div>
            <i class="bar" style="width:72px"></i><i class="bar" style="width:72px"></i><i class="bar" style="width:72px"></i>
          </div>
          <span style="color:var(--soft);font-size:14px">© 2026 ${BRAND.name}</span>
        </footer>
      </div>`,
});

const swatch = (token: string, name: string, use: string, ring = false) => `
            <li style="display:flex;flex-direction:column;gap:10px" data-agent-native-node-id="swatch-${token}" data-agent-native-layer-name="Swatch: ${name}">
              <span style="display:block;height:56px;border-radius:12px;background:var(--${token});${ring ? "border:1px solid var(--line);" : ""}"></span>
              <span style="font-size:16px;font-weight:600">${name}</span>
              <span style="margin-top:-6px;color:var(--soft);font-size:13px;line-height:1.35">--${token}<br>${use}</span>
            </li>`;

const brief = presetDocument({
  title: `${BRAND.name} — Brief`,
  width: 640,
  height: 900,
  fonts: FONTS,
  palette: { ...PALETTE, canvas: C.oat },
  css: `
      .artboard { color:var(--soil); font-family:'Work Sans', sans-serif; }
      .brief { position:absolute; left:56px; right:56px; top:112px; z-index:2; }
      .brief h1 { font:600 38px/1.05 'Fraunces', serif; letter-spacing:-.02em; }
      .brief .lede { margin-top:12px; color:var(--soft); font-size:17px; line-height:1.5; }
      .row { margin-top:16px; padding-top:14px; border-top:1px solid var(--line); }
      .label { display:block; margin-bottom:8px; color:var(--soft); font-size:13px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; }
      .row p { font-size:16px; line-height:1.5; }
      .chips { display:flex; gap:8px; }
      .chips span { padding:7px 14px; border-radius:999px; background:var(--surface); font-size:15px; font-weight:500; }
      .swatches { display:grid; grid-template-columns:repeat(4, 1fr); gap:14px; }
      .type { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
      .type div { padding:10px 16px; border-radius:14px; background:var(--surface); }
      .type small { display:block; margin-top:6px; color:var(--soft); font-size:13px; }
      .must { display:grid; gap:6px; }
      .must li { position:relative; padding-left:22px; font-size:16px; line-height:1.4; }
      .must li::before { content:""; position:absolute; left:2px; top:8px; width:8px; height:8px; border-radius:50%; background:var(--terracotta); }
    `,
  body: `
      <div style="position:absolute;inset:0;background:var(--oat)" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      ${brandLogo(24, 52, 56)}
      <span style="position:absolute;top:58px;right:56px;z-index:2;color:var(--soft);font-size:14px;font-weight:500" data-agent-native-node-id="brief-version" data-agent-native-layer-name="Version">Brief · Spring launch</span>
      <div class="brief" data-agent-native-node-id="brief" data-agent-native-layer-name="Brief">
        <h1 data-agent-native-node-id="brief-title" data-agent-native-layer-name="Title">Landing page: ${BRAND.product}</h1>
        <p class="lede" data-agent-native-node-id="brief-summary" data-agent-native-layer-name="Summary">A countertop herb garden that waters itself. It's $129, with no subscription, and it ships in April.</p>
        <div class="row" data-agent-native-node-id="brief-audience" data-agent-native-layer-name="Audience">
          <span class="label">Audience</span>
          <p>Renters who cook most nights, have small kitchens, and have killed at least one supermarket basil plant.</p>
        </div>
        <div class="row" data-agent-native-node-id="brief-tone" data-agent-native-layer-name="Tone">
          <span class="label">Tone</span>
          <div class="chips"><span>Warm</span><span>Plainspoken</span><span>A little cheeky</span></div>
        </div>
        <div class="row" data-agent-native-node-id="brief-palette" data-agent-native-layer-name="Palette">
          <span class="label">Palette</span>
          <ul class="swatches">
            ${swatch("basil", "Basil", "Primary")}
            ${swatch("terracotta", "Terracotta", "Accent")}
            ${swatch("oat", "Oat", "Background", true)}
            ${swatch("soil", "Soil", "Text")}
          </ul>
        </div>
        <div class="row" data-agent-native-node-id="brief-type" data-agent-native-layer-name="Type">
          <span class="label">Type</span>
          <div class="type">
            <div><span style="font:600 26px/1.1 'Fraunces',serif">Fraunces</span><small>Headlines</small></div>
            <div><span style="font:500 22px/1.2 'Work Sans',sans-serif">Work Sans</span><small>Body and buttons</small></div>
          </div>
        </div>
        <div class="row" data-agent-native-node-id="brief-must-haves" data-agent-native-layer-name="Must-haves">
          <span class="label">Must-haves</span>
          <ul class="must">
            <li>A real product shot in the hero, with herbs growing</li>
            <li>The price up front, and no hint of a subscription</li>
            <li>One short quote from a real-sounding customer</li>
            <li>A signup button above the fold and again at the end</li>
          </ul>
        </div>
      </div>`,
});

const guide = guideFrame({
  title: "How this works",
  documentTitle: `${BRAND.name} — How this works`,
  intro:
    "A rough layout and a short brief are all the agent needs to design the real page.",
  steps: [
    {
      title: "Set the brief",
      body: "The brief's colors are this file's tokens. Change a swatch and the finished design uses it.",
      prompt: "Make the Terracotta swatch a brighter tomato red.",
    },
    {
      title: "Polish the wireframe",
      body: "The agent reads the boxes, the copy and the sticky notes, then follows the brief.",
      prompt:
        "Turn the wireframe into a polished design using the brief, as a new frame.",
    },
    {
      title: "Take it further",
      body: "Once the desktop page looks right, build other sizes from it.",
      prompt: "Make a 390-wide mobile version of the polished page.",
    },
  ],
  logo: brandLogo(20, 52, 96),
  fonts: FONTS,
  palette: PALETTE,
  displayFont: "'Fraunces', serif",
  bodyFont: "'Work Sans', sans-serif",
});

export const wireframeToPolished: DesignTemplatePreset = {
  id: "preset-wireframe-to-polished",
  title: "Wireframe to polished",
  description:
    "A grayscale landing page wireframe and a one-page brief. Ask the agent to turn the rough layout into a finished design in the brief's colors and fonts.",
  category: "landing-page",
  width: 1440,
  height: WIRE_HEIGHT,
  filename: "wireframe.html",
  content: wireframe,
  frames: [
    {
      key: "brief",
      filename: "brief.html",
      x: 1560,
      y: 0,
      width: 640,
      height: 900,
      content: brief,
    },
    {
      key: "guide",
      filename: "how-this-works.html",
      x: 1560,
      y: 1140,
      width: 1440,
      height: 620,
      content: guide,
    },
  ],
};
