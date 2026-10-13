import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";

const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  cobalt: "#1433E6",
  // guard:allow-raw-color — authored template palette, not app chrome.
  cobaltLight: "#2E55FF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  yellow: "#FFE11A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  red: "#FF2D3D",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#0A0A12",
  // guard:allow-raw-color — authored template palette, not app chrome.
  white: "#FFFFFF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  cream: "#F2EBDD",
  // guard:allow-raw-color — authored template palette, not app chrome.
  orange: "#FF7A1A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  grey: "#3A3A48",
};

const rays = Array.from({ length: 16 }, (_, index) => {
  const angle = (index * 360) / 16;
  return `<path d="M0 0 L1400 -140 L1400 140 Z" transform="rotate(${angle})" fill="${C.cobaltLight}"/>`;
}).join("");

const synth = `<svg class="synth" viewBox="0 0 480 300" aria-hidden="true">
          <rect x="12" y="24" width="468" height="276" rx="26" fill="${C.ink}"/>
          <rect x="0" y="8" width="468" height="276" rx="26" fill="${C.cream}" stroke="${C.ink}" stroke-width="6"/>
          <rect x="28" y="34" width="150" height="72" rx="10" fill="${C.ink}"/>
          <path d="M42 84 Q62 44 82 70 T122 62 T164 58" fill="none" stroke="${C.yellow}" stroke-width="5" stroke-linecap="round"/>
          <circle cx="232" cy="70" r="30" fill="${C.orange}" stroke="${C.ink}" stroke-width="6"/>
          <rect x="228" y="42" width="8" height="24" rx="4" fill="${C.ink}"/>
          <circle cx="314" cy="70" r="30" fill="${C.grey}" stroke="${C.ink}" stroke-width="6"/>
          <rect x="310" y="42" width="8" height="24" rx="4" fill="${C.cream}"/>
          <circle cx="396" cy="70" r="30" fill="${C.grey}" stroke="${C.ink}" stroke-width="6"/>
          <rect x="392" y="42" width="8" height="24" rx="4" fill="${C.cream}"/>
          <rect x="28" y="128" width="412" height="130" rx="8" fill="${C.ink}"/>
          ${Array.from({ length: 8 }, (_, i) => `<rect x="${36 + i * 51}" y="136" width="45" height="114" rx="5" fill="${C.white}"/>`).join("")}
          ${[0, 1, 3, 4, 5].map((i) => `<rect x="${68 + i * 51}" y="136" width="28" height="68" rx="4" fill="${C.ink}"/>`).join("")}
        </svg>`;

export const videoThumbnail: DesignTemplatePreset = {
  id: "preset-video-thumbnail",
  title: "Video thumbnail",
  description:
    "A 1280 × 720 high-contrast video thumbnail: three-word headline, outlined type, circle and arrow callouts.",
  category: "social",
  width: 1280,
  height: 720,
  filename: "video-thumbnail.html",
  content: presetDocument({
    title: "Workbench Weekly — It actually works",
    width: 1280,
    height: 720,
    fonts: "family=Big+Shoulders+Display:wght@900&family=Rubik:wght@700;900",
    palette: {
      canvas: C.cobalt,
      yellow: C.yellow,
      red: C.red,
      ink: C.ink,
      white: C.white,
    },
    css: `
      .artboard { color:var(--white); font-family:'Rubik', sans-serif; }
      .rays { position:absolute; left:0; top:0; width:1280px; height:720px; z-index:0; }
      .headline { position:absolute; left:52px; top:44px; z-index:3; font:900 196px/.82 'Big Shoulders Display', sans-serif; letter-spacing:-.01em; text-transform:uppercase; text-shadow:8px 8px 0 var(--ink); }
      .headline span { display:block; }
      /* Outlined as SVG text: a CSS text-stroke with a transparent fill exports to Figma as invisible text. */
      .headline .outline svg { display:block; width:700px; height:161px; overflow:visible; }
      .headline .fill { color:var(--yellow); }
      .device { position:absolute; left:706px; top:268px; z-index:2; width:500px; height:312px; transform:rotate(-7deg); }
      .synth { width:100%; height:100%; }
      .callout { position:absolute; left:0; top:0; width:1280px; height:720px; z-index:4; pointer-events:none; }
      .episode { position:absolute; right:40px; top:40px; z-index:5; padding:12px 20px 10px; background:var(--red); color:var(--white); font:900 34px/1 'Rubik', sans-serif; letter-spacing:.01em; transform:rotate(4deg); box-shadow:6px 6px 0 var(--ink); }
    `,
    body: `
      <div style="position:absolute;inset:0;background:${C.cobalt}" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <svg class="rays" viewBox="0 0 1280 720" aria-hidden="true" data-agent-native-node-id="rays" data-agent-native-layer-name="Sunburst"><g transform="translate(956 424)">${rays}</g></svg>
      <h1 class="headline" data-agent-native-node-id="headline" data-agent-native-layer-name="Headline"><span>It</span><span class="outline"><svg viewBox="0 0 700 161"><text x="0" y="148" fill="none" stroke="${C.yellow}" stroke-width="7" stroke-linejoin="round" font-family="Big Shoulders Display, sans-serif" font-weight="900" font-size="196" letter-spacing="-2">ACTUALLY</text></svg></span><span class="fill">works</span></h1>
      <div class="device" data-agent-native-node-id="subject" data-agent-native-layer-name="Subject">${synth}</div>
      <svg class="callout" viewBox="0 0 1280 720" aria-hidden="true" data-agent-native-node-id="callouts" data-agent-native-layer-name="Callouts">
        <path d="M945 276 C 893 270, 868 312, 878 352 C 890 400, 964 406, 992 368 C 1018 330, 998 280, 950 272" fill="none" stroke="${C.red}" stroke-width="12" stroke-linecap="round"/>
        <path d="M640 196 C 720 146, 812 164, 846 250" fill="none" stroke="${C.ink}" stroke-width="30" stroke-linecap="round"/>
        <path d="M640 196 C 720 146, 812 164, 846 250" fill="none" stroke="${C.yellow}" stroke-width="18" stroke-linecap="round"/>
        <path d="M818 244 L856 292 L878 232 Z" fill="${C.yellow}" stroke="${C.ink}" stroke-width="6" stroke-linejoin="round"/>
      </svg>
      <p class="episode" data-agent-native-node-id="episode-badge" data-agent-native-layer-name="Episode badge">EP 48</p>
      <div style="position:absolute;left:52px;bottom:40px;z-index:5;display:flex;align-items:center;gap:12px;padding:10px 20px 10px 10px;border-radius:999px;background:${C.ink};color:${C.white};font:700 22px/1 'Rubik',sans-serif;letter-spacing:.02em;text-transform:uppercase" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="18" fill="${C.yellow}"/><path d="M10 12 L14 25 L18 15 L22 25 L26 12" fill="none" stroke="${C.ink}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/></svg>
        <span>Workbench Weekly</span>
      </div>`,
  }),
};
