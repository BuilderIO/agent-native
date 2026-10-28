import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";

const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  void: "#06060A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  planet: "#08080E",
  // guard:allow-raw-color — authored template palette, not app chrome.
  text: "#F3F1FF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  muted: "#8F8CA8",
  // guard:allow-raw-color — authored template palette, not app chrome.
  indigo: "#4C5BFF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  violet: "#A35CFF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  core: "#FFE6CC",
  // guard:allow-raw-color — authored template palette, not app chrome.
  rim: "rgba(255, 244, 232, 0.9)",
  // guard:allow-raw-color — authored template palette, not app chrome.
  haze: "rgba(110, 124, 255, 0.55)",
};

export const keynoteTitle: DesignTemplatePreset = {
  id: "preset-keynote-title",
  title: "Keynote title slide",
  description:
    "A 1920 × 1080 cinematic title slide: near-black stage, luminous horizon, oversized type.",
  category: "presentation",
  width: 1920,
  height: 1080,
  filename: "keynote-title.html",
  content: presetDocument({
    title: "Parallax — Keynote 2027",
    width: 1920,
    height: 1080,
    fonts: "family=Bricolage+Grotesque:opsz,wght@12..96,300..800",
    palette: {
      canvas: C.void,
      text: C.text,
      muted: C.muted,
      indigo: C.indigo,
      violet: C.violet,
      core: C.core,
      rim: C.rim,
      haze: C.haze,
      planet: C.planet,
    },
    css: `
      .artboard { color:var(--text); font-family:'Bricolage Grotesque', sans-serif; }
      .light { position:absolute; inset:0; z-index:1; pointer-events:none; }
      .light .bloom { position:absolute; left:210px; top:510px; width:1500px; height:340px; border-radius:50%; background:var(--indigo); opacity:.6; filter:blur(120px); }
      .light .bloom-violet { position:absolute; left:1080px; top:570px; width:640px; height:220px; border-radius:50%; background:var(--violet); opacity:.55; filter:blur(100px); }
      .light .core { position:absolute; left:460px; top:680px; width:1000px; height:120px; border-radius:50%; background:var(--core); opacity:.7; filter:blur(56px); }
      .light .planet { position:absolute; left:-1640px; top:750px; width:5200px; height:5200px; border-radius:50%; background:var(--planet); border:2px solid var(--rim); box-shadow:0 -12px 60px var(--haze); }
      .event { position:absolute; top:84px; right:112px; z-index:3; color:var(--muted); font-size:24px; font-weight:400; letter-spacing:.01em; }
      .title { position:absolute; left:104px; right:104px; top:214px; z-index:2; font-size:236px; font-weight:800; line-height:.88; letter-spacing:-.05em; }
      .title span { display:block; color:var(--muted); font-weight:300; letter-spacing:-.035em; }
      .byline { position:absolute; left:112px; right:112px; bottom:76px; z-index:3; display:flex; justify-content:space-between; align-items:end; font-size:26px; letter-spacing:.005em; }
      .byline strong { display:block; font-weight:600; }
      .byline span { color:var(--muted); }
      .byline p:last-child { text-align:right; }
    `,
    body: `
      <div style="position:absolute;inset:0;background:${C.void}" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <div class="light" aria-hidden="true" data-agent-native-node-id="horizon-light" data-agent-native-layer-name="Horizon light">
        <div class="bloom"></div>
        <div class="bloom-violet"></div>
        <div class="core"></div>
        <div class="planet"></div>
      </div>
      <div style="position:absolute;top:76px;left:112px;z-index:3;display:flex;align-items:center;gap:16px;color:${C.text};font:600 34px/1 'Bricolage Grotesque',sans-serif;letter-spacing:-.02em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="44" height="36" viewBox="0 0 44 36" aria-hidden="true"><path d="M10 0 H30 L20 36 H0 Z" fill="${C.text}"/><path d="M24 0 H44 L34 36 H14 Z" fill="none" stroke="${C.text}" stroke-width="2.5"/></svg>
        <span>Parallax</span>
      </div>
      <p class="event" data-agent-native-node-id="event-name" data-agent-native-layer-name="Event name">Annual Keynote · 2027</p>
      <h1 class="title" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline">Everything, <span>illuminated.</span></h1>
      <div class="byline" data-agent-native-node-id="byline" data-agent-native-layer-name="Byline">
        <p><strong>Noor Adeyemi</strong><span>Chief Executive, Parallax</span></p>
        <p><strong>14 May 2027</strong><span>Harbor Hall, Pier 3</span></p>
      </div>`,
  }),
};
