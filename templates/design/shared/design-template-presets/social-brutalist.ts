import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";

const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  lime: "#D2FF3C",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#0D0D0C",
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#FBFAF3",
  // guard:allow-raw-color — authored template palette, not app chrome.
  tomato: "#FF5A2E",
};

const star = (cls: string) =>
  `<svg class="${cls}" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 0 L24 14 L38 10 L27 20 L38 30 L24 26 L20 40 L16 26 L2 30 L13 20 L2 10 L16 14 Z" fill="${C.lime}"/></svg>`;

const marqueeRun = Array.from(
  { length: 4 },
  () =>
    `<span>48 hours only</span>${star("marquee-star")}<span>no restocks</span>${star("marquee-star")}`,
).join("");

export const socialBrutalist: DesignTemplatePreset = {
  id: "preset-social-brutalist",
  title: "Flash sale post — square",
  description:
    "Neo-brutalist 1080 × 1080 flash-sale post: acid lime, heavy condensed type, sticker badges.",
  category: "social",
  width: 1080,
  height: 1080,
  filename: "flash-sale-square.html",
  content: presetDocument({
    title: "Grit Supply — Flash sale",
    width: 1080,
    height: 1080,
    fonts: "family=Anton&family=Archivo:wght@700;900&family=DM+Mono:wght@500",
    palette: {
      canvas: C.lime,
      lime: C.lime,
      ink: C.ink,
      paper: C.paper,
      tomato: C.tomato,
    },
    css: `
      .artboard { color:var(--ink); font-family:'Archivo', sans-serif; }
      .drop-sticker { position:absolute; top:52px; right:60px; z-index:3; width:156px; height:156px; display:grid; place-content:center; border:6px solid var(--ink); border-radius:50%; background:var(--paper); text-align:center; transform:rotate(12deg); box-shadow:8px 8px 0 var(--ink); }
      .drop-sticker span { display:block; font:500 15px/1 'DM Mono', monospace; letter-spacing:.14em; text-transform:uppercase; }
      .drop-sticker strong { display:block; margin-top:4px; font:400 64px/.9 'Anton', sans-serif; }
      .headline { position:absolute; left:48px; top:146px; z-index:2; font:400 312px/.86 'Anton', sans-serif; letter-spacing:-.01em; text-transform:uppercase; }
      .headline span { display:block; }
      .burst { position:absolute; left:604px; top:372px; z-index:3; width:420px; height:420px; transform:rotate(-9deg); }
      .burst svg { position:absolute; inset:0; width:100%; height:100%; }
      .burst-label { position:absolute; inset:0; display:grid; place-content:center; text-align:center; }
      .burst-label strong { display:block; font:400 100px/.85 'Anton', sans-serif; letter-spacing:-.02em; }
      .burst-label span { display:block; margin-top:6px; font:900 22px/1 'Archivo', sans-serif; letter-spacing:.12em; text-transform:uppercase; }
      .offer-card { position:absolute; left:56px; top:700px; z-index:2; width:560px; padding:28px 30px 30px; border:6px solid var(--ink); background:var(--paper); box-shadow:14px 14px 0 var(--ink); }
      .offer-card p { font:700 31px/1.12 'Archivo', sans-serif; letter-spacing:-.02em; }
      .offer-code { display:flex; align-items:center; justify-content:space-between; margin-top:22px; padding:14px 18px; border:3px dashed var(--ink); font:500 20px/1 'DM Mono', monospace; letter-spacing:.08em; text-transform:uppercase; }
      .offer-code strong { font:400 34px/1 'Anton', sans-serif; letter-spacing:.04em; }
      .when { position:absolute; right:60px; top:822px; z-index:2; width:330px; text-align:right; }
      .when time { display:block; font:500 19px/1.5 'DM Mono', monospace; letter-spacing:.06em; text-transform:uppercase; }
      .shop { display:inline-flex; align-items:center; gap:14px; margin-top:14px; padding:16px 24px; border:0; border-radius:999px; background:var(--ink); color:var(--lime); font:900 22px/1 'Archivo', sans-serif; letter-spacing:.04em; text-transform:uppercase; text-decoration:none; }
      .shop svg { width:26px; height:26px; }
      .marquee { position:absolute; left:-40px; right:-40px; bottom:26px; z-index:1; display:flex; align-items:center; gap:22px; height:74px; padding-left:40px; background:var(--ink); color:var(--lime); transform:rotate(-2.2deg); white-space:nowrap; }
      .marquee span { font:400 38px/1 'Anton', sans-serif; letter-spacing:.04em; text-transform:uppercase; }
      .marquee-star { flex:none; width:30px; height:30px; }
    `,
    body: `
      <div style="position:absolute;inset:0;background:${C.lime}" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <div style="position:absolute;top:56px;left:56px;z-index:4;display:flex;align-items:center;gap:12px;padding:12px 18px 12px 12px;background:${C.ink};color:${C.lime};font:900 22px/1 'Archivo',sans-serif;letter-spacing:.06em;text-transform:uppercase" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><rect x="0" y="0" width="30" height="30" fill="${C.lime}"/><rect x="7" y="7" width="16" height="16" fill="${C.ink}"/><rect x="15" y="15" width="8" height="8" fill="${C.lime}"/></svg>
        <span>Grit Supply</span>
      </div>
      <div class="drop-sticker" data-agent-native-node-id="drop-sticker" data-agent-native-layer-name="Drop sticker"><span>Drop</span><strong>07</strong></div>
      <h1 class="headline" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline"><span>Flash</span><span>Sale</span></h1>
      <div class="burst" data-agent-native-node-id="discount-burst" data-agent-native-layer-name="Discount burst">
        <svg viewBox="0 0 200 200" aria-hidden="true"><path d="M100 4 L117 38 L152 20 L152 59 L191 62 L169 95 L196 124 L158 136 L165 175 L128 166 L113 200 L90 172 L58 194 L50 156 L12 150 L32 117 L4 90 L40 72 L32 34 L70 40 Z" fill="${C.tomato}" stroke="${C.ink}" stroke-width="5" stroke-linejoin="round"/></svg>
        <div class="burst-label"><strong>-40%</strong><span>Everything</span></div>
      </div>
      <section class="offer-card" data-agent-native-node-id="offer-card" data-agent-native-layer-name="Offer card">
        <p>The whole archive, two days, zero restocks. When it’s gone, it’s gone.</p>
        <div class="offer-code"><span>Use code</span><strong>GRIT40</strong></div>
      </section>
      <div class="when" data-agent-native-node-id="offer-dates" data-agent-native-layer-name="Dates and CTA">
        <time>Fri 09.10 — Sun 11.10</time>
        <a class="shop" href="#">Shop the drop <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" fill="none" stroke="${C.lime}" stroke-width="3" stroke-linecap="square"/></svg></a>
      </div>
      <div class="marquee" aria-hidden="true" data-agent-native-node-id="marquee" data-agent-native-layer-name="Marquee band">${marqueeRun}</div>`,
  }),
};
