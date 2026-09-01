import { useLocale, useT } from "@agent-native/core/client/i18n";
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
import { sitePathForLocale } from "../docs-locale";
import { APP_ART } from "./app-art";
import { Button } from "./ds/button";
import { CardArrow } from "./ds/card-arrow";
import { ImgPlaceholder } from "./ds/img-placeholder";
import { GridInner, PageSection } from "./page-grid";

// Card is 433px wide (roughly a third of the 1300px site max width, so
// three cards fill the rail), 320px below the 768px breakpoint (see
// CARD_CLASS). Without this the browser assumes 100vw and pulls a source
// several times larger than the slot.
const CARD_IMAGE_SIZES = "(max-width: 768px) 320px, 433px";

const CARD_CLASS = [
  "app-carousel-card group flex w-[433px] shrink-0 snap-start flex-col gap-[var(--spacing-4)] overflow-hidden bg-[var(--b-bg-page)] no-underline mobile:w-[320px]",
  "transition-[background-color] duration-150 ease-[ease] hover:bg-[var(--b-bg-raised)]",
  "not-last:border-r not-last:border-solid not-last:border-[var(--b-border-subtle)]",
].join(" ");

interface ShowcaseApp {
  // Also the catalog id: the card copy comes from templates.<slug>.description,
  // which the app catalog pages already translate, and the art comes from
  // APP_ART under the same key.
  slug: string;
  name: string;
  href: string;
}

const APPS: ShowcaseApp[] = [
  { slug: "clips", name: "Clips", href: "/apps/clips" },
  { slug: "design", name: "Design", href: "/apps/design" },
  { slug: "slides", name: "Slides", href: "/apps/slides" },
  { slug: "analytics", name: "Analytics", href: "/apps/analytics" },
  { slug: "calendar", name: "Calendar", href: "/apps/calendar" },
  { slug: "mail", name: "Mail", href: "/apps/mail" },
  { slug: "assets", name: "Assets", href: "/apps/assets" },
  { slug: "content", name: "Content", href: "/apps/content" },
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
  const t = useT();
  const { locale } = useLocale();
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
          {t("homepage.showcase.title").replace("Agent-Native", "Agent‑Native")}
        </h2>
        <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
          {t("homepage.showcase.body")}
        </p>
        <div className="flex">
          {/* `white` carries no `-icon` suffix, so the arrow the old
              secondary-icon variant added by default has to be passed. */}
          <Button
            variant="white"
            icon={IconArrowUpRight}
            href={sitePathForLocale("/apps", locale)}
            className="uppercase"
          >
            {t("homepage.showcase.browseApps")}
          </Button>
        </div>
      </GridInner>

      <GridInner className="flex justify-end gap-[var(--spacing-2)] px-[var(--spacing-8)] pb-[var(--spacing-4)]">
        <CarouselIconButton
          aria-label={t("homepage.showcase.scrollLeft")}
          onClick={() => scrollByPage(-1)}
          disabled={!canScrollPrev}
        >
          <IconChevronLeft size={18} stroke={1.5} />
        </CarouselIconButton>
        <CarouselIconButton
          aria-label={t("homepage.showcase.scrollRight")}
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
            {APPS.map((app) => {
              const art = APP_ART[app.slug];
              return (
                <Link
                  key={app.slug}
                  to={sitePathForLocale(app.href, locale)}
                  className={CARD_CLASS}
                >
                  {/* `relative` anchors the theme-img-light overlay, which is
                    absolutely positioned so it can sit exactly on top of the
                    in-flow dark variant. */}
                  <div className="relative flex aspect-[320/256] items-center justify-center overflow-hidden bg-[var(--b-bg-page)]">
                    {art ? (
                      <>
                        {/* Dark variant is the in-flow one so it establishes the
                          box; the light variant overlays it. Both stay mounted
                          with real geometry (theme-img-* toggles opacity, not
                          display) so loading="lazy" will still fetch whichever
                          one is currently hidden. */}
                        <BuilderImage
                          className="theme-img-dark relative h-full w-full object-cover"
                          src={art.imageDark}
                          alt={t("templateCard.screenshotAlt", {
                            name: app.name,
                          })}
                          sizes={CARD_IMAGE_SIZES}
                          crossOrigin="anonymous"
                          loading="lazy"
                          decoding="async"
                        />
                        <BuilderImage
                          className="theme-img-light absolute inset-0 h-full w-full object-cover"
                          src={art.imageLight}
                          alt={t("templateCard.screenshotAlt", {
                            name: app.name,
                          })}
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
                      {t(`templates.${app.slug}.description`)}
                    </p>
                    <CardArrow />
                  </div>
                </Link>
              );
            })}
            {/* Not a <Link> like the app cards: it holds two interactive
                children of its own, and nesting those inside an anchor is
                invalid. It still lives in the track so the arrows reach it.
                Same footprint and divider as an app card so it reads as the
                last item in the rail, but vertically centred rather than
                top-aligned: it has no screenshot to anchor the top of the
                box. Horizontal padding matches the app cards' text block so
                the left edge of the copy lines up across the rail, and it is
                what buys the two buttons room to sit on one line. */}
            <div className="app-carousel-cta-card flex w-[433px] shrink-0 snap-start flex-col items-start justify-center gap-[var(--spacing-4)] border-l border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-page)] px-[var(--spacing-5)] py-[var(--spacing-8)] text-left transition-[background-color] duration-150 ease-[ease] hover:bg-[var(--b-bg-raised)] mobile:w-[320px]">
              <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-5)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]">
                {t("buildFromScratch.title")}
              </h3>
              <p className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.4] text-[var(--b-text-secondary)]">
                {t("buildFromScratch.description")}
              </p>
              {/* Wraps rather than shrinks: the labels are whitespace-nowrap,
                  so on the narrower mobile card they stack instead of
                  overflowing the card. */}
              <div className="mt-[var(--spacing-2)] flex flex-wrap gap-[var(--spacing-2)]">
                <BuildOnlinePopover
                  location="homepage_rail"
                  trigger={
                    // Caps come from CSS, not the label: an all-caps string
                    // becomes the accessible name and screen readers spell it
                    // out letter by letter.
                    <Button
                      variant="white"
                      icon={null}
                      compact
                      className="uppercase"
                    >
                      {t("buildFromScratch.buildOnline")}
                    </Button>
                  }
                />
                <Button
                  variant="secondary"
                  icon={null}
                  compact
                  href={sitePathForLocale("/docs", locale)}
                  className="uppercase"
                >
                  {t("buildFromScratch.readDocs")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </GridInner>
    </PageSection>
  );
}
