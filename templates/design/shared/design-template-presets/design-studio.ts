import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";

const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  canvas: "#ECE8EF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#FFFFFF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#241F31",
  // guard:allow-raw-color — authored template palette, not app chrome.
  muted: "#7A748A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  line: "#DAD4E2",
  // guard:allow-raw-color — authored template palette, not app chrome.
  pink: "#E8447A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  violet: "#7A5CF0",
  // guard:allow-raw-color — authored template palette, not app chrome.
  teal: "#27B5A6",
  // guard:allow-raw-color — authored template palette, not app chrome.
  amber: "#F2A33A",
};

const swatches = [C.pink, C.violet, C.teal, C.amber, C.ink, C.line]
  .map((color) => `<i style="background:${color}"></i>`)
  .join("");

export const designStudio: DesignTemplatePreset = {
  id: "preset-design-studio",
  title: "Design studio",
  description: "Create and explore visual ideas.",
  category: "other",
  width: 1440,
  height: 900,
  filename: "design-studio.html",
  content: presetDocument({
    title: "Atelier — Design studio",
    width: 1440,
    height: 900,
    fonts: "family=Space+Grotesk:wght@400;500;700",
    palette: {
      canvas: C.canvas,
      paper: C.paper,
      ink: C.ink,
      muted: C.muted,
      line: C.line,
      pink: C.pink,
      violet: C.violet,
      teal: C.teal,
      amber: C.amber,
    },
    css: `
      .artboard { color:var(--ink); font-family:'Space Grotesk', sans-serif; }
      .toolbar { position:absolute; left:24px; top:96px; z-index:1; display:grid; gap:12px; padding:12px; border-radius:18px; background:var(--paper); border:1px solid var(--line); }
      .toolbar i { display:block; width:44px; height:44px; border-radius:12px; background:var(--canvas); }
      .toolbar i:first-child { background:var(--pink); }
      .menubar { position:absolute; left:96px; right:24px; top:24px; z-index:1; display:flex; align-items:center; gap:28px; height:48px; padding:0 24px; border-radius:14px; background:var(--paper); border:1px solid var(--line); color:var(--muted); font-size:15px; font-weight:500; }
      .menubar b { margin-left:auto; padding:8px 16px; border-radius:999px; background:var(--ink); color:var(--paper); font-size:14px; font-weight:700; }
      .stage { position:absolute; left:96px; top:96px; right:376px; bottom:24px; z-index:1; border-radius:24px; background:var(--paper); border:1px solid var(--line); overflow:hidden; }
      .shape { position:absolute; }
      .tri { left:210px; top:150px; width:0; height:0; border-left:200px solid transparent; border-right:200px solid transparent; border-bottom:350px solid var(--pink); }
      .blob { left:450px; top:130px; width:340px; height:300px; border-radius:58% 42% 55% 45% / 48% 58% 42% 52%; background:var(--violet); opacity:.82; }
      .circle { left:380px; top:360px; width:240px; height:240px; border-radius:50%; background:var(--teal); opacity:.78; }
      .square { left:640px; top:380px; width:210px; height:210px; border-radius:36px; background:var(--amber); transform:rotate(12deg); opacity:.9; }
      .panel { position:absolute; right:24px; top:96px; bottom:24px; width:328px; z-index:1; padding:26px; border-radius:24px; background:var(--paper); border:1px solid var(--line); }
      .panel h2 { color:var(--muted); font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
      .swatches { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-top:16px; }
      .swatches i { display:block; aspect-ratio:1; border-radius:50%; }
      .sliders { display:grid; gap:26px; margin-top:34px; }
      .sliders p { display:flex; justify-content:space-between; color:var(--muted); font-size:14px; font-weight:500; }
      .sliders em { font-style:normal; }
      .sliders > div > span { display:block; height:6px; margin-top:12px; border-radius:3px; background:var(--line); }
      .sliders > div > span b { display:block; height:100%; border-radius:3px; background:var(--violet); }
    `,
    body: `
      <div style="position:absolute;inset:0;background:${C.canvas}" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <div style="position:absolute;left:24px;top:30px;z-index:2;display:flex;align-items:center;gap:8px;color:${C.ink};font:700 22px/1 'Space Grotesk',sans-serif;letter-spacing:-.03em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><rect width="30" height="30" rx="9" fill="${C.ink}"/><path d="M15 7l8 15H7z" fill="${C.pink}"/></svg>
      </div>
      <header class="menubar" data-agent-native-node-id="menubar" data-agent-native-layer-name="Menu bar">
        <span>File</span><span>Edit</span><span>View</span><span>Arrange</span><b>Share</b>
      </header>
      <nav class="toolbar" data-agent-native-node-id="toolbar" data-agent-native-layer-name="Toolbar"><i></i><i></i><i></i><i></i><i></i></nav>
      <section class="stage" data-agent-native-node-id="stage" data-agent-native-layer-name="Canvas">
        <div class="shape tri"></div><div class="shape blob"></div><div class="shape circle"></div><div class="shape square"></div>
      </section>
      <aside class="panel" data-agent-native-node-id="inspector" data-agent-native-layer-name="Inspector">
        <h2>Palette</h2>
        <div class="swatches">${swatches}</div>
        <div class="sliders">
          <div><p><em>Opacity</em><em>82%</em></p><span><b style="width:82%"></b></span></div>
          <div><p><em>Blur</em><em>24</em></p><span><b style="width:36%"></b></span></div>
          <div><p><em>Rotation</em><em>12°</em></p><span><b style="width:14%"></b></span></div>
        </div>
      </aside>`,
  }),
};
