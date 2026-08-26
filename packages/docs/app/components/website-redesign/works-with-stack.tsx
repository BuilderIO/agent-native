import { IconArrowUpRight } from "@tabler/icons-react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";

import { BuilderImage } from "../builder-image";
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
    <div className="box-border flex max-h-full min-h-14 max-w-full min-w-14 items-center justify-center overflow-hidden rounded-[var(--b-radius-sm)] border border-dashed border-[var(--b-border-default)] p-[var(--spacing-1)] text-center font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-3)] leading-[1.2] text-[var(--b-text-secondary)]">
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
    name: "Gemini",
    label: "Gemini",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F3bd19482cf8e4c35be1b3cd41f8be6ec",
    srcWidth: 552,
    srcHeight: 552,
    fill: true,
  },
  {
    name: "github",
    label: "GitHub",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F74fc1b966afa4f1081770ecd25455819",
    srcWidth: 552,
    srcHeight: 556,
    fill: true,
  },
  {
    name: "CF-Logo",
    label: "Cloudflare",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fa6a460b41d5b46e0b971ea559006d09e",
    srcWidth: 552,
    srcHeight: 552,
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
    name: "notion",
    label: "Notion",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6a3e4c053cc447e493ff43cec054b490",
    srcWidth: 552,
    srcHeight: 562,
    fill: true,
  },
  {
    name: "coral-circles",
    label: "Builder",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F133a8e3ebbd54e18aa55730045239cbb",
    srcWidth: 552,
    srcHeight: 568,
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
  {
    name: "n8n",
    label: "n8n",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F2deab5932bff462b9aac8bbdcec72bb9",
    srcWidth: 552,
    srcHeight: 574,
    fill: true,
  },
  {
    name: "Slack_Technologies_Logo",
    label: "Slack",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9e900a42e5ea411eb230e28786a25ef1",
    srcWidth: 552,
    srcHeight: 562,
    fill: true,
  },
  {
    name: "supabase-logo-icon",
    label: "Supabase",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F926627f4baee4fca894fc672ebb684df",
    srcWidth: 552,
    srcHeight: 563,
    fill: true,
  },
  {
    name: "target-mark",
    label: "Granola",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fdb629eeedd4a4304876c0d9230984469",
    srcWidth: 552,
    srcHeight: 563,
    fill: true,
  },
  {
    name: "Netlify_idmPWmzPWc_1",
    label: "Netlify",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F42d5e1951b194c4bb62ce5e44b62e6e2",
    srcWidth: 552,
    srcHeight: 557,
    fill: true,
  },
  {
    name: "Box,_Inc._logo",
    label: "Box",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Ffad235b6ed2b443e8a67ae4fd91b8f60",
    srcWidth: 552,
    srcHeight: 557,
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
    name: "hubspot-blob",
    label: "HubSpot",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F82b86304b23b463eae2477ed660f194e",
    srcWidth: 552,
    srcHeight: 568,
    fill: true,
  },
  {
    name: "unknown-rings",
    label: "unknown-rings",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F1d618bfba92044c7935c74f9f7e34332",
    srcWidth: 569,
    srcHeight: 552,
    fill: true,
  },
  {
    name: "figma",
    label: "Figma",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fd3787257de754c7598988b427eb9766c",
    srcWidth: 552,
    srcHeight: 584,
    fill: true,
  },
  {
    name: "Atlassian",
    label: "Atlassian",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F322a2b6e185e4ff1906ab10c87c88451",
    srcWidth: 552,
    srcHeight: 563,
    fill: true,
  },
  {
    name: "sentry",
    label: "Sentry",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F986416f4b86b44d1aa747f9bc2214e3c",
    srcWidth: 552,
    srcHeight: 568,
    fill: true,
  },
  {
    name: "zapier-logomark",
    label: "Zapier",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F15e326ef656d429fb65c14c67f68bf31",
    srcWidth: 552,
    srcHeight: 574,
    fill: true,
  },
  {
    name: "context7",
    label: "context7",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Ff3f58f923a6f453e88c858d8115688c4",
    srcWidth: 552,
    srcHeight: 552,
    fill: true,
  },
  {
    name: "asana",
    label: "Asana",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F393fbf832ca1402a9f61948d9c6838f1",
    srcWidth: 552,
    srcHeight: 552,
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
  {
    name: "Intercom",
    label: "Intercom",
    src: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4e2330c799b348e99bc80cb1e27148ea",
    srcWidth: 552,
    srcHeight: 552,
    fill: true,
  },
];

// Each logo ships with its own intrinsic SVG/img dimensions, so without a
// shared cap they render at wildly different visual sizes next to each other
// at every breakpoint, not just mobile. mix-blend-mode lives here (on the
// marks) rather than on the grid container — blending the container blended
// its own border against the page background too, which showed up as a
// doubled/ghosted line at the grid's right edge.
const LOGO_IMG_CLASS =
  "h-auto w-auto mix-blend-luminosity max-h-[55%] max-w-[55%]";

// Uploaded logo assets ship with their own built-in padding, unlike the
// tight-cropped inline SVGs, so they fill the tile instead of being capped.
const LOGO_IMG_FILL_CLASS =
  "h-auto w-auto mix-blend-luminosity max-h-full max-w-full";

const LOGO_TILE_CLASS = [
  "flex aspect-square items-center justify-center overflow-hidden p-[var(--spacing-4)] box-border",
  // Monochrome marks use fill="currentColor" instead of a hardcoded white so
  // they stay visible against --b-bg-page in both themes, rather than
  // disappearing once the light theme makes the page background near-white.
  "text-[var(--b-text-primary)]",
].join(" ");

const LOGOS: Logo[] = LOGO_ENTRIES.map((entry) => ({
  ...entry,
  render: () =>
    entry.src ? (
      <BuilderImage
        src={entry.src}
        alt=""
        width={entry.srcWidth}
        height={entry.srcHeight}
        crossOrigin="anonymous"
        sizes="(max-width: 768px) 17vw, (max-width: 1400px) 11vw, 156px"
        loading="lazy"
        decoding="async"
        className={entry.fill ? LOGO_IMG_FILL_CLASS : LOGO_IMG_CLASS}
      />
    ) : (
      <LogoPlaceholder label={entry.label} />
    ),
}));

export function WorksWithStack() {
  return (
    <PageSection>
      <GridInner className="flex flex-col gap-[var(--spacing-6)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
        <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
          Works with your stack
        </h2>
        <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
          Bring your LLM, database, tools, and infrastructure, Agent Native is
          open source TypeScript, so your application stays yours.
        </p>
      </GridInner>

      <GridInner className="bg-[var(--b-bg-page)]">
        <div className="grid grid-cols-9 border border-solid border-[var(--b-border-subtle)] mobile:grid-cols-6">
          {LOGOS.map((logo) => (
            <div
              key={logo.name}
              className={LOGO_TILE_CLASS}
              aria-label={logo.name}
              role="img"
            >
              {/* The per-logo multipliers were tuned by eye against the mobile
                  6-column layout, so the scale only applies there — the
                  9-column desktop grid needs the shared cap but not this
                  additional per-mark nudging. */}
              <div
                className="flex items-center justify-center mobile:scale-[var(--logo-scale,1)]"
                style={{ "--logo-scale": logo.scale ?? 1 } as CSSProperties}
              >
                {logo.render()}
              </div>
            </div>
          ))}
          <Link
            to="/apps"
            aria-label="Explore apps built with Agent-Native"
            className={`${LOGO_TILE_CLASS} group no-underline`}
          >
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[var(--b-radius)] border border-solid border-[var(--b-action-secondary-border)] bg-transparent text-[var(--b-text-primary)] transition-[background,border-color,color] duration-150 ease-[ease] group-hover:border-[var(--b-text-primary)] group-hover:bg-[var(--b-text-primary)] group-hover:text-[var(--b-bg-page)] narrow:h-11 narrow:w-11">
              <IconArrowUpRight size={40} stroke={1.75} />
            </span>
          </Link>
        </div>
      </GridInner>
    </PageSection>
  );
}
