import type { DesignTemplatePreset } from "../design-template-presets.js";
import { presetDocument } from "./doc.js";

const C = {
  // guard:allow-raw-color — authored template palette, not app chrome.
  cream: "#F7F0E4",
  // guard:allow-raw-color — authored template palette, not app chrome.
  paper: "#FFFAF1",
  // guard:allow-raw-color — authored template palette, not app chrome.
  ink: "#2A1C13",
  // guard:allow-raw-color — authored template palette, not app chrome.
  soft: "#6E5B4C",
  // guard:allow-raw-color — authored template palette, not app chrome.
  coral: "#F0714B",
  // guard:allow-raw-color — authored template palette, not app chrome.
  pink: "#F5A99A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  yuzu: "#F4C94A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  sage: "#A9C29A",
  // guard:allow-raw-color — authored template palette, not app chrome.
  plum: "#8A4E73",
  // guard:allow-raw-color — authored template palette, not app chrome.
  blush: "#F6D9CC",
  // guard:allow-raw-color — authored template palette, not app chrome.
  leaf: "#5E7F55",
  // guard:allow-raw-color — authored template palette, not app chrome.
  white: "#FFFFFF",
  // guard:allow-raw-color — authored template palette, not app chrome.
  shadow: "rgba(42, 28, 19, 0.16)",
};

const BLOB =
  "M108 6 C160 12 196 52 190 108 C184 160 138 196 88 190 C38 184 4 146 10 94 C16 42 58 0 108 6 Z";

const can = (body: string, band: string, flavor: string) =>
  `<svg class="can" viewBox="0 0 120 250" aria-hidden="true">
            <ellipse cx="60" cy="244" rx="54" ry="6" fill="${C.shadow}"/>
            <rect x="6" y="10" width="108" height="234" rx="20" fill="${body}"/>
            <rect x="14" y="4" width="92" height="14" rx="7" fill="${C.soft}" opacity=".45"/>
            <rect x="6" y="140" width="108" height="56" fill="${band}"/>
            <text x="60" y="104" text-anchor="middle" fill="${C.ink}" font-family="Fraunces, serif" font-style="italic" font-size="34" font-weight="600">plume</text>
            <text x="60" y="174" text-anchor="middle" fill="${C.ink}" font-family="Figtree, sans-serif" font-size="11" font-weight="700" letter-spacing="1.5">${flavor}</text>
            <rect x="16" y="24" width="6" height="200" rx="3" fill="${C.white}" opacity=".35"/>
          </svg>`;

const star = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L10 14.9l-5.2 2.8 1-5.9L1.5 7.7l5.9-.8z" fill="${C.coral}"/></svg>`;

const flavors: Array<[string, string, string, string, string]> = [
  [
    "Grapefruit & Rosemary",
    "Bright, bitter, a little piney.",
    C.pink,
    C.coral,
    "GRAPEFRUIT",
  ],
  [
    "Yuzu & Basil",
    "Sherbet-sharp with a green finish.",
    C.yuzu,
    C.sage,
    "YUZU · BASIL",
  ],
  [
    "Pear & Elderflower",
    "Soft, floral, garden-party easy.",
    C.sage,
    C.yuzu,
    "PEAR · ELDER",
  ],
  [
    "Plum & Cardamom",
    "Dark fruit, warm spice, dry.",
    C.plum,
    C.pink,
    "PLUM · SPICE",
  ],
];

export const landingDtc: DesignTemplatePreset = {
  id: "preset-landing-dtc",
  title: "Consumer brand landing page",
  description:
    "A 1440 × 2500 warm DTC landing page: soft serif, rounded product blobs, flavor lineup, reviews, sign-up.",
  category: "landing-page",
  width: 1440,
  height: 2500,
  filename: "brand-landing-page.html",
  content: presetDocument({
    title: "Plume — Sparkling botanical tonics",
    width: 1440,
    height: 2500,
    alpine: true,
    fonts:
      "family=Fraunces:ital,opsz,wght,SOFT@0,9..144,300..700,100;1,9..144,300..700,100&family=Figtree:wght@400;500;600;700",
    palette: {
      canvas: C.cream,
      cream: C.cream,
      paper: C.paper,
      ink: C.ink,
      soft: C.soft,
      coral: C.coral,
      blush: C.blush,
      yuzu: C.yuzu,
      leaf: C.leaf,
      white: C.white,
      shadow: C.shadow,
    },
    css: `
      .artboard { color:var(--ink); font-family:'Figtree', sans-serif; font-size:17px; }
      .serif { font-family:'Fraunces', serif; font-variation-settings:'SOFT' 100; }
      .wrap { position:relative; z-index:2; width:1200px; margin:0 auto; }
      .nav { display:flex; align-items:center; justify-content:space-between; height:104px; }
      .nav ul { display:flex; gap:40px; margin-left:96px; font-size:16px; font-weight:500; }
      .bag { display:inline-flex; align-items:center; gap:10px; height:46px; padding:0 20px; border:1.5px solid var(--ink); border-radius:999px; font-size:15px; font-weight:600; }
      .bag svg { width:18px; height:18px; }
      .hero { display:grid; grid-template-columns:1fr 540px; align-items:center; gap:40px; padding-top:40px; }
      .hero h1 { font-size:104px; font-weight:400; line-height:.95; letter-spacing:-.035em; }
      .hero h1 em { color:var(--coral); font-weight:500; }
      .hero p { max-width:500px; margin-top:28px; color:var(--soft); font-size:20px; line-height:1.5; }
      .hero-ctas { display:flex; align-items:center; gap:28px; margin-top:40px; }
      .pill { display:inline-flex; align-items:center; gap:12px; height:60px; padding:0 30px; border:0; border-radius:999px; background:var(--ink); color:var(--paper); font:600 17px/1 'Figtree', sans-serif; text-decoration:none; cursor:pointer; }
      .pill svg { width:18px; height:18px; }
      .text-link { color:var(--ink); font-weight:600; text-decoration:underline; text-decoration-thickness:1.5px; text-underline-offset:6px; }
      .stage { position:relative; height:600px; }
      .stage .blob { position:absolute; left:0; top:20px; width:540px; height:540px; }
      .stage .can { display:block; width:150px; height:312px; filter:drop-shadow(0 18px 24px var(--shadow)); }
      .sticker { position:absolute; right:-10px; top:36px; display:grid; place-content:center; width:150px; height:150px; border-radius:50%; background:var(--coral); color:var(--paper); font:500 22px/1.05 'Fraunces', serif; font-style:italic; text-align:center; transform:rotate(12deg); }
      .leafy { position:absolute; left:-10px; bottom:40px; width:120px; height:120px; }
      .flavors { padding-top:120px; }
      .section-head { display:flex; align-items:end; justify-content:space-between; }
      .section-head h2 { font-size:64px; font-weight:400; line-height:1; letter-spacing:-.03em; }
      .section-head a { color:var(--ink); font-weight:600; text-decoration:underline; text-underline-offset:6px; }
      .flavor-grid { display:grid; grid-template-columns:repeat(4, 1fr); gap:24px; margin-top:48px; }
      .flavor-art { position:relative; height:320px; }
      .flavor-art .blob { position:absolute; left:10px; top:20px; width:262px; height:262px; }
      .flavor-art .can { position:absolute; left:88px; top:30px; width:112px; height:233px; filter:drop-shadow(0 14px 18px var(--shadow)); }
      .flavor h3 { margin-top:8px; font-size:24px; font-weight:500; letter-spacing:-.02em; }
      .flavor p { margin-top:6px; color:var(--soft); font-size:16px; }
      .flavor .buy { display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding-top:14px; border-top:1.5px solid var(--ink); font-weight:600; font-size:15px; }
      .reviews { margin-top:120px; padding:72px 72px 76px; border-radius:48px; background:var(--blush); }
      .reviews-head { display:flex; justify-content:space-between; align-items:center; }
      .reviews-head h2 { font-size:56px; font-weight:400; line-height:1; letter-spacing:-.03em; }
      .rating { display:flex; align-items:center; gap:12px; font-weight:600; }
      .stars { display:flex; gap:3px; }
      .stars svg { width:22px; height:22px; }
      .review-row { display:grid; grid-template-columns:repeat(3, 1fr); gap:24px; margin-top:44px; }
      .review { padding:32px; border-radius:28px; background:var(--paper); }
      .review blockquote { margin-top:18px; font:400 24px/1.3 'Fraunces', serif; font-style:italic; letter-spacing:-.01em; }
      .review p { margin-top:22px; color:var(--soft); font-size:15px; font-weight:500; }
      .club { display:grid; grid-template-columns:1fr 520px; align-items:center; gap:60px; padding-top:112px; }
      .club h2 { font-size:56px; font-weight:400; line-height:1; letter-spacing:-.03em; }
      .club p { margin-top:14px; color:var(--soft); font-size:18px; }
      .club form { display:flex; gap:10px; padding:8px; border:1.5px solid var(--ink); border-radius:999px; background:var(--paper); }
      .club input { flex:1; min-width:0; height:52px; padding:0 20px; border:0; background:transparent; color:var(--ink); font:500 17px 'Figtree', sans-serif; outline:none; }
      .club .pill { height:52px; }
      .footer { display:flex; justify-content:space-between; margin-top:88px; padding:28px 0 44px; border-top:1.5px solid var(--ink); color:var(--soft); font-size:15px; }
    `,
    body: `
      <div style="position:absolute;inset:0;background:${C.cream}" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <div class="wrap">
        <nav class="nav" data-agent-native-node-id="nav" data-agent-native-layer-name="Navigation">
          <div style="display:flex;align-items:center;gap:10px;color:${C.ink};font:italic 600 38px/1 'Fraunces',serif;letter-spacing:-.03em" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
            <svg width="30" height="34" viewBox="0 0 30 34" aria-hidden="true"><path d="M15 2 C26 8 28 22 15 32 C2 22 4 8 15 2 Z" fill="${C.coral}"/><path d="M15 8 V30" stroke="${C.ink}" stroke-width="2" stroke-linecap="round"/></svg>
            <span>plume</span>
          </div>
          <ul><li>Shop</li><li>Flavors</li><li>Our garden</li><li>Stockists</li></ul>
          <span class="bag"><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 6h12l-1 10H4L3 6zM6 6V4.5a3 3 0 0 1 6 0V6" fill="none" stroke="${C.ink}" stroke-width="1.6" stroke-linejoin="round"/></svg>Bag · 0</span>
        </nav>
        <header class="hero" data-agent-native-node-id="hero" data-agent-native-layer-name="Hero">
          <div>
            <h1 class="serif">A little garden <em>in every can.</em></h1>
            <p>Sparkling water brewed with real fruit, herbs, and flowers. No sugar, no syrups, nothing you need to squint at.</p>
            <div class="hero-ctas">
              <a class="pill" href="#">Shop the variety pack <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9h11M10 4.5L14.5 9 10 13.5" fill="none" stroke="${C.paper}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
              <a class="text-link" href="#">Find a stockist</a>
            </div>
          </div>
          <div class="stage" aria-hidden="true" data-agent-native-node-id="hero-product" data-agent-native-layer-name="Hero product">
            <svg class="blob" viewBox="0 0 200 200"><path d="${BLOB}" fill="${C.yuzu}"/></svg>
            <div style="position:absolute;left:52px;top:150px;transform:rotate(-9deg)">${can(C.pink, C.coral, "GRAPEFRUIT")}</div>
            <div style="position:absolute;left:338px;top:150px;transform:rotate(8deg)">${can(C.sage, C.yuzu, "PEAR · ELDER")}</div>
            <div style="position:absolute;left:196px;top:196px">${can(C.paper, C.yuzu, "YUZU · BASIL")}</div>
            <svg class="leafy" viewBox="0 0 120 120"><path d="M20 110 C30 60 60 30 110 16 C100 66 70 96 20 110 Z" fill="${C.leaf}"/><path d="M20 110 C50 80 76 52 104 22" fill="none" stroke="${C.cream}" stroke-width="2.5" stroke-linecap="round"/></svg>
            <p class="sticker">New<br />yuzu &amp;<br />basil</p>
          </div>
        </header>
        <section class="flavors" data-agent-native-node-id="flavors" data-agent-native-layer-name="Flavors">
          <div class="section-head"><h2 class="serif">Four flavors, zero sugar.</h2><a href="#">Shop all flavors</a></div>
          <div class="flavor-grid">
            ${flavors
              .map(
                ([name, note, body, band, label]) => `<article class="flavor">
              <div class="flavor-art"><svg class="blob" viewBox="0 0 200 200" aria-hidden="true"><path d="${BLOB}" fill="${C.paper}"/></svg>${can(body, band, label)}</div>
              <h3 class="serif">${name}</h3>
              <p>${note}</p>
              <div class="buy"><span>12 cans · $32</span><span>Add to bag</span></div>
            </article>`,
              )
              .join("")}
          </div>
        </section>
        <section class="reviews" data-agent-native-node-id="reviews" data-agent-native-layer-name="Reviews">
          <div class="reviews-head"><h2 class="serif">Word from the garden.</h2><div class="rating"><span class="stars">${star.repeat(5)}</span>4.9 from 2,140 reviews</div></div>
          <div class="review-row">
            <article class="review"><span class="stars">${star.repeat(5)}</span><blockquote>“Tastes like someone actually cooked something. I keep a shelf of the plum one for guests.”</blockquote><p>Dani R., Portland</p></article>
            <article class="review"><span class="stars">${star.repeat(5)}</span><blockquote>“The only fizzy drink my kids and I fight over. Grapefruit rosemary is dangerous.”</blockquote><p>Marcus T., Leeds</p></article>
            <article class="review"><span class="stars">${star.repeat(5)}</span><blockquote>“Replaced my afternoon soda without feeling like a sacrifice. Genuinely lovely.”</blockquote><p>Priya S., Austin</p></article>
          </div>
        </section>
        <section class="club" x-data="{ joined: false }" data-agent-native-node-id="garden-club" data-agent-native-layer-name="Garden club">
          <div><h2 class="serif">Join the garden club.</h2><p>New flavors a week early, and 15% off your first box.</p></div>
          <form @submit.prevent="joined = true">
            <input type="email" placeholder="you@example.com" aria-label="Email address" x-show="!joined" />
            <p x-cloak x-show="joined" style="flex:1;align-self:center;padding-left:20px;font-weight:600">You’re in. Check your inbox.</p>
            <button class="pill" type="submit" x-text="joined ? 'Welcome' : 'Sign me up'">Sign me up</button>
          </form>
        </section>
        <footer class="footer" data-agent-native-node-id="footer" data-agent-native-layer-name="Footer"><span>Plume Beverage Co.</span><span>Shipping · Wholesale · Instagram · Contact</span></footer>
      </div>`,
  }),
};
