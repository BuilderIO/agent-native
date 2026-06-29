import type { DesignSystemData, TweakDefinition } from "@shared/api";

export type DesignTemplateKind =
  | "one-sheet"
  | "social-ads"
  | "launch-page"
  | "event-invite"
  | "sales-deck"
  | "case-study";

export interface DesignTemplate {
  id: string;
  title: string;
  description: string;
  format: string;
  kind: DesignTemplateKind;
  filename: string;
  prompt: string;
  html: string;
}

export interface DesignSystemSummary {
  id: string;
  title: string;
  data?: string | null;
  isDefault?: boolean;
}

interface BrandTokens {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  headingFont: string;
  bodyFont: string;
  radiusPx: number;
}

const FALLBACK_TOKENS: BrandTokens = {
  primary: "#171411",
  secondary: "#f2e7d8",
  accent: "#ff6f4d",
  background: "#f5efe5",
  surface: "#fffaf2",
  text: "#171411",
  textMuted: "rgba(23, 20, 17, 0.62)",
  headingFont: '"Avenir Next", "Segoe UI", sans-serif',
  bodyFont: '"IBM Plex Sans", "Avenir Next", sans-serif',
  radiusPx: 22,
};

export function getDefaultDesignSystem(
  designSystems: DesignSystemSummary[] | undefined,
): DesignSystemSummary | null {
  if (!designSystems || designSystems.length === 0) return null;
  return designSystems.find((system) => system.isDefault) ?? designSystems[0];
}

export function buildTemplateHtml(
  template: DesignTemplate,
  designSystem?: DesignSystemSummary | null,
): string {
  const tokens = resolveBrandTokens(designSystem);
  return template.html.replace("/*__BRAND_TOKENS__*/", brandTokenCss(tokens));
}

export function buildTemplateTweaks(
  designSystem?: DesignSystemSummary | null,
): TweakDefinition[] {
  const tokens = resolveBrandTokens(designSystem);
  const accentOptions = uniqueColorOptions([
    { label: "Brand", value: tokens.accent },
    { label: "Primary", value: tokens.primary },
    { label: "Coral", value: "#ff6f4d" },
    { label: "Lime", value: "#c7ff59" },
    { label: "Cyan", value: "#37d5ff" },
    { label: "Gold", value: "#f5b942" },
  ]);

  return [
    {
      id: "templateAccent",
      label: "Accent",
      type: "color-swatch",
      options: accentOptions,
      defaultValue: tokens.accent,
      cssVar: "--brand-accent",
    },
    {
      id: "templateRadius",
      label: "Corner radius",
      type: "slider",
      min: 0,
      max: 34,
      step: 2,
      defaultValue: tokens.radiusPx,
      cssVar: "--template-radius",
    },
  ];
}

function resolveBrandTokens(
  designSystem?: DesignSystemSummary | null,
): BrandTokens {
  const parsed = parseDesignSystemData(designSystem?.data);
  const colors = parsed?.colors;
  const typography = parsed?.typography;
  const borders = parsed?.borders;

  return {
    primary: sanitizeColor(colors?.primary, FALLBACK_TOKENS.primary),
    secondary: sanitizeColor(colors?.secondary, FALLBACK_TOKENS.secondary),
    accent: sanitizeColor(colors?.accent, FALLBACK_TOKENS.accent),
    background: sanitizeColor(colors?.background, FALLBACK_TOKENS.background),
    surface: sanitizeColor(colors?.surface, FALLBACK_TOKENS.surface),
    text: sanitizeColor(colors?.text, FALLBACK_TOKENS.text),
    textMuted: sanitizeColor(colors?.textMuted, FALLBACK_TOKENS.textMuted),
    headingFont: sanitizeFontStack(
      typography?.headingFont,
      FALLBACK_TOKENS.headingFont,
    ),
    bodyFont: sanitizeFontStack(typography?.bodyFont, FALLBACK_TOKENS.bodyFont),
    radiusPx: sanitizeRadius(borders?.radius, FALLBACK_TOKENS.radiusPx),
  };
}

function parseDesignSystemData(
  raw: string | null | undefined,
): DesignSystemData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as DesignSystemData;
  } catch {
    return null;
  }
  return null;
}

function brandTokenCss(tokens: BrandTokens): string {
  return [
    `--brand-primary: ${tokens.primary};`,
    `--brand-secondary: ${tokens.secondary};`,
    `--brand-accent: ${tokens.accent};`,
    `--brand-bg: ${tokens.background};`,
    `--brand-surface: ${tokens.surface};`,
    `--brand-text: ${tokens.text};`,
    `--brand-muted: ${tokens.textMuted};`,
    `--brand-heading-font: ${tokens.headingFont};`,
    `--brand-body-font: ${tokens.bodyFont};`,
    `--template-radius: ${tokens.radiusPx}px;`,
  ].join("\n      ");
}

function sanitizeColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed || /[;{}<>]/.test(trimmed)) return fallback;
  if (
    /^#[0-9a-fA-F]{3,8}$/.test(trimmed) ||
    /^rgba?\([0-9%,.\s/-]+\)$/.test(trimmed) ||
    /^hsla?\([0-9%,.\s/-]+(?:deg)?[0-9%,.\s/-]*\)$/.test(trimmed) ||
    /^[a-zA-Z]+$/.test(trimmed)
  ) {
    return trimmed;
  }
  return fallback;
}

function sanitizeFontStack(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[;{}<>]/g, "").trim();
  if (!cleaned) return fallback;
  // Accept only font stacks composed of quoted or unquoted font family names.
  // Each family name may be a quoted string or unquoted alphanumeric words/hyphens/underscores.
  // This rejects unbalanced parentheses, slashes, and other CSS-injection vectors.
  const fontFamilyPattern =
    /^"[^"]*"|'[^']*'|[a-zA-Z0-9 \-_]+(?:\s+[a-zA-Z0-9 \-_]+)*/;
  const fontStackPattern = new RegExp(
    `^(${fontFamilyPattern.source})(,\\s*(${fontFamilyPattern.source}))*$`,
  );
  if (fontStackPattern.test(cleaned)) return cleaned;
  // Single unquoted name: wrap in quotes and append fallback.
  const singleName = cleaned.replace(/["']/g, "").trim();
  if (/^[a-zA-Z0-9 \-_]+$/.test(singleName)) {
    return `"${singleName}", ${fallback}`;
  }
  return fallback;
}

function sanitizeRadius(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(34, Math.round(value)));
  }
  if (typeof value !== "string") return fallback;
  const px = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)px$/);
  if (!px) return fallback;
  return Math.max(0, Math.min(34, Math.round(Number(px[1]))));
}

function uniqueColorOptions(
  options: Array<{ label: string; value: string }>,
): Array<{ label: string; value: string; color: string }> {
  const seen = new Set<string>();
  const unique: Array<{ label: string; value: string; color: string }> = [];
  for (const option of options) {
    const value = sanitizeColor(option.value, "");
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    unique.push({ ...option, value, color: value });
  }
  return unique;
}

const oneSheetHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Launch One-Sheet</title>
    <style>
      :root {
      /*__BRAND_TOKENS__*/
      }
      * { box-sizing: border-box; }
      html, body { min-height: 100%; }
      body {
        margin: 0;
        display: grid;
        place-items: center;
        padding: clamp(8px, 4vw, 44px);
        background:
          radial-gradient(circle at 12% 18%, color-mix(in srgb, var(--brand-accent) 20%, transparent), transparent 28%),
          linear-gradient(135deg, color-mix(in srgb, var(--brand-bg) 90%, white), color-mix(in srgb, var(--brand-secondary) 70%, white));
        color: var(--brand-text);
        font-family: var(--brand-body-font);
      }
      .sheet {
        width: min(100%, 816px, calc((100vh - 24px) * 0.7727));
        aspect-ratio: 8.5 / 11;
        display: grid;
        grid-template-rows: auto 1fr auto;
        overflow: hidden;
        border-radius: var(--template-radius);
        background: var(--brand-surface);
        box-shadow: 0 26px 70px rgba(18, 14, 9, 0.24);
      }
      .masthead {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 26px;
        padding: clamp(28px, 5vw, 58px);
        color: white;
        background:
          linear-gradient(135deg, color-mix(in srgb, var(--brand-primary) 92%, black), color-mix(in srgb, var(--brand-primary) 72%, var(--brand-accent))),
          var(--brand-primary);
      }
      .brand {
        font-size: clamp(10px, 1.6vw, 13px);
        font-weight: 800;
        text-transform: uppercase;
      }
      h1 {
        max-width: 620px;
        margin: 34px 0 0;
        font-family: var(--brand-heading-font);
        font-size: clamp(26px, 8vw, 86px);
        line-height: 0.9;
      }
      .issue {
        width: 92px;
        height: 92px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(255,255,255,0.36);
        border-radius: 999px;
        color: var(--brand-primary);
        background: var(--brand-accent);
        font-weight: 900;
      }
      .content {
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: clamp(22px, 4vw, 42px);
        padding: clamp(28px, 5vw, 54px);
      }
      .lede {
        margin: 0 0 30px;
        color: var(--brand-muted);
        font-size: clamp(12px, 2.4vw, 24px);
        line-height: 1.28;
      }
      .proof { display: grid; gap: 14px; }
      .proof-item {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 14px;
        align-items: start;
        padding-top: 16px;
        border-top: 1px solid color-mix(in srgb, var(--brand-text) 13%, transparent);
      }
      .number {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border-radius: 999px;
        background: var(--brand-accent);
        color: var(--brand-primary);
        font-weight: 900;
      }
      .proof-item h2 {
        margin: 0 0 5px;
        font-family: var(--brand-heading-font);
        font-size: clamp(18px, 2.4vw, 28px);
      }
      .proof-item p { margin: 0; color: var(--brand-muted); line-height: 1.45; }
      .side {
        display: grid;
        align-content: start;
        gap: 16px;
      }
      .metric {
        padding: clamp(18px, 3vw, 28px);
        border-radius: calc(var(--template-radius) * 0.8);
        background: color-mix(in srgb, var(--brand-secondary) 72%, white);
      }
      .metric strong {
        display: block;
        font-family: var(--brand-heading-font);
        font-size: clamp(32px, 5vw, 56px);
        line-height: 1;
      }
      .quote {
        padding: clamp(18px, 3vw, 28px);
        border-radius: calc(var(--template-radius) * 0.8);
        color: white;
        background: var(--brand-primary);
      }
      .quote p { margin: 0; font-size: clamp(16px, 2vw, 21px); line-height: 1.35; }
      .quote span { display: block; margin-top: 20px; color: rgba(255,255,255,0.68); }
      footer {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        padding: 24px clamp(28px, 5vw, 54px);
        border-top: 1px solid color-mix(in srgb, var(--brand-text) 12%, transparent);
        color: var(--brand-muted);
        font-size: 13px;
      }
      footer strong { color: var(--brand-text); }
      @media (max-width: 720px) {
        .content, .masthead { grid-template-columns: 1fr; }
        .issue { width: 72px; height: 72px; }
        footer { flex-direction: column; }
      }
      @media print {
        body { padding: 0; background: white; }
        .sheet { width: 8.5in; height: 11in; border-radius: 0; box-shadow: none; }
      }
    </style>
  </head>
  <body>
    <main class="sheet" aria-label="Launch one-sheet">
      <section class="masthead">
        <div>
          <div class="brand">BRAND / LAUNCH BRIEF</div>
          <h1>Turn product intent into shipped pages.</h1>
        </div>
        <div class="issue">PDF</div>
      </section>
      <section class="content">
        <div>
          <p class="lede">A concise product marketing brief for teams that need a clean narrative, proof, and a CTA in one printable page.</p>
          <div class="proof">
            <article class="proof-item">
              <div class="number">1</div>
              <div>
                <h2>Position the outcome.</h2>
                <p>Replace feature lists with a headline that names the business result and the audience it serves.</p>
              </div>
            </article>
            <article class="proof-item">
              <div class="number">2</div>
              <div>
                <h2>Show concrete proof.</h2>
                <p>Use a short metric, quote, and implementation detail to make the offer feel credible and ready.</p>
              </div>
            </article>
            <article class="proof-item">
              <div class="number">3</div>
              <div>
                <h2>Make the next step obvious.</h2>
                <p>End with a direct CTA that tells the reader exactly what to do after scanning the page.</p>
              </div>
            </article>
          </div>
        </div>
        <aside class="side">
          <div class="metric">
            <strong>42%</strong>
            <span>less production time after switching from blank-page requests to reusable launch layouts.</span>
          </div>
          <div class="metric">
            <strong>8.5 x 11</strong>
            <span>letter-size artboard with print rules already included.</span>
          </div>
          <div class="quote">
            <p>"This gave the campaign team a finished direction before the first review."</p>
            <span>Marketing Ops Lead</span>
          </div>
        </aside>
      </section>
      <footer>
        <span><strong>CTA:</strong> Book a launch review</span>
        <span>brand.com/launch</span>
      </footer>
    </main>
  </body>
</html>`;

const socialAdsHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Paid Social Ad Set</title>
    <style>
      :root {
      /*__BRAND_TOKENS__*/
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: clamp(8px, 4vw, 44px);
        background:
          linear-gradient(120deg, color-mix(in srgb, var(--brand-primary) 92%, black), #1f2a25 52%, color-mix(in srgb, var(--brand-accent) 28%, var(--brand-bg)));
        color: var(--brand-text);
        font-family: var(--brand-body-font);
      }
      .board {
        width: min(1180px, 100%, calc((100vh - 24px) * 1.55));
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(220px, 0.7fr);
        gap: clamp(18px, 4vw, 34px);
        align-items: center;
      }
      .ad {
        position: relative;
        overflow: hidden;
        border-radius: var(--template-radius);
        background: var(--brand-surface);
        box-shadow: 0 28px 80px rgba(0,0,0,0.32);
      }
      .square { aspect-ratio: 1 / 1; }
      .portrait { aspect-ratio: 4 / 5; }
      .ad::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 78% 12%, color-mix(in srgb, var(--brand-accent) 78%, white), transparent 24%),
          radial-gradient(circle at 8% 84%, color-mix(in srgb, var(--brand-secondary) 80%, white), transparent 32%);
      }
      .inner {
        position: relative;
        height: 100%;
        display: grid;
        align-content: space-between;
        padding: clamp(26px, 5vw, 70px);
      }
      .logo {
        width: fit-content;
        border-radius: 999px;
        padding: 10px 15px;
        background: color-mix(in srgb, var(--brand-primary) 92%, black);
        color: white;
        font-size: clamp(12px, 1.3vw, 16px);
        font-weight: 900;
        text-transform: uppercase;
      }
      h1 {
        max-width: 760px;
        margin: 0;
        color: color-mix(in srgb, var(--brand-primary) 94%, black);
        font-family: var(--brand-heading-font);
        font-size: clamp(28px, 8vw, 124px);
        line-height: 0.86;
      }
      .portrait h1 { font-size: clamp(24px, 6vw, 76px); }
      .offer {
        display: grid;
        gap: 12px;
        max-width: 520px;
      }
      .offer p {
        margin: 0;
        color: var(--brand-muted);
        font-size: clamp(12px, 2vw, 25px);
        line-height: 1.22;
      }
      .cta {
        width: fit-content;
        border-radius: 999px;
        padding: 14px 20px;
        background: var(--brand-accent);
        color: var(--brand-primary);
        font-weight: 950;
      }
      .safe-zone {
        position: absolute;
        inset: 22px;
        border: 1px dashed rgba(0,0,0,0.15);
        border-radius: calc(var(--template-radius) * 0.75);
        pointer-events: none;
      }
      .format {
        position: absolute;
        right: 24px;
        bottom: 22px;
        color: color-mix(in srgb, var(--brand-primary) 62%, transparent);
        font-size: 13px;
        font-weight: 800;
      }
      @media (max-width: 780px) {
        .board { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main class="board" aria-label="Paid social ad set">
      <section class="ad square">
        <div class="inner">
          <div class="logo">BRAND</div>
          <h1>Launch faster without losing polish.</h1>
          <div class="offer">
            <p>Reusable campaign templates with fixed sizes, brand tokens, and editable copy.</p>
            <div class="cta">Start from this ad</div>
          </div>
        </div>
        <div class="safe-zone"></div>
        <div class="format">1080 x 1080</div>
      </section>
      <section class="ad portrait">
        <div class="inner">
          <div class="logo">BRAND</div>
          <h1>One idea. Every channel.</h1>
          <div class="offer">
            <p>Portrait creative ready for paid social, organic, and stories.</p>
            <div class="cta">Try the workflow</div>
          </div>
        </div>
        <div class="safe-zone"></div>
        <div class="format">1080 x 1350</div>
      </section>
    </main>
  </body>
</html>`;

const launchPageHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Product Launch Page</title>
    <style>
      :root {
      /*__BRAND_TOKENS__*/
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--brand-bg);
        color: var(--brand-text);
        font-family: var(--brand-body-font);
      }
      .page {
        min-height: 100vh;
        background:
          linear-gradient(180deg, color-mix(in srgb, var(--brand-surface) 78%, white), transparent 58%),
          var(--brand-bg);
      }
      nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        max-width: 1180px;
        margin: 0 auto;
        padding: 26px clamp(20px, 4vw, 40px);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 950;
      }
      .mark {
        width: 28px;
        height: 28px;
        border-radius: 9px;
        background: var(--brand-accent);
        box-shadow: inset -8px -8px 0 color-mix(in srgb, var(--brand-primary) 24%, transparent);
      }
      nav a {
        color: var(--brand-muted);
        text-decoration: none;
        font-size: 14px;
      }
      .nav-links { display: flex; gap: 22px; }
      .hero {
        max-width: 1180px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: 0.9fr 1.1fr;
        gap: clamp(28px, 5vw, 68px);
        align-items: center;
        padding: clamp(36px, 7vw, 92px) clamp(20px, 4vw, 40px);
      }
      .eyebrow {
        width: fit-content;
        border-radius: 999px;
        padding: 9px 13px;
        background: color-mix(in srgb, var(--brand-accent) 22%, white);
        color: color-mix(in srgb, var(--brand-primary) 80%, black);
        font-size: 12px;
        font-weight: 900;
        text-transform: uppercase;
      }
      h1 {
        margin: 20px 0 18px;
        font-family: var(--brand-heading-font);
        font-size: clamp(32px, 8vw, 98px);
        line-height: 0.92;
      }
      .hero p {
        max-width: 590px;
        margin: 0;
        color: var(--brand-muted);
        font-size: clamp(18px, 2vw, 23px);
        line-height: 1.42;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 30px;
      }
      .button {
        border-radius: 999px;
        padding: 14px 20px;
        background: var(--brand-primary);
        color: white;
        font-weight: 850;
      }
      .button.secondary {
        background: transparent;
        color: var(--brand-text);
        border: 1px solid color-mix(in srgb, var(--brand-text) 18%, transparent);
      }
      .product {
        position: relative;
        border-radius: var(--template-radius);
        padding: clamp(16px, 3vw, 28px);
        background: color-mix(in srgb, var(--brand-primary) 92%, black);
        box-shadow: 0 32px 90px rgba(30, 24, 16, 0.26);
      }
      .window {
        overflow: hidden;
        border-radius: calc(var(--template-radius) * 0.75);
        background: color-mix(in srgb, var(--brand-surface) 92%, white);
      }
      .chrome {
        display: flex;
        gap: 7px;
        padding: 15px;
        background: rgba(255,255,255,0.08);
      }
      .dot { width: 9px; height: 9px; border-radius: 999px; background: var(--brand-accent); }
      .screen {
        display: grid;
        grid-template-columns: 0.8fr 1.2fr;
        gap: 18px;
        padding: clamp(18px, 4vw, 34px);
      }
      .panel {
        min-height: 290px;
        border-radius: calc(var(--template-radius) * 0.65);
        background: var(--brand-secondary);
      }
      .rows { display: grid; gap: 13px; }
      .row {
        height: 54px;
        border-radius: 16px;
        background: white;
        box-shadow: 0 10px 28px rgba(0,0,0,0.08);
      }
      .row.featured {
        height: 118px;
        background: var(--brand-accent);
      }
      .proof {
        max-width: 1180px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 14px;
        padding: 0 clamp(20px, 4vw, 40px) clamp(38px, 6vw, 72px);
      }
      .proof-card {
        border-radius: calc(var(--template-radius) * 0.75);
        padding: 24px;
        background: color-mix(in srgb, var(--brand-surface) 82%, white);
      }
      .proof-card strong {
        display: block;
        margin-bottom: 10px;
        font-family: var(--brand-heading-font);
        font-size: 28px;
      }
      .proof-card span { color: var(--brand-muted); line-height: 1.45; }
      @media (max-width: 840px) {
        .hero, .screen, .proof { grid-template-columns: 1fr; }
        .nav-links { display: none; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <nav>
        <div class="brand"><span class="mark"></span> Brand Launch</div>
        <div class="nav-links">
          <a href="#proof">Proof</a>
          <a href="#workflow">Workflow</a>
          <a href="#contact">Contact</a>
        </div>
      </nav>
      <section class="hero">
        <div>
          <div class="eyebrow">New product story</div>
          <h1>Ship launch pages that already know the brand.</h1>
          <p>Start from a complete marketing layout with editable text, reusable sections, and a visual direction strong enough for the first review.</p>
          <div class="actions">
            <div class="button">Create campaign</div>
            <div class="button secondary">View proof</div>
          </div>
        </div>
        <div class="product" aria-label="Product preview">
          <div class="window">
            <div class="chrome"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
            <div class="screen">
              <div class="panel"></div>
              <div class="rows">
                <div class="row featured"></div>
                <div class="row"></div>
                <div class="row"></div>
                <div class="row"></div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section class="proof" id="proof">
        <article class="proof-card"><strong>3.4x</strong><span>More complete first drafts from reusable launch structure.</span></article>
        <article class="proof-card"><strong>12 hrs</strong><span>Saved across copy, layout, and responsive polish.</span></article>
        <article class="proof-card"><strong>100%</strong><span>Editable HTML text, not flattened screenshots.</span></article>
      </section>
    </main>
  </body>
</html>`;

const eventInviteHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Event Invite Kit</title>
    <style>
      :root {
      /*__BRAND_TOKENS__*/
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: clamp(8px, 4vw, 44px);
        background: color-mix(in srgb, var(--brand-primary) 88%, black);
        color: var(--brand-text);
        font-family: var(--brand-body-font);
      }
      .kit {
        width: min(1180px, 100%, calc((100vh - 24px) * 1.55));
        display: grid;
        grid-template-columns: 1.1fr 0.72fr;
        gap: clamp(18px, 4vw, 34px);
        align-items: stretch;
      }
      .hero-card,
      .email-card {
        position: relative;
        overflow: hidden;
        border-radius: var(--template-radius);
        background: var(--brand-surface);
        box-shadow: 0 30px 80px rgba(0,0,0,0.32);
      }
      .hero-card { aspect-ratio: 16 / 9; padding: clamp(28px, 5vw, 64px); }
      .email-card { padding: clamp(24px, 4vw, 42px); }
      .hero-card::before,
      .email-card::before {
        content: "";
        position: absolute;
        inset: auto -8% -38% 34%;
        height: 78%;
        border-radius: 999px 999px 0 0;
        background: color-mix(in srgb, var(--brand-accent) 76%, white);
      }
      .hero-card::after {
        content: "";
        position: absolute;
        inset: 12% 9% auto auto;
        width: 22%;
        aspect-ratio: 1;
        border-radius: 50%;
        border: 24px solid color-mix(in srgb, var(--brand-secondary) 75%, white);
      }
      .content {
        position: relative;
        z-index: 1;
        height: 100%;
        display: grid;
        align-content: space-between;
      }
      .label {
        width: fit-content;
        border-radius: 999px;
        padding: 10px 14px;
        background: var(--brand-primary);
        color: white;
        font-size: 12px;
        font-weight: 900;
        text-transform: uppercase;
      }
      h1 {
        max-width: 760px;
        margin: 0;
        color: color-mix(in srgb, var(--brand-primary) 90%, black);
        font-family: var(--brand-heading-font);
        font-size: clamp(28px, 7vw, 100px);
        line-height: 0.9;
      }
      .details {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        color: var(--brand-primary);
      }
      .pill {
        border-radius: 999px;
        padding: 11px 14px;
        background: color-mix(in srgb, var(--brand-secondary) 78%, white);
        font-weight: 800;
      }
      .email-card h2 {
        position: relative;
        z-index: 1;
        margin: 46px 0 18px;
        color: color-mix(in srgb, var(--brand-primary) 90%, black);
        font-family: var(--brand-heading-font);
        font-size: clamp(30px, 4vw, 52px);
        line-height: 0.95;
      }
      .email-card p {
        position: relative;
        z-index: 1;
        margin: 0 0 28px;
        color: var(--brand-muted);
        line-height: 1.5;
      }
      .agenda {
        position: relative;
        z-index: 1;
        display: grid;
        gap: 10px;
      }
      .agenda div {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        border-top: 1px solid color-mix(in srgb, var(--brand-text) 12%, transparent);
        padding-top: 12px;
      }
      .rsvp {
        position: relative;
        z-index: 1;
        width: fit-content;
        margin-top: 28px;
        border-radius: 999px;
        padding: 13px 18px;
        background: var(--brand-accent);
        color: var(--brand-primary);
        font-weight: 950;
      }
      @media (max-width: 860px) {
        .kit { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main class="kit" aria-label="Event invite kit">
      <section class="hero-card">
        <div class="content">
          <div class="label">Live event</div>
          <h1>Design systems for campaign teams.</h1>
          <div class="details">
            <div class="pill">June 18</div>
            <div class="pill">10:00 AM PT</div>
            <div class="pill">Virtual</div>
          </div>
        </div>
      </section>
      <aside class="email-card">
        <div class="label">Email hero</div>
        <h2>Join the launch working session.</h2>
        <p>Bring one campaign brief. Leave with a reusable template, a cleaner review loop, and a system your team can edit.</p>
        <div class="agenda">
          <div><strong>10:00</strong><span>Opening framework</span></div>
          <div><strong>10:20</strong><span>Template teardown</span></div>
          <div><strong>10:45</strong><span>Working session</span></div>
        </div>
        <div class="rsvp">Reserve a seat</div>
      </aside>
    </main>
  </body>
</html>`;

const salesDeckHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sales Deck Opener</title>
    <style>
      :root {
      /*__BRAND_TOKENS__*/
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: clamp(8px, 4vw, 44px);
        background: color-mix(in srgb, var(--brand-bg) 70%, #111);
        color: var(--brand-text);
        font-family: var(--brand-body-font);
      }
      .slide {
        width: min(1180px, 100%, calc((100vh - 24px) * 1.777));
        aspect-ratio: 16 / 9;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 320px;
        gap: clamp(24px, 4vw, 52px);
        overflow: hidden;
        border-radius: var(--template-radius);
        background: var(--brand-primary);
        color: white;
        box-shadow: 0 32px 90px rgba(0,0,0,0.34);
      }
      .main {
        display: grid;
        align-content: space-between;
        padding: clamp(34px, 6vw, 74px);
      }
      .kicker {
        width: fit-content;
        border-radius: 999px;
        padding: 9px 13px;
        background: rgba(255,255,255,0.1);
        color: var(--brand-accent);
        font-size: 12px;
        font-weight: 900;
        text-transform: uppercase;
      }
      h1 {
        max-width: 760px;
        margin: 0;
        font-family: var(--brand-heading-font);
        font-size: clamp(28px, 8vw, 104px);
        line-height: 0.9;
      }
      .subtitle {
        max-width: 620px;
        margin: 18px 0 0;
        color: rgba(255,255,255,0.68);
        font-size: clamp(17px, 2vw, 22px);
        line-height: 1.42;
      }
      .metrics {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
      }
      .metric {
        border-radius: calc(var(--template-radius) * 0.65);
        padding: 18px;
        background: rgba(255,255,255,0.09);
      }
      .metric strong {
        display: block;
        color: var(--brand-accent);
        font-family: var(--brand-heading-font);
        font-size: clamp(26px, 3vw, 42px);
      }
      .metric span { color: rgba(255,255,255,0.65); font-size: 13px; }
      .rail {
        display: grid;
        align-content: space-between;
        padding: clamp(24px, 4vw, 42px);
        background:
          radial-gradient(circle at 50% 18%, color-mix(in srgb, var(--brand-accent) 60%, white), transparent 30%),
          color-mix(in srgb, var(--brand-secondary) 85%, white);
        color: var(--brand-primary);
      }
      .chart {
        display: flex;
        align-items: end;
        gap: 10px;
        height: 190px;
      }
      .bar {
        flex: 1;
        border-radius: 999px 999px 10px 10px;
        background: var(--brand-primary);
      }
      .bar:nth-child(1) { height: 36%; opacity: 0.45; }
      .bar:nth-child(2) { height: 54%; opacity: 0.6; }
      .bar:nth-child(3) { height: 72%; opacity: 0.78; }
      .bar:nth-child(4) { height: 96%; background: var(--brand-accent); }
      .agenda { display: grid; gap: 12px; }
      .agenda div {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 10px;
        align-items: baseline;
      }
      .agenda strong { font-size: 12px; }
      @media (max-width: 840px) {
        .slide { grid-template-columns: 1fr; aspect-ratio: auto; }
        .metrics { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main class="slide" aria-label="Sales deck opener">
      <section class="main">
        <div class="kicker">Executive readout</div>
        <div>
          <h1>From scattered requests to repeatable revenue creative.</h1>
          <p class="subtitle">A focused opening slide for narrative decks, customer meetings, and internal launch approvals.</p>
        </div>
        <div class="metrics">
          <div class="metric"><strong>2.8x</strong><span>more versions shipped</span></div>
          <div class="metric"><strong>38%</strong><span>faster review cycles</span></div>
          <div class="metric"><strong>6</strong><span>channels covered</span></div>
        </div>
      </section>
      <aside class="rail">
        <div class="chart"><div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div></div>
        <div class="agenda">
          <div><strong>01</strong><span>Market shift</span></div>
          <div><strong>02</strong><span>Workflow gap</span></div>
          <div><strong>03</strong><span>Template system</span></div>
          <div><strong>04</strong><span>Next steps</span></div>
        </div>
      </aside>
    </main>
  </body>
</html>`;

const caseStudyHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Case Study PDF</title>
    <style>
      :root {
      /*__BRAND_TOKENS__*/
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: clamp(8px, 4vw, 44px);
        background: linear-gradient(135deg, var(--brand-bg), color-mix(in srgb, var(--brand-secondary) 70%, white));
        color: var(--brand-text);
        font-family: var(--brand-body-font);
      }
      .sheet {
        width: min(100%, 816px, calc((100vh - 24px) * 0.7727));
        aspect-ratio: 8.5 / 11;
        display: grid;
        grid-template-rows: auto 1fr auto;
        overflow: hidden;
        border-radius: var(--template-radius);
        background: var(--brand-surface);
        box-shadow: 0 28px 80px rgba(24, 18, 12, 0.24);
      }
      header {
        padding: clamp(28px, 5vw, 56px);
        background: color-mix(in srgb, var(--brand-primary) 94%, black);
        color: white;
      }
      .meta {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        color: rgba(255,255,255,0.68);
        font-size: 13px;
        font-weight: 800;
        text-transform: uppercase;
      }
      h1 {
        max-width: 640px;
        margin: 46px 0 0;
        font-family: var(--brand-heading-font);
        font-size: clamp(26px, 7vw, 82px);
        line-height: 0.92;
      }
      .body {
        display: grid;
        grid-template-columns: 0.78fr 1.22fr;
        gap: clamp(22px, 4vw, 38px);
        padding: clamp(26px, 5vw, 52px);
      }
      .metrics { display: grid; gap: 14px; align-content: start; }
      .metric {
        border-radius: calc(var(--template-radius) * 0.75);
        padding: 20px;
        background: color-mix(in srgb, var(--brand-secondary) 72%, white);
      }
      .metric strong {
        display: block;
        font-family: var(--brand-heading-font);
        font-size: clamp(30px, 4vw, 54px);
        line-height: 1;
      }
      .metric span { color: var(--brand-muted); }
      .story { display: grid; gap: 22px; }
      .story section {
        border-top: 1px solid color-mix(in srgb, var(--brand-text) 12%, transparent);
        padding-top: 18px;
      }
      h2 {
        margin: 0 0 8px;
        font-family: var(--brand-heading-font);
        font-size: clamp(19px, 2.4vw, 28px);
      }
      p { margin: 0; color: var(--brand-muted); line-height: 1.48; }
      .quote {
        border-radius: calc(var(--template-radius) * 0.75);
        padding: 24px;
        background: var(--brand-accent);
        color: var(--brand-primary);
      }
      .quote p {
        color: var(--brand-primary);
        font-family: var(--brand-heading-font);
        font-size: clamp(20px, 2.6vw, 31px);
        line-height: 1.1;
      }
      footer {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        padding: 22px clamp(26px, 5vw, 52px);
        border-top: 1px solid color-mix(in srgb, var(--brand-text) 12%, transparent);
        color: var(--brand-muted);
        font-size: 13px;
      }
      footer strong { color: var(--brand-text); }
      @media (max-width: 760px) {
        .body { grid-template-columns: 1fr; }
        footer { flex-direction: column; }
      }
      @media print {
        body { padding: 0; background: white; }
        .sheet { width: 8.5in; height: 11in; border-radius: 0; box-shadow: none; }
      }
    </style>
  </head>
  <body>
    <main class="sheet" aria-label="Case study PDF">
      <header>
        <div class="meta"><span>Customer story</span><span>PDF letter</span></div>
        <h1>How Acme reduced campaign review time by 38%.</h1>
      </header>
      <section class="body">
        <aside class="metrics">
          <div class="metric"><strong>38%</strong><span>faster creative approvals</span></div>
          <div class="metric"><strong>11</strong><span>stakeholders aligned</span></div>
          <div class="metric"><strong>4</strong><span>launch channels covered</span></div>
        </aside>
        <div class="story">
          <section>
            <h2>Challenge</h2>
            <p>The marketing team had strong messaging but rebuilt each campaign from a blank page, making brand and format choices too late in the process.</p>
          </section>
          <section>
            <h2>Solution</h2>
            <p>They moved to editable, format-specific templates with shared tokens for colors, type, radius, and spacing.</p>
          </section>
          <section>
            <h2>Results</h2>
            <p>Campaign leads reviewed clearer work sooner, designers spent less time re-making basics, and each channel shipped from the same core story.</p>
          </section>
          <div class="quote"><p>"We stopped debating the canvas and started improving the message."</p></div>
        </div>
      </section>
      <footer>
        <span><strong>Next step:</strong> Build your campaign template library</span>
        <span>brand.com/customers</span>
      </footer>
    </main>
  </body>
</html>`;

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: "launch-one-sheet",
    title: "Launch One-Sheet",
    description: "A print-ready PDF brief with editable launch copy and proof.",
    format: "PDF letter",
    kind: "one-sheet",
    filename: "launch-one-sheet.html",
    prompt:
      "Editable 8.5 x 11 marketing PDF one-sheet with brand tokens, launch headline, proof points, metrics, quote, and CTA.",
    html: oneSheetHtml,
  },
  {
    id: "paid-social-set",
    title: "Paid Social Ad Set",
    description: "Square and portrait ad artboards with fixed delivery sizes.",
    format: "1080 square + 4:5",
    kind: "social-ads",
    filename: "paid-social-ad-set.html",
    prompt:
      "Editable paid social campaign template with 1080 x 1080 and 1080 x 1350 artboards, brand tokens, headline, offer, CTA, and safe zones.",
    html: socialAdsHtml,
  },
  {
    id: "product-launch-page",
    title: "Product Launch Page",
    description: "A polished launch landing page with hero, proof, and CTA.",
    format: "Responsive web",
    kind: "launch-page",
    filename: "product-launch-page.html",
    prompt:
      "Editable responsive product launch landing page with brand tokens, headline, product visual, feature proof, testimonial, and CTA.",
    html: launchPageHtml,
  },
  {
    id: "event-invite",
    title: "Event Invite Kit",
    description: "Hero art plus RSVP copy for webinars, dinners, and launches.",
    format: "16:9 + email hero",
    kind: "event-invite",
    filename: "event-invite-kit.html",
    prompt:
      "Editable event invite kit with a 16:9 hero artboard, email-header treatment, agenda, speaker copy, date/time, and RSVP CTA.",
    html: eventInviteHtml,
  },
  {
    id: "sales-deck-opener",
    title: "Sales Deck Opener",
    description: "A 16:9 title slide with narrative, agenda, and metric proof.",
    format: "16:9 slide",
    kind: "sales-deck",
    filename: "sales-deck-opener.html",
    prompt:
      "Editable 16:9 sales deck opener with brand tokens, title, agenda, strategic proof points, metric cards, and presenter notes.",
    html: salesDeckHtml,
  },
  {
    id: "case-study-pdf",
    title: "Case Study PDF",
    description: "A customer story layout with metrics, pull quote, and CTA.",
    format: "PDF letter",
    kind: "case-study",
    filename: "case-study-pdf.html",
    prompt:
      "Editable 8.5 x 11 case study PDF template with brand tokens, customer story structure, metrics, pull quote, challenge, solution, results, and CTA.",
    html: caseStudyHtml,
  },
];
