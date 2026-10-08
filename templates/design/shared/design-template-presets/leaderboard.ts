import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";

const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#F3F1EC",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#111111",
  // guard:allow-raw-color — authored template palette, not app chrome.
  red: "#E2231A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  white: "#FFFFFF",
};

export const leaderboard: DesignTemplatePreset = {
  id: "preset-leaderboard",
  title: "Leaderboard banner",
  description:
    "A 970 × 250 Swiss-style banner: red, black, and white on a strict grid with oversized numerals.",
  category: "ad",
  width: 970,
  height: 250,
  filename: "leaderboard-banner.html",
  content: presetDocument({
    title: "Linea Nord — Zürich to Milano",
    width: 970,
    height: 250,
    fonts:
      "family=Archivo:wght@500;700;800;900&family=Barlow+Condensed:wght@800",
    palette: {
      canvas: C.paper,
      paper: C.paper,
      ink: C.ink,
      red: C.red,
      white: C.white,
    },
    css: `
      .artboard { color:var(--ink); font-family:'Archivo', sans-serif; }
      .time-panel { position:absolute; left:0; top:0; width:476px; height:250px; z-index:1; background:var(--red); color:var(--white); overflow:hidden; }
      .time-panel strong { position:absolute; left:18px; bottom:-36px; font-family:'Barlow Condensed', sans-serif; font-size:258px; font-weight:800; line-height:1; letter-spacing:-.03em; }
      .time-panel span { position:absolute; left:24px; top:22px; font-size:13px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
      .rules { position:absolute; left:500px; right:24px; top:0; bottom:0; z-index:1; }
      .rules i { position:absolute; left:0; right:0; height:2px; background:var(--ink); }
      .route { position:absolute; left:500px; top:76px; z-index:2; display:flex; align-items:center; gap:14px; font-size:40px; font-weight:800; line-height:1; letter-spacing:-.035em; }
      .route svg { width:46px; height:22px; }
      .cadence { position:absolute; left:500px; top:134px; z-index:2; font-size:15px; font-weight:500; letter-spacing:-.005em; }
      .fare { position:absolute; left:500px; bottom:22px; z-index:2; display:flex; align-items:baseline; gap:8px; }
      .fare small { font-size:13px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
      .fare strong { font-family:'Barlow Condensed', sans-serif; font-size:46px; font-weight:800; line-height:1; letter-spacing:-.01em; }
      .book { position:absolute; right:24px; bottom:22px; z-index:2; display:flex; align-items:center; justify-content:space-between; width:196px; height:56px; padding:0 18px; background:var(--ink); color:var(--white); font-size:16px; font-weight:800; letter-spacing:.02em; text-decoration:none; }
      .book svg { width:20px; height:20px; }
    `,
    body: `
      <div style="position:absolute;inset:0;background:${C.paper}" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <div class="time-panel" data-agent-native-node-id="travel-time" data-agent-native-layer-name="Travel time">
        <span>Door to door</span>
        <strong>3h12</strong>
      </div>
      <div class="rules" aria-hidden="true" data-agent-native-node-id="grid-rules" data-agent-native-layer-name="Grid rules"><i style="top:60px"></i><i style="top:170px"></i></div>
      <div style="position:absolute;top:22px;left:500px;z-index:2;display:flex;align-items:center;gap:10px;color:${C.ink};font:900 17px/1 'Archivo',sans-serif;letter-spacing:.02em;text-transform:uppercase" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><rect width="20" height="20" fill="${C.red}"/><rect x="4" y="9" width="12" height="2" fill="${C.white}"/></svg>
        <span>Linea Nord</span>
      </div>
      <p class="route" data-agent-native-node-id="route" data-agent-native-layer-name="Route">Zürich <svg viewBox="0 0 46 22" aria-hidden="true"><path d="M0 11h42M33 2l9 9-9 9" fill="none" stroke="${C.red}" stroke-width="3.5"/></svg> Milano</p>
      <p class="cadence" data-agent-native-node-id="cadence" data-agent-native-layer-name="Cadence">Direct every hour. Wi-Fi and a window seat included.</p>
      <p class="fare" data-agent-native-node-id="fare" data-agent-native-layer-name="Fare"><small>From CHF</small><strong>39.–</strong></p>
      <a class="book" href="#" data-agent-native-node-id="cta" data-agent-native-layer-name="CTA">Book a seat <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h13M11 5l5 5-5 5" fill="none" stroke="${C.white}" stroke-width="2.4"/></svg></a>`,
  }),
};
