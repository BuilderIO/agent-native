import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";

const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#EDE6D6",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#161514",
  // guard:allow-raw-color — authored template palette, not app chrome.
  red: "#D7362B",
  // guard:allow-raw-color — authored template palette, not app chrome.
  blue: "#1E4FA6",
  // Multiplied over the paper, this lands on `blue`.
  // guard:allow-raw-color — authored template palette, not app chrome.
  blueUnderPaper: "#2058C6",
  // guard:allow-raw-color — authored template palette, not app chrome.
  yellow: "#F2B51E",
};

export const eventPoster: DesignTemplatePreset = {
  id: "preset-event-poster",
  title: "Event poster",
  description:
    "A 1200 × 1600 Bauhaus-inspired festival poster: primary colors, constructed geometry, lowercase display type.",
  category: "other",
  width: 1200,
  height: 1600,
  filename: "event-poster.html",
  content: presetDocument({
    title: "Formschule — Festival No. 3",
    width: 1200,
    height: 1600,
    fonts: "family=Syne:wght@700;800&family=Work+Sans:wght@500",
    palette: {
      canvas: C.paper,
      paper: C.paper,
      ink: C.ink,
      red: C.red,
      blue: C.blue,
      yellow: C.yellow,
    },
    css: `
      .artboard { color:var(--ink); font-family:'Work Sans', sans-serif; }
      .edition { position:absolute; top:70px; right:64px; z-index:3; font:700 22px/1 'Syne', sans-serif; letter-spacing:.02em; text-align:right; }
      .geometry { position:absolute; left:0; top:0; width:1200px; height:920px; }
      .circle { position:absolute; left:84px; top:172px; width:620px; height:620px; border-radius:50%; background:var(--red); }
      .triangle { position:absolute; left:500px; top:250px; width:640px; height:620px; mix-blend-mode:multiply; }
      .bar { position:absolute; left:64px; top:824px; width:668px; height:52px; background:var(--yellow); }
      .stripes { position:absolute; left:924px; top:150px; width:212px; }
      .stripes i { display:block; height:14px; margin-bottom:16px; background:var(--ink); }
      .dot { position:absolute; left:1016px; top:760px; width:120px; height:120px; border-radius:50%; background:var(--ink); }
      .headline { position:absolute; left:58px; top:918px; z-index:2; font:800 176px/.86 'Syne', sans-serif; letter-spacing:-.04em; }
      .headline span { display:block; }
      .headline span:last-child { color:var(--red); }
      .info { position:absolute; left:64px; right:64px; bottom:64px; z-index:2; display:grid; grid-template-columns:1.1fr 1.2fr 1fr; gap:32px; padding-top:22px; border-top:6px solid var(--ink); }
      .info dt { font:700 15px/1 'Syne', sans-serif; letter-spacing:.08em; text-transform:lowercase; }
      .info dd { margin-top:10px; font-size:24px; font-weight:500; line-height:1.25; letter-spacing:-.01em; }
    `,
    body: `
      <div style="position:absolute;inset:0;background:${C.paper}" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <div class="geometry" aria-hidden="true" data-agent-native-node-id="geometry" data-agent-native-layer-name="Geometry">
        <div class="circle"></div>
        <svg class="triangle" viewBox="0 0 640 620"><path d="M320 0 L640 620 L0 620 Z" fill="${C.blueUnderPaper}"/></svg>
        <div class="bar"></div>
        <div class="stripes"><i></i><i style="width:74%"></i><i style="width:48%"></i></div>
        <div class="dot"></div>
      </div>
      <div style="position:absolute;top:64px;left:64px;z-index:3;display:flex;align-items:center;gap:14px;color:${C.ink};font:800 30px/1 'Syne',sans-serif;letter-spacing:-.01em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="72" height="24" viewBox="0 0 72 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="${C.red}"/><path d="M36 0 L48 24 L24 24 Z" fill="${C.blue}"/><rect x="50" y="2" width="20" height="20" fill="${C.yellow}"/></svg>
        <span>formschule</span>
      </div>
      <p class="edition" data-agent-native-node-id="edition" data-agent-native-layer-name="Edition">festival no. 3<br />design, built by hand</p>
      <h1 class="headline" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline"><span>form</span><span>follows</span><span>play.</span></h1>
      <dl class="info" data-agent-native-node-id="event-info" data-agent-native-layer-name="Event info">
        <div><dt>when</dt><dd>12 — 14 June 2027<br />Doors at 10:00</dd></div>
        <div><dt>where</dt><dd>Hall 4, Old Tram Depot<br />Riverside Quarter</dd></div>
        <div><dt>what</dt><dd>Talks, workshops,<br />a night market</dd></div>
      </dl>`,
  }),
};
