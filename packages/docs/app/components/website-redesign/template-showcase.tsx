import {
  IconArrowUpRight,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Link } from "react-router";

import { BuilderImage } from "../builder-image";
import { BuildOnlinePopover } from "../BuilderWaitlistPopover";
import { Button } from "./ds/button";
import { ImgPlaceholder } from "./ds/img-placeholder";
import { GridInner, PageSection } from "./page-grid";

// Card is 320px wide, 260px below the 768px breakpoint (see CARD_CLASS).
// Without this the browser assumes 100vw and pulls a source several times
// larger than the slot.
const CARD_IMAGE_SIZES = "(max-width: 768px) 260px, 320px";

const CARD_CLASS = [
  "app-carousel-card group flex w-[320px] shrink-0 snap-start flex-col gap-[var(--spacing-4)] overflow-hidden bg-[var(--b-bg-page)] no-underline mobile:w-[260px]",
  "transition-[background-color] duration-150 ease-[ease] hover:bg-[var(--b-bg-raised)]",
  "not-last:border-r not-last:border-solid not-last:border-[var(--b-border-subtle)]",
].join(" ");

const CARD_ARROW_CLASS = [
  "mt-auto flex h-8 w-8 items-center justify-center rounded-[var(--b-radius)] border border-solid border-[var(--b-action-secondary-border)] bg-transparent text-[var(--b-text-primary)]",
  "transition-[background,border-color,color] duration-150 ease-[ease]",
  "group-hover:border-[var(--b-text-primary)] group-hover:bg-[var(--b-text-primary)] group-hover:text-[var(--b-bg-page)]",
].join(" ");

interface ShowcaseApp {
  slug: string;
  name: string;
  // guard:allow-required-description - the carousel card is nothing but name + description; an app with neither has no card to render
  description: string;
  // Both variants or neither -- the card falls back to a placeholder unless it
  // has final art for each theme, since a dark screenshot shown in light mode
  // reads worse than no screenshot at all.
  imageDark?: string;
  imageLight?: string;
  href: string;
}

const APPS: ShowcaseApp[] = [
  {
    slug: "clips",
    name: "Clips",
    description:
      "Screen recordings with browser debug capture, calendar-synced meeting notes, and Fn-hold voice dictation — all transcribed, summarized, and searchable, with an agent that can edit any of it.",
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F53ab0a006ca6460c801b3520d3cee3c6",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fa8c58fe985404b36aba808247d419757",
    href: "/apps/clips",
  },
  {
    slug: "design",
    name: "Design",
    description:
      "Agent-native HTML prototyping studio. Generate interactive Alpine/Tailwind designs, compare variants, refine live tweak controls, and export the result.",
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fd803cdb0e1714fae8ecccbc49c048d3c",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F731521261daf4044b1ebcec808002a35",
    href: "/apps/design",
  },
  {
    slug: "slides",
    name: "Slides",
    description:
      "Generate full presentations from a prompt. Edit visually or conversationally. AI image generation, 8 layouts, and presentation mode built in.",
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Ff9ad9cbac8dd4f2ca719a398fe4d8112",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F8268ac325c8d42f1ab9bc29da763a236",
    href: "/apps/slides",
  },
  {
    slug: "analytics",
    name: "Analytics",
    description:
      "Connect any data source, prompt for any chart, build reusable dashboards. The agent writes SQL, generates visualizations, and evolves the app.",
    imageDark:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fd60771677167437f9aa07175ac040484",
    imageLight:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fa380454478cf4e2481ae80a0984d7c41",
    href: "/apps/analytics",
  },
  {
    slug: "calendar",
    name: "Calendar",
    description:
      "Full calendar with Google sync, availability management, and a public booking page. The agent finds open slots, creates events, and manages your schedule.",
    href: "/apps/calendar",
  },
  {
    slug: "mail",
    name: "Mail",
    description:
      "Superhuman-style email client with keyboard shortcuts, AI triage, multi-account support, and email automations. Own your inbox workflow.",
    href: "/apps/mail",
  },
  {
    slug: "assets",
    name: "Assets",
    description:
      "Digital asset manager for uploads, brand libraries, searchable references, and on-brand image/video generation that other apps can call through A2A or embed as a picker.",
    href: "/apps/assets",
  },
  {
    slug: "content",
    name: "Content",
    description:
      "Edit local Markdown/MDX files like Obsidian, generate rich interactive custom blocks, and use an AI agent to draft, rewrite, and publish.",
    href: "/apps/content",
  },
];

// Matches the site header's icon-button treatment (40x40, secondary border,
// secondary hover) so the carousel controls read as part of the same system.
function CarouselIconButton({
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      className={[
        "inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[var(--b-radius)] border border-solid bg-transparent text-[var(--b-text-primary)] outline-none",
        "transition-[background,border-color] duration-150 ease-[ease]",
        "border-[var(--b-action-secondary-border)] hover:bg-[var(--b-action-secondary-hover)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]",
      ].join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TemplateShowcase() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(true);

  function updateScrollState() {
    const el = viewportRef.current;
    if (!el) return;
    setCanScrollPrev(el.scrollLeft > 4);
    setCanScrollNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  useEffect(() => {
    updateScrollState();
  }, []);

  function scrollByPage(direction: 1 | -1) {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollBy({
      left: direction * el.clientWidth * 0.9,
      behavior: "smooth",
    });
  }

  return (
    <PageSection>
      <GridInner className="flex flex-col gap-[var(--spacing-6)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
        <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
          What can you build with Agent-Native?
        </h2>
        <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
          Start with chat, a focused internal tool, or a complete
          customer-facing product. Every app gives users a UI and agents the
          tools to do the same work.
        </p>
        <div className="flex">
          <Button variant="secondary-icon" href="/apps" className="uppercase">
            Browse apps
          </Button>
        </div>
      </GridInner>

      <GridInner className="flex justify-end gap-[var(--spacing-2)] px-[var(--spacing-8)] pb-[var(--spacing-4)]">
        <CarouselIconButton
          aria-label="Scroll apps left"
          onClick={() => scrollByPage(-1)}
          disabled={!canScrollPrev}
        >
          <IconChevronLeft size={18} stroke={1.5} />
        </CarouselIconButton>
        <CarouselIconButton
          aria-label="Scroll apps right"
          onClick={() => scrollByPage(1)}
          disabled={!canScrollNext}
        >
          <IconChevronRight size={18} stroke={1.5} />
        </CarouselIconButton>
      </GridInner>

      <GridInner>
        <div
          ref={viewportRef}
          className="snap-x snap-mandatory scroll-smooth overflow-x-auto overflow-y-hidden border-x border-solid border-[var(--b-border-subtle)] [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={updateScrollState}
        >
          <div className="app-carousel-track flex w-max border-y border-solid border-[var(--b-border-subtle)]">
            {APPS.map((app) => (
              <Link key={app.slug} to={app.href} className={CARD_CLASS}>
                {/* `relative` anchors the theme-img-light overlay, which is
                    absolutely positioned so it can sit exactly on top of the
                    in-flow dark variant. */}
                <div className="relative flex aspect-[320/256] items-center justify-center overflow-hidden bg-[var(--b-bg-page)]">
                  {app.imageDark && app.imageLight ? (
                    <>
                      {/* Dark variant is the in-flow one so it establishes the
                          box; the light variant overlays it. Both stay mounted
                          with real geometry (theme-img-* toggles opacity, not
                          display) so loading="lazy" will still fetch whichever
                          one is currently hidden. */}
                      <BuilderImage
                        className="theme-img-dark relative h-full w-full object-cover"
                        src={app.imageDark}
                        alt={`${app.name} app screenshot`}
                        sizes={CARD_IMAGE_SIZES}
                        crossOrigin="anonymous"
                        loading="lazy"
                        decoding="async"
                      />
                      <BuilderImage
                        className="theme-img-light absolute inset-0 h-full w-full object-cover"
                        src={app.imageLight}
                        alt={`${app.name} app screenshot`}
                        sizes={CARD_IMAGE_SIZES}
                        crossOrigin="anonymous"
                        loading="lazy"
                        decoding="async"
                      />
                    </>
                  ) : (
                    <ImgPlaceholder
                      aspectRatio="320 / 256"
                      label=""
                      rounded={false}
                      background="var(--b-bg-raised)"
                      bordered={false}
                    />
                  )}
                </div>
                <div className="flex flex-auto flex-col items-start gap-[var(--spacing-3)] p-[var(--spacing-5)]">
                  <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-5)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]">
                    {app.name}
                  </h3>
                  <p className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.4] text-[var(--b-text-secondary)]">
                    {app.description}
                  </p>
                  <span aria-hidden="true" className={CARD_ARROW_CLASS}>
                    <IconArrowUpRight size={16} stroke={1.75} />
                  </span>
                </div>
              </Link>
            ))}
            {/* Not a <Link> like the app cards: it holds two interactive
                children of its own, and nesting those inside an anchor is
                invalid. It still lives in the track so the arrows reach it.
                Same footprint and divider as an app card so it reads as the
                last item in the rail, but its content is centred rather than
                top-aligned: it has no screenshot to anchor the top of the
                box. */}
            <div className="app-carousel-cta-card flex w-[320px] shrink-0 snap-start flex-col items-center justify-center gap-[var(--spacing-4)] border-l border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-page)] px-[var(--spacing-6)] py-[var(--spacing-8)] text-center transition-[background-color] duration-150 ease-[ease] hover:bg-[var(--b-bg-raised)] mobile:w-[260px]">
              <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-5)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]">
                Build from scratch
              </h3>
              <p className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.4] text-[var(--b-text-secondary)]">
                Use the framework guide or build online with Builder.io.
              </p>
              <div className="mt-[var(--spacing-2)] flex w-full flex-col gap-[var(--spacing-2)]">
                <BuildOnlinePopover
                  location="homepage_rail"
                  trigger={
                    <Button variant="primary" icon={null}>
                      Build online
                    </Button>
                  }
                />
                <Button variant="secondary" icon={null} href="/docs">
                  Read the docs
                </Button>
              </div>
            </div>
          </div>
        </div>
      </GridInner>
    </PageSection>
  );
}
