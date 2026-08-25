import type { CSSProperties, ReactNode } from "react";

import { GridInner, PageSection } from "./page-grid";

interface LogoEntry {
  name: string;
  label: string;
  // Real intrinsic pixel size of `src`, required alongside it so the img
  // element always has a definite size and never collapses to 0x0 while
  // loading (see width/height + no conflicting inline auto-sizing style
  // below).
  src?: string;
  srcWidth?: number;
  srcHeight?: number;
  // Uploaded logo images ship with their own built-in padding baked into
  // the asset (unlike the tight-cropped inline SVGs), so they need to fill
  // the tile instead of being capped at the shared 55% size meant for
  // vector marks.
  fill?: boolean;
  // Multiplier applied on top of the shared tile cap. Marks with a lot of
  // built-in viewBox padding (sparse icons) need to scale up; marks whose
  // viewBox tightly hugs the artwork (wordmarks, solid glyphs) need to scale
  // down, so every logo reads as roughly the same visual weight. Re-tune
  // this once each placeholder below is swapped for its real mark/image.
  scale?: number;
}

interface Logo extends LogoEntry {
  render: () => ReactNode;
}

// Placeholder while real logo art is swapped in one-by-one; replace each
// entry's `render` with the actual svg/img once the asset is provided.
function LogoPlaceholder({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 56,
        minHeight: 56,
        maxWidth: "100%",
        maxHeight: "100%",
        boxSizing: "border-box",
        border: "1px dashed var(--b-border-default)",
        borderRadius: "var(--b-radius-sm)",
        padding: "var(--spacing-1)",
        textAlign: "center",
        fontFamily: "var(--b-font-mono)",
        fontSize: "var(--b-t-label-3)",
        lineHeight: 1.2,
        color: "var(--b-text-secondary)",
        overflow: "hidden",
      }}
    >
      {label}
    </div>
  );
}

const LOGO_ENTRIES: LogoEntry[] = [
  {
    name: "anthropic",
    label: "Anthropic",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F598785896ec84d1daecd7086d7890ab3",
    srcWidth: 552,
    srcHeight: 552,
    fill: true,
  },
  {
    name: "ChatGPT_logo",
    label: "ChatGPT",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F2297fccd17bf4fc198c841ecaf9657b5",
    srcWidth: 552,
    srcHeight: 575,
    fill: true,
  },
  {
    name: "Vercel",
    label: "Vercel",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9346ea650bed42e0bb520265445dee13",
    srcWidth: 552,
    srcHeight: 568,
    fill: true,
  },
  {
    name: "gitlab",
    label: "GitLab",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fb3094a8cde534489a49005169ac58d33",
    srcWidth: 552,
    srcHeight: 552,
    fill: true,
  },
  {
    name: "n8n",
    label: "n8n",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F2deab5932bff462b9aac8bbdcec72bb9",
    srcWidth: 552,
    srcHeight: 574,
    fill: true,
  },
  {
    name: "linear",
    label: "Linear",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fa85e87412c594b4292498e407a8d4ebb",
    srcWidth: 552,
    srcHeight: 563,
    fill: true,
  },
  { name: "contentful", label: "Contentful" },
  {
    name: "github",
    label: "GitHub",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F7d3c6b5905c34adda2220492f16005de",
    srcWidth: 552,
    srcHeight: 556,
    fill: true,
  },
  { name: "PayPal-Monogram-FullColor-RGB", label: "PayPal" },
  { name: "figma", label: "Figma" },
  { name: "Slack_Technologies_Logo", label: "Slack" },
  { name: "stripe", label: "Stripe" },
  { name: "Box,_Inc._logo", label: "Box" },
  { name: "supabase-logo-icon", label: "Supabase" },
  { name: "hubspot-blob", label: "HubSpot" },
  { name: "dropbox-blue", label: "Dropbox" },
  { name: "sentry", label: "Sentry" },
  { name: "canva-icon", label: "Canva" },
  {
    name: "zapier-logomark",
    label: "Zapier",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fc58a7541bca949a0a60cffbc41abec24",
    srcWidth: 552,
    srcHeight: 574,
    fill: true,
  },
  { name: "hubspot", label: "HubSpot" },
  {
    name: "notion",
    label: "Notion",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6a3e4c053cc447e493ff43cec054b490",
    srcWidth: 552,
    srcHeight: 562,
    fill: true,
  },
  { name: "Netlify_idmPWmzPWc_1", label: "Netlify" },
  { name: "context7", label: "context7" },
  {
    name: "coral-circles",
    label: "Builder",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F1122e0c46c6740f8bfe9e9fcb77c7774",
    srcWidth: 552,
    srcHeight: 568,
    fill: true,
  },
  { name: "Linear logo 113", label: "Linear" },
  {
    name: "target-mark",
    label: "Granola",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fdb629eeedd4a4304876c0d9230984469",
    srcWidth: 552,
    srcHeight: 563,
    fill: true,
  },
  {
    name: "webflow",
    label: "Webflow",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F62041693ed1e41889c493a9c1de2d628",
    srcWidth: 552,
    srcHeight: 552,
    fill: true,
  },
  { name: "app-grid-mark", label: "app-grid-mark" },
  { name: "CF-Logo", label: "Cloudflare" },
  { name: "asana", label: "Asana" },
];

const LOGOS: Logo[] = LOGO_ENTRIES.map((entry) => ({
  ...entry,
  render: () =>
    entry.src ? (
      <img
        src={entry.src}
        alt=""
        width={entry.srcWidth}
        height={entry.srcHeight}
        loading="lazy"
        decoding="async"
        className={entry.fill ? "logo-tile-img-fill" : undefined}
      />
    ) : (
      <LogoPlaceholder label={entry.label} />
    ),
}));

export function WorksWithStack() {
  return (
    <PageSection>
      <GridInner
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--spacing-6)",
          padding: "var(--spacing-40) var(--spacing-8) var(--spacing-20)",
          borderTop: "1px solid var(--b-border-default)",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--b-font-sans)",
            fontSize: "var(--b-t-heading-2)",
            fontWeight: 500,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            color: "var(--b-text-primary)",
          }}
        >
          Works with your stack
        </h2>
        <p
          style={{
            margin: 0,
            maxWidth: 633,
            fontFamily: "var(--b-font-sans)",
            fontSize: "var(--b-t-paragraph-2)",
            lineHeight: 1.4,
            color: "var(--b-text-secondary)",
          }}
        >
          Bring your LLM, database, tools, and infrastructure, Agent Native is
          open source TypeScript, so your application stays yours.
        </p>
      </GridInner>

      <GridInner style={{ background: "var(--b-bg-page)" }}>
        <div className="logos-grid">
          {LOGOS.map((logo) => (
            <div
              key={logo.name}
              className="logo-tile"
              aria-label={logo.name}
              role="img"
            >
              <div
                className="logo-scale-wrap"
                style={{ "--logo-scale": logo.scale ?? 1 } as CSSProperties}
              >
                {logo.render()}
              </div>
            </div>
          ))}
        </div>
      </GridInner>
    </PageSection>
  );
}
