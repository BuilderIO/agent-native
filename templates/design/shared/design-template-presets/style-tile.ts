import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";
import { guideFrame } from "./guide.js";

// A brand style tile for a made-up tea company, plus a social post and a web
// banner built from the same tokens. Every color and font below comes from
// the palette, so one token edit restyles the tile and both ads together.
const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#F5EFE4",
  // guard:allow-raw-color — authored template palette, not app chrome.
  surface: "#FFFDF8",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#2A1F1A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  soft: "#6B5D52",
  // guard:allow-raw-color — authored template palette, not app chrome.
  line: "rgba(42, 31, 26, 0.14)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accent: "#B5532E",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accentDeep: "#8C3D1F",
  // guard:allow-raw-color — authored template palette, not app chrome.
  accentSoft: "#F3D9C8",
  // guard:allow-raw-color — authored template palette, not app chrome.
  sage: "#5F7A5A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  sageSoft: "#DCE5D5",
  // guard:allow-raw-color — authored template palette, not app chrome.
  honey: "#E3A640",
  // guard:allow-raw-color — authored template palette, not app chrome.
  muted: "#E8E0D3",
  // guard:allow-raw-color — authored template palette, not app chrome.
  shadow: "rgba(42, 31, 26, 0.12)",
};

const PALETTE = {
  canvas: C.paper,
  paper: C.paper,
  surface: C.surface,
  ink: C.ink,
  soft: C.soft,
  line: C.line,
  accent: C.accent,
  "accent-deep": C.accentDeep,
  "accent-soft": C.accentSoft,
  sage: C.sage,
  "sage-soft": C.sageSoft,
  honey: C.honey,
  muted: C.muted,
  shadow: C.shadow,
  "font-display": "'Young Serif', serif",
  "font-body": "'Work Sans', sans-serif",
};

const FONTS = "family=Young+Serif&family=Work+Sans:wght@400;500;600";

const BRAND = "Larkspur Tea Co.";

// The swatches shown on the tile. Hex labels are written out when the
// template is built, so they're a record of the starting palette. The "#" is
// an entity so the label reads as text, not as a color value in the markup.
const SWATCHES: { token: string; name: string; hex: string; role: string }[] = [
  { token: "ink", name: "Steep", hex: C.ink, role: "Text and dark fills" },
  { token: "accent", name: "Kiln", hex: C.accent, role: "Primary actions" },
  {
    token: "accent-deep",
    name: "Ember",
    hex: C.accentDeep,
    role: "Hover, pressed",
  },
  { token: "sage", name: "Sage", hex: C.sage, role: "Botanical accents" },
  { token: "honey", name: "Honey", hex: C.honey, role: "Highlights" },
  { token: "accent-soft", name: "Clay", hex: C.accentSoft, role: "Soft fills" },
  { token: "sage-soft", name: "Leaf", hex: C.sageSoft, role: "Tags, panels" },
  { token: "paper", name: "Oat", hex: C.paper, role: "Page background" },
];

const BASE_CSS = `
      .artboard { color:var(--ink); font-family:var(--font-body); }
      .display { font-family:var(--font-display); font-weight:400; letter-spacing:-.015em; text-wrap:balance; }
      .eyebrow { color:var(--soft); font-size:13px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; }
      .btn { display:inline-flex; align-items:center; justify-content:center; gap:10px; border-radius:999px; font-family:var(--font-body); font-weight:600; white-space:nowrap; }
      .btn-primary { background:var(--accent); color:var(--surface); }
      .btn-hover { background:var(--accent-deep); color:var(--surface); }
      .btn-disabled { background:var(--muted); color:var(--soft); }
      .btn-secondary { border:1.5px solid var(--ink); color:var(--ink); }
      .tag { display:inline-flex; align-items:center; gap:8px; border-radius:999px; font-weight:500; }
      .tag-sage { background:var(--sage-soft); color:var(--ink); }
      .tag-clay { background:var(--accent-soft); color:var(--ink); }
      .tag-line { border:1.5px solid var(--line); color:var(--ink); }
`;

const background = `<div style="position:absolute;inset:0;background:var(--paper)" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>`;

const mark = (size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" style="fill:var(--accent)"/><path d="M16 25c-5-3-7-8-5-14 5 1 8 5 7 10M16 25c3-2 5-6 4-11" style="fill:none;stroke:var(--surface)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const logo = (size: number, top: number, left: number) =>
  `<div style="position:absolute;top:${top}px;left:${left}px;z-index:3;display:flex;align-items:center;gap:${Math.round(size * 0.4)}px;color:var(--ink);font:400 ${size}px/1 var(--font-display);letter-spacing:-.01em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        ${mark(Math.round(size * 1.35))}
        <span>${BRAND}</span>
      </div>`;

// A tea tin drawn in SVG. Body color is a token, so the tins restyle too.
const tin = (w: number, body: string, id: string) => {
  const h = Math.round(w * 1.3);
  return `<svg width="${w}" height="${h}" viewBox="0 0 100 130" aria-hidden="true" data-agent-native-node-id="${id}" data-agent-native-layer-name="Tea tin">
        <ellipse cx="50" cy="124" rx="44" ry="5" style="fill:var(--shadow)"/>
        <rect x="8" y="26" width="84" height="98" rx="6" style="fill:var(${body})"/>
        <rect x="4" y="12" width="92" height="20" rx="5" style="fill:var(--ink)"/>
        <rect x="18" y="50" width="64" height="52" rx="4" style="fill:var(--surface)"/>
        <path d="M50 92c-9-5-12-14-8-26 9 2 14 10 12 20M50 92c5-4 8-10 7-18" style="fill:none;stroke:var(${body})" stroke-width="3" stroke-linecap="round"/>
        <rect x="8" y="110" width="84" height="4" style="fill:var(--ink);opacity:.25"/>
      </svg>`;
};

// Loose tea leaves on a soft panel: the brand's texture.
const texture = (w: number, h: number, id: string, scale = 1) => `
      <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" data-agent-native-node-id="${id}" data-agent-native-layer-name="Leaf texture">
        <defs>
          <pattern id="${id}-leaves" width="${88 * scale}" height="${88 * scale}" patternUnits="userSpaceOnUse" patternTransform="rotate(-18) scale(${scale})">
            <path d="M14 40c0-14 10-24 26-26 0 16-10 26-26 26z" style="fill:var(--sage)"/>
            <path d="M14 40l20-20" style="fill:none;stroke:var(--sage-soft)" stroke-width="2"/>
            <path d="M58 82c-2-12 4-22 18-26 2 14-4 24-18 26z" style="fill:var(--accent)"/>
            <circle cx="70" cy="20" r="4" style="fill:var(--honey)"/>
            <circle cx="30" cy="70" r="3" style="fill:var(--ink);opacity:.35"/>
          </pattern>
        </defs>
        <rect width="${w}" height="${h}" style="fill:var(--sage-soft)"/>
        <rect width="${w}" height="${h}" style="fill:url(#${id}-leaves)"/>
      </svg>`;

// ——— Style tile ———
const swatch = (s: (typeof SWATCHES)[number]) => `
          <li class="swatch" data-agent-native-node-id="swatch-${s.token}" data-agent-native-layer-name="${s.name} swatch">
            <span class="chip" style="background:var(--${s.token})"></span>
            <span class="sw-name">${s.name}</span>
            <code>--${s.token}</code>
            <span class="sw-hex">&#35;${s.hex.slice(1)}</span>
          </li>`;

const typeRow = (spec: string, sample: string, style: string, id: string) => `
          <li class="type-row" data-agent-native-node-id="${id}" data-agent-native-layer-name="${spec}">
            <span class="type-spec">${spec}</span>
            <span style="${style}">${sample}</span>
          </li>`;

const tile = presetDocument({
  title: `${BRAND} — Style tile`,
  width: 1440,
  height: 1200,
  fonts: FONTS,
  palette: PALETTE,
  css: `${BASE_CSS}
      .meta { position:absolute; top:70px; right:64px; z-index:2; color:var(--soft); font-size:15px; font-weight:500; }
      .intro { position:absolute; left:64px; right:64px; top:136px; z-index:2; display:flex; justify-content:space-between; align-items:flex-end; gap:40px; }
      .intro h1 { font-size:64px; line-height:1; }
      .intro ul { display:flex; gap:10px; }
      .section { position:absolute; z-index:2; }
      .section > h2 { margin-bottom:20px; }
      .swatches { display:grid; grid-template-columns:repeat(8, 1fr); gap:16px; }
      .swatch { display:flex; flex-direction:column; padding:10px 10px 16px; border:1px solid var(--line); border-radius:18px; background:var(--surface); }
      .chip { display:block; height:112px; border-radius:10px; box-shadow:inset 0 0 0 1px var(--line); }
      .sw-name { margin:14px 6px 0; font-size:17px; font-weight:600; }
      .swatch code { margin:4px 6px 0; color:var(--soft); font:500 13px/1.3 var(--font-body); }
      .sw-hex { margin:2px 6px 0; color:var(--soft); font-size:13px; font-variant-numeric:tabular-nums; }
      .type-row { display:grid; grid-template-columns:120px 1fr; align-items:baseline; gap:20px; padding:16px 0; border-top:1px solid var(--line); }
      .type-spec { color:var(--soft); font-size:13px; line-height:1.4; }
      .group + .group { margin-top:30px; }
      .group h3 { margin-bottom:12px; color:var(--soft); font-size:14px; font-weight:500; }
      .btn-row { display:flex; flex-wrap:wrap; gap:12px; }
      .btn-row figure { display:flex; flex-direction:column; align-items:flex-start; gap:8px; }
      .btn-row figcaption { color:var(--soft); font-size:12px; }
      .field label { display:block; font-size:15px; font-weight:600; }
      .input { display:flex; align-items:center; height:50px; margin-top:8px; padding:0 16px; border:2px solid var(--accent); border-radius:12px; background:var(--surface); font-size:16px; box-shadow:0 0 0 4px var(--accent-soft); }
      .input i { display:block; width:2px; height:22px; margin-left:2px; background:var(--ink); }
      .field p { margin-top:8px; color:var(--soft); font-size:13px; }
      .tags { display:flex; flex-wrap:wrap; gap:8px; }
      .card { overflow:hidden; border:1px solid var(--line); border-radius:22px; background:var(--surface); box-shadow:0 20px 50px var(--shadow); }
      .footer { position:absolute; left:64px; right:64px; bottom:40px; z-index:2; display:flex; justify-content:space-between; padding-top:18px; border-top:1px solid var(--line); color:var(--soft); font-size:14px; }
  `,
  body: `
      ${background}
      ${logo(26, 64, 64)}
      <p class="meta" data-agent-native-node-id="meta" data-agent-native-layer-name="Version">Style tile · v1.2 · Winter 2026</p>
      <div class="intro" data-agent-native-node-id="intro" data-agent-native-layer-name="Intro">
        <h1 class="display" data-agent-native-node-id="brand-line" data-agent-native-layer-name="Brand line">Brewed slow, poured warm.</h1>
        <ul data-agent-native-node-id="adjectives" data-agent-native-layer-name="Brand adjectives">
          <li class="tag tag-line" style="height:38px;padding:0 16px;font-size:15px">Warm</li>
          <li class="tag tag-line" style="height:38px;padding:0 16px;font-size:15px">Unhurried</li>
          <li class="tag tag-line" style="height:38px;padding:0 16px;font-size:15px">Botanical</li>
        </ul>
      </div>

      <section class="section" style="left:64px;right:64px;top:262px" data-agent-native-node-id="palette" data-agent-native-layer-name="Palette">
        <h2 class="eyebrow">Palette</h2>
        <ul class="swatches">${SWATCHES.map(swatch).join("")}
        </ul>
      </section>

      <section class="section" style="left:64px;width:540px;top:572px" data-agent-native-node-id="type-scale" data-agent-native-layer-name="Type scale">
        <h2 class="eyebrow">Type</h2>
        <ul>
          ${typeRow("Display<br>Young Serif · 56", "Steep slowly.", "font:400 56px/1 var(--font-display);letter-spacing:-.02em", "type-display")}
          ${typeRow("Heading<br>Young Serif · 36", "Winter blends", "font:400 36px/1.1 var(--font-display)", "type-heading")}
          ${typeRow("Title<br>Work Sans · 22", "Ember Hearth Black", "font:600 22px/1.3 var(--font-body)", "type-title")}
          ${typeRow("Body<br>Work Sans · 17", "Smoked over pine, with dried fig and a long, sweet finish.", "font:400 17px/1.55 var(--font-body)", "type-body")}
          ${typeRow("Caption<br>Work Sans · 13", "Small batch · 400 tins", "color:var(--soft);font:600 13px/1.4 var(--font-body);letter-spacing:.1em;text-transform:uppercase", "type-caption")}
        </ul>
      </section>

      <section class="section" style="left:644px;width:350px;top:572px" data-agent-native-node-id="components" data-agent-native-layer-name="Components">
        <h2 class="eyebrow">Components</h2>
        <div class="group" data-agent-native-node-id="buttons" data-agent-native-layer-name="Buttons">
          <h3>Buttons</h3>
          <div class="btn-row">
            <figure><span class="btn btn-primary" style="height:46px;padding:0 20px;font-size:15px">Add to basket</span><figcaption>Default</figcaption></figure>
            <figure><span class="btn btn-hover" style="height:46px;padding:0 20px;font-size:15px">Add to basket</span><figcaption>Hover</figcaption></figure>
            <figure><span class="btn btn-secondary" style="height:46px;padding:0 20px;font-size:15px">View blend</span><figcaption>Secondary</figcaption></figure>
            <figure><span class="btn btn-disabled" style="height:46px;padding:0 20px;font-size:15px">Sold out</span><figcaption>Disabled</figcaption></figure>
          </div>
        </div>
        <div class="group field" data-agent-native-node-id="form-field" data-agent-native-layer-name="Form field">
          <h3>Form field · focused</h3>
          <label>Email for the tasting letter</label>
          <div class="input">nadia.okoro@mail.com<i></i></div>
          <p>One letter a month, with a new blend to try.</p>
        </div>
        <div class="group" data-agent-native-node-id="tags" data-agent-native-layer-name="Tags">
          <h3>Tags</h3>
          <ul class="tags">
            <li class="tag tag-sage" style="height:32px;padding:0 14px;font-size:14px">Black tea</li>
            <li class="tag tag-sage" style="height:32px;padding:0 14px;font-size:14px">Caffeine free</li>
            <li class="tag tag-clay" style="height:32px;padding:0 14px;font-size:14px">Limited batch</li>
            <li class="tag tag-line" style="height:32px;padding:0 14px;font-size:14px">Organic</li>
          </ul>
        </div>
      </section>

      <section class="section" style="left:1028px;right:64px;top:572px" data-agent-native-node-id="samples" data-agent-native-layer-name="Samples">
        <h2 class="eyebrow">Card and texture</h2>
        <article class="card" data-agent-native-node-id="sample-card" data-agent-native-layer-name="Product card">
          <div style="display:grid;place-items:center;height:186px;background:var(--accent-soft)">${tin(112, "--accent", "card-tin")}</div>
          <div style="padding:18px 20px 20px">
            <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="display" style="font-size:22px">Ember Hearth</span><span style="font-size:16px;font-weight:600">$18</span></div>
            <p style="margin-top:4px;color:var(--soft);font-size:14px">Smoked black tea · 80g tin</p>
            <span class="btn btn-primary" style="width:100%;height:42px;margin-top:14px;font-size:14px">Add to basket</span>
          </div>
        </article>
        <div style="margin-top:16px;overflow:hidden;border-radius:18px;height:118px" data-agent-native-node-id="texture-block" data-agent-native-layer-name="Texture block">${texture(348, 118, "tile-texture", 0.8)}</div>
      </section>

      <p class="footer" data-agent-native-node-id="footer" data-agent-native-layer-name="Footer"><span>Every color and font on this tile is a token in :root.</span><span>${BRAND} · Brand system</span></p>`,
});

// ——— Social post ———
const post = presetDocument({
  title: `${BRAND} — Social post`,
  width: 1080,
  height: 1080,
  fonts: FONTS,
  palette: PALETTE,
  css: `${BASE_CSS}
      .kicker { position:absolute; left:80px; top:214px; z-index:2; height:44px; padding:0 20px; font-size:19px; }
      .headline { position:absolute; left:80px; top:290px; width:540px; z-index:2; font-size:90px; line-height:1; }
      .lede { position:absolute; left:80px; top:510px; width:460px; z-index:2; color:var(--soft); font-size:26px; line-height:1.5; text-wrap:pretty; }
      .orb { position:absolute; right:-140px; top:250px; width:640px; height:640px; border-radius:50%; overflow:hidden; z-index:1; }
      .tin { position:absolute; right:130px; top:360px; z-index:2; }
      .price { position:absolute; right:84px; top:330px; z-index:3; display:grid; place-items:center; width:150px; height:150px; border-radius:50%; background:var(--honey); color:var(--ink); text-align:center; transform:rotate(10deg); }
      .bottom { position:absolute; left:80px; right:80px; bottom:80px; z-index:2; display:flex; justify-content:space-between; align-items:center; }
  `,
  body: `
      ${background}
      ${logo(32, 80, 80)}
      <div class="orb" aria-hidden="true" data-agent-native-node-id="orb" data-agent-native-layer-name="Texture circle">${texture(640, 640, "post-texture", 1.4)}</div>
      <div class="tin">${tin(300, "--accent", "post-tin")}</div>
      <div class="price" data-agent-native-node-id="price-badge" data-agent-native-layer-name="Price badge"><div><div class="display" style="font-size:44px;line-height:1">$18</div><div style="margin-top:4px;font-size:14px;font-weight:600">80g tin</div></div></div>
      <p class="tag tag-sage kicker" data-agent-native-node-id="kicker" data-agent-native-layer-name="Kicker">Back for winter</p>
      <h1 class="display headline" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">Smoke, fig and pine.</h1>
      <p class="lede" data-agent-native-node-id="lede" data-agent-native-layer-name="Lede">Ember Hearth, our smoked black tea, returns in a single batch of 400 tins.</p>
      <div class="bottom" data-agent-native-node-id="bottom" data-agent-native-layer-name="Call to action">
        <span class="btn btn-primary" style="height:72px;padding:0 36px;font-size:24px">Order by Dec 12</span>
        <span class="tag tag-clay" style="height:48px;padding:0 22px;font-size:20px">Ember Hearth · Limited batch</span>
      </div>`,
});

// ——— Web banner ———
const banner = presetDocument({
  title: `${BRAND} — Web banner`,
  width: 1200,
  height: 628,
  fonts: FONTS,
  palette: PALETTE,
  css: `${BASE_CSS}
      .copy { position:absolute; left:72px; top:150px; width:520px; z-index:2; }
      .copy h1 { font-size:72px; line-height:1.02; }
      .copy p { margin-top:22px; color:var(--soft); font-size:22px; line-height:1.5; }
      .copy .btn { margin-top:34px; height:60px; padding:0 30px; font-size:19px; }
      .panel { position:absolute; left:660px; top:0; width:540px; height:628px; z-index:1; overflow:hidden; }
      .tins { position:absolute; left:700px; bottom:92px; z-index:2; display:flex; align-items:flex-end; gap:16px; }
      .box { position:absolute; left:700px; right:40px; bottom:64px; height:30px; z-index:1; border-radius:8px; background:var(--ink); }
  `,
  body: `
      ${background}
      ${logo(26, 60, 72)}
      <div class="panel" aria-hidden="true" data-agent-native-node-id="panel" data-agent-native-layer-name="Texture panel">${texture(540, 628, "banner-texture", 1.1)}</div>
      <div class="copy" data-agent-native-node-id="banner-copy" data-agent-native-layer-name="Copy">
        <h1 class="display" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">Winter blends, steeped slow.</h1>
        <p data-agent-native-node-id="lede" data-agent-native-layer-name="Lede">Three small-batch teas for long evenings, boxed and ready to give.</p>
        <span class="btn btn-primary" data-agent-native-node-id="cta" data-agent-native-layer-name="Button">Shop the winter box</span>
      </div>
      <div class="box" aria-hidden="true"></div>
      <div class="tins" data-agent-native-node-id="tins" data-agent-native-layer-name="Tins">
        ${tin(140, "--sage", "tin-sage")}
        ${tin(176, "--accent", "tin-accent")}
        ${tin(140, "--honey", "tin-honey")}
      </div>`,
});

const guide = guideFrame({
  title: "How this style tile works",
  documentTitle: `${BRAND} — How this style tile works`,
  intro:
    "Every color and font in these frames reads from the tokens in :root, so one change carries everywhere.",
  steps: [
    {
      title: "Change a token",
      body: "Swatch chips, buttons, the post and the banner all follow. Hex labels are plain text, so ask for those too.",
      prompt:
        "Change --accent to a deep teal in every frame and update the Kiln swatch's hex label.",
    },
    {
      title: "Swap the type",
      body: "The display and body fonts are tokens too, loaded from Google Fonts.",
      prompt:
        "Use Fraunces for --font-display in every frame and update the font link to load it.",
    },
    {
      title: "Add a format",
      body: "New frames can reuse the same tokens, tin and leaf texture.",
      prompt: "Add a 1080×1920 story that matches the social post.",
    },
  ],
  logo: logo(20, 52, 96),
  fonts: FONTS,
  palette: PALETTE,
  displayFont: "var(--font-display)",
  bodyFont: "var(--font-body)",
  height: 660,
});

export const styleTile: DesignTemplatePreset = {
  id: "preset-style-tile",
  title: "Brand style tile",
  description:
    "A 1440 × 1200 style tile with palette, type, buttons, form, card and texture, plus a social post and web banner that share its tokens.",
  category: "other",
  width: 1440,
  height: 1200,
  filename: "style-tile.html",
  content: tile,
  frames: [
    {
      key: "post",
      filename: "social-post.html",
      x: 1560,
      y: 0,
      width: 1080,
      height: 1080,
      content: post,
    },
    {
      key: "banner",
      filename: "web-banner.html",
      x: 2760,
      y: 0,
      width: 1200,
      height: 628,
      content: banner,
    },
    {
      key: "guide",
      filename: "how-this-style-tile-works.html",
      x: 0,
      y: 1440,
      width: 1440,
      height: 660,
      content: guide,
    },
  ],
};
