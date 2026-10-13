import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";

const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  cream: "#F7E8C9",
  // guard:allow-raw-color — authored template palette, not app chrome.
  mustard: "#E4A42A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  orange: "#E2742C",
  // guard:allow-raw-color — authored template palette, not app chrome.
  rust: "#B9472A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  brown: "#4A2818",
  // guard:allow-raw-color — authored template palette, not app chrome.
  brownSoft: "#7A5238",
};

const wave = (cls: string, color: string) =>
  `<svg class="${cls}" viewBox="0 0 696 16" preserveAspectRatio="none" aria-hidden="true"><path d="M0 8 Q 14.5 0 29 8 T 58 8 T 87 8 T 116 8 T 145 8 T 174 8 T 203 8 T 232 8 T 261 8 T 290 8 T 319 8 T 348 8 T 377 8 T 406 8 T 435 8 T 464 8 T 493 8 T 522 8 T 551 8 T 580 8 T 609 8 T 638 8 T 667 8 T 696 8" fill="none" stroke="${color}" stroke-width="3"/></svg>`;

const item = (name: string, price: string, note: string) =>
  `<li><p class="item-line"><span class="item-name">${name}</span><span class="leader" aria-hidden="true"></span><span class="price">${price}</span></p><p class="note">${note}</p></li>`;

export const menuCard: DesignTemplatePreset = {
  id: "preset-menu-card",
  title: "Diner menu card",
  description:
    "An 816 × 1056 retro 70s menu: mustard, rust, and cream, a sunrise motif, fat display type, wavy dividers.",
  category: "other",
  width: 816,
  height: 1056,
  filename: "menu-card.html",
  content: presetDocument({
    title: "Marigold Diner — Breakfast menu",
    width: 816,
    height: 1056,
    fonts: "family=Shrikhand&family=Karla:ital,wght@0,600;0,800;1,400",
    palette: {
      canvas: C.cream,
      cream: C.cream,
      mustard: C.mustard,
      orange: C.orange,
      rust: C.rust,
      brown: C.brown,
      "brown-soft": C.brownSoft,
    },
    css: `
      .artboard { color:var(--brown); font-family:'Karla', sans-serif; }
      .sunrise { position:absolute; left:208px; top:0; width:400px; height:200px; z-index:1; }
      .tagline { position:absolute; left:0; right:0; top:318px; z-index:2; color:var(--rust); font-size:14px; font-weight:800; letter-spacing:.32em; text-align:center; text-transform:uppercase; }
      .wave-top { position:absolute; left:60px; top:352px; width:696px; height:16px; }
      .menu { position:absolute; left:60px; right:60px; top:392px; z-index:2; display:grid; grid-template-columns:1fr 1fr; gap:48px; }
      .menu h2 { margin-bottom:14px; color:var(--rust); font:400 34px/1 'Shrikhand', serif; }
      .menu li + li { margin-top:16px; }
      .item-line { display:flex; align-items:baseline; gap:8px; }
      .item-name { font-size:16px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
      .leader { flex:1; border-bottom:2px dotted var(--brown-soft); transform:translateY(-4px); }
      .price { font:400 22px/1 'Shrikhand', serif; color:var(--rust); }
      .note { margin-top:4px; color:var(--brown-soft); font-size:14.5px; font-style:italic; line-height:1.35; }
      .sides { position:absolute; left:60px; right:60px; top:790px; z-index:2; display:flex; justify-content:center; gap:14px; flex-wrap:wrap; }
      .sides li { padding:8px 16px; border:2px solid var(--brown); border-radius:999px; font-size:14px; font-weight:600; }
      .sides b { margin-left:6px; color:var(--rust); font-family:'Shrikhand', serif; font-weight:400; }
      .band { position:absolute; left:0; right:0; bottom:0; height:176px; z-index:1; }
      .band svg { position:absolute; left:0; top:0; width:816px; height:40px; }
      .band-fill { position:absolute; left:0; right:0; top:38px; bottom:0; background:var(--mustard); }
      .coffee { position:absolute; left:0; right:0; bottom:74px; z-index:2; font:400 36px/1 'Shrikhand', serif; text-align:center; }
      .coffee span { color:var(--cream); }
      .address { position:absolute; left:0; right:0; bottom:36px; z-index:2; font-size:14px; font-weight:800; letter-spacing:.24em; text-align:center; text-transform:uppercase; }
    `,
    body: `
      <div style="position:absolute;inset:0;background:${C.cream}" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <svg class="sunrise" viewBox="0 0 400 200" aria-hidden="true" data-agent-native-node-id="sunrise" data-agent-native-layer-name="Sunrise">
        <path d="M0 200 A200 200 0 0 1 400 200 Z" fill="${C.rust}"/>
        <path d="M36 200 A164 164 0 0 1 364 200 Z" fill="${C.orange}"/>
        <path d="M72 200 A128 128 0 0 1 328 200 Z" fill="${C.mustard}"/>
        <path d="M108 200 A92 92 0 0 1 292 200 Z" fill="${C.cream}"/>
      </svg>
      <div style="position:absolute;left:0;right:0;top:176px;z-index:2;display:flex;justify-content:center;color:${C.brown};font:400 104px/1.1 'Shrikhand',serif;letter-spacing:-.01em;text-align:center" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <span>Marigold</span>
      </div>
      <p class="tagline" data-agent-native-node-id="tagline" data-agent-native-layer-name="Tagline">Diner · Breakfast all day · Since 1974</p>
      ${wave("wave-top", C.rust)}
      <section class="menu" data-agent-native-node-id="menu" data-agent-native-layer-name="Menu">
        <div>
          <h2>Off the griddle</h2>
          <ul>
            ${item("Buttermilk stack", "9", "Three tall pancakes, whipped honey butter, warm maple.")}
            ${item("Sunrise waffle", "10", "Malted waffle, stewed peaches, a cloud of cream.")}
            ${item("French toast royale", "11", "Thick brioche, cinnamon custard, toasted pecans.")}
            ${item("Silver dollars", "7", "For the little ones, or the merely peckish.")}
          </ul>
        </div>
        <div>
          <h2>Big plates</h2>
          <ul>
            ${item("The Marigold", "13", "Two eggs your way, hash browns, toast, bacon or links.")}
            ${item("Huevos rancheros", "12", "Crisp tortillas, black beans, salsa roja, cotija.")}
            ${item("Garden omelette", "12", "Spinach, mushroom, sharp cheddar, rye toast.")}
            ${item("Patty melt", "14", "Griddled onions, swiss, marble rye, a pickle spear.")}
          </ul>
        </div>
      </section>
      <ul class="sides" data-agent-native-node-id="sides" data-agent-native-layer-name="Sides">
        <li>Hash browns <b>4</b></li><li>Biscuit &amp; gravy <b>6</b></li><li>Fresh OJ <b>4</b></li><li>Malted shake <b>7</b></li>
      </ul>
      <div class="band" aria-hidden="true" data-agent-native-node-id="coffee-band" data-agent-native-layer-name="Coffee band">
        <svg viewBox="0 0 816 40" preserveAspectRatio="none"><path d="M0 40 L0 20 Q 34 0 68 20 T 136 20 T 204 20 T 272 20 T 340 20 T 408 20 T 476 20 T 544 20 T 612 20 T 680 20 T 748 20 T 816 20 L816 40 Z" fill="${C.mustard}"/></svg>
        <div class="band-fill"></div>
      </div>
      <p class="coffee" data-agent-native-node-id="coffee-line" data-agent-native-layer-name="Coffee line">Bottomless coffee <span>3</span></p>
      <p class="address" data-agent-native-node-id="address" data-agent-native-layer-name="Address">412 Ocean Avenue · Open 7 till 3</p>`,
  }),
};
