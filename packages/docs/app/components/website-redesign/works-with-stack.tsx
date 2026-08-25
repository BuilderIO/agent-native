import type { CSSProperties, ReactNode } from "react";

import { GridInner, PageSection } from "./page-grid";

interface Logo {
  name: string;
  label: string;
  render: () => ReactNode;
  // Multiplier applied on top of the shared tile cap. Marks with a lot of
  // built-in viewBox padding (sparse icons) need to scale up; marks whose
  // viewBox tightly hugs the artwork (wordmarks, solid glyphs) need to scale
  // down, so every logo reads as roughly the same visual weight. Re-tune
  // this once each placeholder below is swapped for its real mark/image.
  scale?: number;
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
        width: "100%",
        height: "100%",
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

const LOGOS: Logo[] = [
  { name: "anthropic", label: "Anthropic" },
  { name: "ChatGPT_logo", label: "ChatGPT" },
  { name: "Vercel", label: "Vercel" },
  { name: "gitlab", label: "GitLab" },
  { name: "n8n", label: "n8n" },
  { name: "linear", label: "Linear" },
  { name: "contentful", label: "Contentful" },
  { name: "github", label: "GitHub" },
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
  { name: "zapier-logomark", label: "Zapier" },
  { name: "hubspot", label: "HubSpot" },
  { name: "notion", label: "Notion" },
  { name: "Netlify_idmPWmzPWc_1", label: "Netlify" },
  { name: "context7", label: "context7" },
  { name: "coral-circles", label: "coral-circles" },
  { name: "Linear logo 113", label: "Linear" },
  { name: "target-mark", label: "target-mark" },
  { name: "webflow", label: "Webflow" },
  { name: "app-grid-mark", label: "app-grid-mark" },
  { name: "CF-Logo", label: "Cloudflare" },
  { name: "asana", label: "Asana" },
].map((entry) => ({
  ...entry,
  render: () => <LogoPlaceholder label={entry.label} />,
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
