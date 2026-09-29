import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";

const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  night: "#0C0B09",
  // guard:allow-raw-color — authored template palette, not app chrome.
  nightLift: "#1A1712",
  // guard:allow-raw-color — authored template palette, not app chrome.
  champagne: "#DCC9A3",
  // guard:allow-raw-color — authored template palette, not app chrome.
  champagneLight: "#F3E8CF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  champagneDeep: "#9A8157",
  // guard:allow-raw-color — authored template palette, not app chrome.
  amber: "#B98C4B",
  // guard:allow-raw-color — authored template palette, not app chrome.
  muted: "#A69A84",
  // guard:allow-raw-color — authored template palette, not app chrome.
  hairline: "rgba(220, 201, 163, 0.42)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  glow: "rgba(220, 201, 163, 0.24)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  sheen: "rgba(255, 255, 255, 0.22)",
};

const bottle = `<svg class="bottle" viewBox="0 0 240 420" aria-hidden="true">
          <defs>
            <linearGradient id="vesper-cap" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${C.champagneDeep}"/><stop offset=".45" stop-color="${C.champagneLight}"/><stop offset="1" stop-color="${C.champagneDeep}"/></linearGradient>
            <linearGradient id="vesper-glass" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${C.nightLift}"/><stop offset="1" stop-color="${C.night}"/></linearGradient>
            <linearGradient id="vesper-liquid" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${C.champagne}"/><stop offset="1" stop-color="${C.amber}"/></linearGradient>
          </defs>
          <ellipse cx="120" cy="408" rx="110" ry="9" fill="${C.glow}"/>
          <rect x="88" y="0" width="64" height="74" rx="3" fill="url(#vesper-cap)"/>
          <rect x="76" y="74" width="88" height="12" fill="${C.champagneDeep}"/>
          <rect x="102" y="86" width="36" height="22" fill="${C.nightLift}" stroke="${C.hairline}"/>
          <rect x="18" y="106" width="204" height="298" rx="26" fill="url(#vesper-glass)" stroke="${C.hairline}" stroke-width="1.5"/>
          <rect x="30" y="150" width="180" height="242" rx="18" fill="url(#vesper-liquid)" opacity=".92"/>
          <rect x="40" y="122" width="9" height="262" rx="4.5" fill="${C.sheen}"/>
          <rect x="66" y="222" width="108" height="92" fill="${C.night}" stroke="${C.champagne}" stroke-width="1"/>
          <text x="120" y="258" text-anchor="middle" fill="${C.champagne}" font-family="Jost, sans-serif" font-size="13" letter-spacing="5">VESPER</text>
          <text x="120" y="292" text-anchor="middle" fill="${C.champagneLight}" font-family="Cormorant Garamond, serif" font-style="italic" font-size="26">N° 7</text>
        </svg>`;

export const displayLuxury: DesignTemplatePreset = {
  id: "preset-display-luxury",
  title: "Luxury display ad",
  description:
    "A 1200 × 628 quiet-luxury ad: black and champagne, italic serif, hairline frame, drawn product.",
  category: "ad",
  width: 1200,
  height: 628,
  filename: "luxury-display-ad.html",
  content: presetDocument({
    title: "Maison Vesper — No. 7",
    width: 1200,
    height: 628,
    fonts:
      "family=Cormorant+Garamond:ital,wght@1,300;1,400&family=Jost:wght@400;500",
    palette: {
      canvas: C.night,
      night: C.night,
      champagne: C.champagne,
      "champagne-light": C.champagneLight,
      muted: C.muted,
      hairline: C.hairline,
      glow: C.glow,
    },
    css: `
      .artboard { color:var(--champagne-light); font-family:'Jost', sans-serif; }
      .frame { position:absolute; inset:24px; z-index:1; border:1px solid var(--hairline); pointer-events:none; }
      .copy { position:absolute; left:96px; top:132px; z-index:2; width:560px; }
      .copy h1 { font:300 88px/.94 'Cormorant Garamond', serif; font-style:italic; letter-spacing:-.02em; }
      .copy h1 span { display:block; color:var(--champagne); }
      .copy p { margin-top:30px; color:var(--muted); font-size:14px; font-weight:400; letter-spacing:.3em; text-transform:uppercase; }
      .discover { position:absolute; left:96px; bottom:84px; z-index:2; display:inline-flex; align-items:center; gap:18px; padding-bottom:10px; border-bottom:1px solid var(--champagne); color:var(--champagne-light); font-size:14px; font-weight:500; letter-spacing:.3em; text-transform:uppercase; text-decoration:none; }
      .discover svg { width:44px; height:10px; }
      .stage { position:absolute; left:720px; top:0; width:400px; height:628px; z-index:2; }
      .halo { position:absolute; left:40px; top:96px; width:320px; height:320px; border-radius:50%; background:var(--glow); filter:blur(60px); }
      .bottle { position:absolute; left:92px; top:92px; width:216px; height:378px; }
      .notes { position:absolute; right:64px; bottom:60px; z-index:2; color:var(--muted); font:400 italic 20px/1.3 'Cormorant Garamond', serif; text-align:right; }
    `,
    body: `
      <div style="position:absolute;inset:0;background:radial-gradient(circle at 76% 44%, ${C.nightLift} 0%, ${C.night} 62%)" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <div class="frame" aria-hidden="true" data-agent-native-node-id="hairline-frame" data-agent-native-layer-name="Hairline frame"></div>
      <div style="position:absolute;top:64px;left:96px;z-index:3;display:flex;align-items:center;gap:14px;color:${C.champagne};font:500 13px/1 'Jost',sans-serif;letter-spacing:.46em;text-transform:uppercase" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 1 L17 9 L9 17 L1 9 Z" fill="none" stroke="${C.champagne}" stroke-width="1"/><circle cx="9" cy="9" r="2" fill="${C.champagne}"/></svg>
        <span>Maison Vesper</span>
      </div>
      <section class="copy" data-agent-native-node-id="copy" data-agent-native-layer-name="Copy">
        <h1>The hour <br />after dusk, <span>bottled.</span></h1>
        <p>Vesper No. 7 · Eau de parfum</p>
      </section>
      <a class="discover" href="#" data-agent-native-node-id="cta" data-agent-native-layer-name="CTA">Discover the scent <svg viewBox="0 0 44 10" aria-hidden="true"><path d="M0 5h42M37 1l5 4-5 4" fill="none" stroke="${C.champagne}" stroke-width="1"/></svg></a>
      <div class="stage" aria-hidden="true" data-agent-native-node-id="product" data-agent-native-layer-name="Product">
        <div class="halo"></div>
        ${bottle}
      </div>
      <p class="notes" data-agent-native-node-id="notes" data-agent-native-layer-name="Notes">Fig leaf, vetiver,<br />smoked amber</p>`,
  }),
};
