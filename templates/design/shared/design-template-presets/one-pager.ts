import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";

const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#F5F0E6",
  // guard:allow-raw-color — authored template palette, not app chrome.
  panel: "#E8DFCF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#1C1A16",
  // guard:allow-raw-color — authored template palette, not app chrome.
  soft: "#5B554A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  rust: "#A8442A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  walnut: "#7A5438",
  // guard:allow-raw-color — authored template palette, not app chrome.
  walnutDark: "#5A3C27",
  // guard:allow-raw-color — authored template palette, not app chrome.
  grille: "#2B2824",
  // guard:allow-raw-color — authored template palette, not app chrome.
  cone: "#45403A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  shadow: "rgba(60, 40, 20, 0.18)",
};

const speaker = `<svg class="speaker" viewBox="0 0 200 280" aria-hidden="true">
          <ellipse cx="100" cy="270" rx="92" ry="7" fill="${C.shadow}"/>
          <rect x="14" y="6" width="172" height="258" rx="10" fill="${C.walnut}"/>
          <rect x="14" y="6" width="172" height="10" rx="5" fill="${C.walnutDark}" opacity=".5"/>
          <rect x="26" y="20" width="148" height="232" rx="6" fill="${C.grille}"/>
          <circle cx="100" cy="70" r="22" fill="${C.cone}"/>
          <circle cx="100" cy="70" r="9" fill="${C.grille}"/>
          <circle cx="100" cy="164" r="58" fill="${C.cone}"/>
          <circle cx="100" cy="164" r="44" fill="${C.grille}"/>
          <circle cx="100" cy="164" r="18" fill="${C.cone}"/>
          <circle cx="100" cy="236" r="3" fill="${C.rust}"/>
        </svg>`;

export const onePagerEditorial: DesignTemplatePreset = {
  id: "preset-one-pager-editorial",
  title: "Editorial product brief",
  description:
    "An 816 × 1056 editorial product brief: two columns, drop cap, pull quote, spec table, folio.",
  category: "one-pager",
  width: 816,
  height: 1056,
  filename: "editorial-product-brief.html",
  content: presetDocument({
    title: "Arden & Loam — Model One brief",
    width: 816,
    height: 1056,
    fonts:
      "family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Schibsted+Grotesk:wght@400;500;700",
    palette: {
      canvas: C.paper,
      paper: C.paper,
      panel: C.panel,
      ink: C.ink,
      soft: C.soft,
      rust: C.rust,
    },
    css: `
      .artboard { color:var(--ink); font-family:'Newsreader', serif; }
      .label { font-family:'Schibsted Grotesk', sans-serif; font-size:10.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
      .issue { position:absolute; right:56px; top:52px; z-index:2; color:var(--soft); }
      .masthead-rule { position:absolute; left:56px; right:56px; top:88px; height:2px; background:var(--ink); }
      .hero { position:absolute; left:56px; top:120px; z-index:2; width:396px; }
      .hero h1 { font-size:52px; font-weight:400; line-height:1.02; letter-spacing:-.025em; }
      .hero h1 em { color:var(--rust); }
      .standfirst { margin-top:22px; color:var(--soft); font-family:'Schibsted Grotesk', sans-serif; font-size:15px; line-height:1.5; }
      .figure { position:absolute; left:480px; top:120px; z-index:1; width:280px; height:322px; background:var(--panel); }
      .speaker { position:absolute; left:52px; top:30px; width:176px; height:246px; }
      .figure figcaption { position:absolute; left:16px; bottom:12px; color:var(--soft); }
      .section-rule { position:absolute; left:56px; right:56px; top:470px; height:1px; background:var(--ink); }
      .columns { position:absolute; left:56px; right:56px; top:494px; z-index:2; display:grid; grid-template-columns:1fr 1fr; gap:36px; font-size:14.5px; line-height:1.6; }
      .columns p + p { margin-top:12px; }
      .dropcap::first-letter { float:left; margin:6px 10px 0 0; color:var(--rust); font-size:62px; line-height:.8; font-weight:500; }
      .pull { margin-bottom:18px; padding:4px 0 18px; border-bottom:1px solid var(--ink); font-size:24px; font-style:italic; line-height:1.22; letter-spacing:-.01em; }
      .pull cite { display:block; margin-top:10px; color:var(--soft); font-family:'Schibsted Grotesk', sans-serif; font-size:10.5px; font-style:normal; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
      .specs { position:absolute; left:56px; right:56px; top:824px; z-index:2; }
      .specs h2 { margin-bottom:8px; }
      .specs dl { display:grid; grid-template-columns:1fr 1fr; column-gap:36px; font-family:'Schibsted Grotesk', sans-serif; font-size:12.5px; }
      .specs dl div { display:flex; justify-content:space-between; gap:16px; padding:8px 0; border-bottom:1px dotted var(--soft); }
      .specs dt { color:var(--soft); }
      .specs dd { font-weight:500; text-align:right; }
      .folio { position:absolute; left:56px; right:56px; bottom:36px; z-index:2; display:flex; justify-content:space-between; padding-top:10px; border-top:1px solid var(--ink); color:var(--soft); }
    `,
    body: `
      <div style="position:absolute;inset:0;background:${C.paper}" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <div style="position:absolute;top:44px;left:56px;z-index:3;display:flex;align-items:center;gap:10px;color:${C.ink};font:italic 400 26px/1 'Newsreader',serif;letter-spacing:-.01em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="10" fill="none" stroke="${C.ink}" stroke-width="1.5"/><circle cx="11" cy="11" r="4" fill="${C.rust}"/></svg>
        <span>Arden &amp; Loam</span>
      </div>
      <p class="issue label" data-agent-native-node-id="issue" data-agent-native-layer-name="Issue line">Product brief · No. 04 · Spring 2027</p>
      <div class="masthead-rule" aria-hidden="true"></div>
      <header class="hero" data-agent-native-node-id="hero" data-agent-native-layer-name="Hero">
        <h1>A small speaker that fills the room <em>without asking.</em></h1>
        <p class="standfirst">Model One is a passive bookshelf speaker in solid walnut, tuned for rooms where people actually talk.</p>
      </header>
      <figure class="figure" data-agent-native-node-id="product-figure" data-agent-native-layer-name="Product figure">
        ${speaker}
        <figcaption class="label">Model One · Walnut</figcaption>
      </figure>
      <div class="section-rule" aria-hidden="true"></div>
      <section class="columns" data-agent-native-node-id="body-columns" data-agent-native-layer-name="Body columns">
        <div>
          <p class="dropcap">Most speakers are designed to win a showroom. Model One was designed for a Tuesday evening: dinner on, a record playing, and nobody reaching for the volume. The cabinet is solid walnut, joined by hand, with a front baffle cut from a single board.</p>
          <p>A five-inch paper cone and a silk dome tweeter share a gentle crossover, so voices sit forward and bass stays in the room instead of the walls.</p>
        </div>
        <div>
          <blockquote class="pull">“It disappears the way a good chair does. You only notice it when you leave.”<cite>Early listener, Lisbon</cite></blockquote>
          <p>Each pair is matched on the bench and signed by the person who tuned it. Grilles are wool from a mill two valleys over.</p>
          <p>Available in walnut and white oak, in pairs only, shipping eight weeks from order.</p>
        </div>
      </section>
      <section class="specs" data-agent-native-node-id="specs" data-agent-native-layer-name="Specifications">
        <h2 class="label">Specifications</h2>
        <dl>
          <div><dt>Drivers</dt><dd>5" paper cone, 1" silk dome</dd></div>
          <div><dt>Cabinet</dt><dd>Solid walnut, 18 mm</dd></div>
          <div><dt>Frequency</dt><dd>48 Hz – 22 kHz</dd></div>
          <div><dt>Dimensions</dt><dd>30 × 19 × 24 cm</dd></div>
          <div><dt>Sensitivity</dt><dd>87 dB / 2.83 V / 1 m</dd></div>
          <div><dt>Pair price</dt><dd>$1,280</dd></div>
        </dl>
      </section>
      <footer class="folio label" data-agent-native-node-id="folio" data-agent-native-layer-name="Folio"><span>ardenandloam.example</span><span>Model One — 01</span></footer>`,
  }),
};
