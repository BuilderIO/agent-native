import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale } from "@agent-native/core/client/i18n";
import {
  mcpIntegrationLogo,
  mcpIntegrationLogoNeedsDarkModeFilter,
} from "@agent-native/core/client/resources/mcp-integration-logos";
import {
  IconArrowUpRight,
  IconChartBar,
  IconChecklist,
  IconFileText,
  IconPalette,
  IconPlus,
  IconPresentation,
  IconVideo,
  type TablerIcon,
} from "@tabler/icons-react";
import { Fragment, useEffect, type ReactNode } from "react";
import { Link } from "react-router";

import {
  CATEGORY_NAMES,
  type UseCasePageV2 as Page,
} from "../../../lib/campaign-content";
import { BuilderImage } from "../builder-image";
import { firstPartyAppUrl } from "../deployment-links";
import { AppStatusBadge } from "../website-redesign/ds/app-status-badge";
import { ContentCard } from "../website-redesign/ds/content-card";
import { FaqAccordion } from "../website-redesign/ds/faq-accordion";
import { GridInner, PageSection } from "../website-redesign/page-grid";
import { campaignHref } from "./public-content";
import { JsonLd, faqSchema } from "./shared";

const SITE_ORIGIN = "https://www.agent-native.com";
const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

const HEADING_CLASS =
  "m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]";
const SECTION_HEAD_CLASS =
  "flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]";
const LINK_CLASS =
  "text-[var(--b-text-primary)] underline decoration-[var(--b-border-default)] underline-offset-[3px] transition-[text-decoration-color] duration-150 hover:decoration-[var(--b-text-primary)]";
const APP_ICONS: Record<Page["app"], TablerIcon> = {
  clips: IconVideo,
  design: IconPalette,
  slides: IconPresentation,
  plans: IconChecklist,
  analytics: IconChartBar,
  content: IconFileText,
};
const CARD_GRID_CLASS =
  "grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-2 narrow:grid-cols-1";

// Content is written with absolute www.agent-native.com links so drafts work
// anywhere; on the site they become root-relative so locales and client-side
// navigation apply.
function sitePath(url: string): string {
  return url.startsWith(`${SITE_ORIGIN}/`)
    ? url.slice(SITE_ORIGIN.length)
    : url;
}

function plainText(text: string): string {
  return text.replace(LINK, "$1");
}

function InlineText({ text }: { text: string }) {
  const { locale } = useLocale();
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const [whole, label, url] = match as unknown as [string, string, string];
    parts.push(text.slice(last, match.index));
    const href = sitePath(url);
    parts.push(
      href.startsWith("/") ? (
        <Link
          key={match.index}
          to={campaignHref(href, locale)}
          className={LINK_CLASS}
        >
          {label}
        </Link>
      ) : (
        <a
          key={match.index}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_CLASS}
        >
          {label}
        </a>
      ),
    );
    last = match.index + whole.length;
  }
  parts.push(text.slice(last));
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}

function ThemedImage({
  image,
  sizes,
  priority = false,
}: {
  image: Page["hero"]["image"];
  sizes: string;
  priority?: boolean;
}) {
  const loading = priority ? "eager" : "lazy";
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-raised)]">
      <BuilderImage
        src={image.dark}
        alt={image.alt}
        sizes={sizes}
        loading={loading}
        className="theme-img-dark absolute inset-0 block h-full w-full object-cover"
      />
      <BuilderImage
        src={image.light}
        alt=""
        aria-hidden="true"
        sizes={sizes}
        loading={loading}
        className="theme-img-light absolute inset-0 block h-full w-full object-cover"
      />
    </div>
  );
}

// Tools the in-app logo set doesn't cover, served from public/integration-logos.
const SITE_LOGOS: Record<string, string> = {
  "google-docs": "/integration-logos/google-docs.png",
  "google-drive": "/integration-logos/google-drive.png",
  "google-slides": "/integration-logos/google-slides.png",
  word: "/integration-logos/word.png",
  powerpoint: "/integration-logos/powerpoint.png",
  pdf: "/integration-logos/pdf.svg",
};

// Logos run one after another; the product name is the alt text. A tool the
// logo set doesn't have yet shows its name instead, so a missing logo is
// visible rather than an empty gap.
function ToolLogo({ name }: { name: string }) {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const src = SITE_LOGOS[id] ?? mcpIntegrationLogo(id);
  if (!src) {
    return (
      <span className="font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-label-1)] font-medium text-[var(--b-text-primary)]">
        {name}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      title={name}
      width={28}
      height={28}
      className={`size-7 object-contain ${
        mcpIntegrationLogoNeedsDarkModeFilter(id)
          ? "invert [.light_&]:invert-0"
          : ""
      }`}
    />
  );
}

function SectionHead({ heading }: { heading: string }) {
  return (
    <PageSection>
      <GridInner className={SECTION_HEAD_CLASS}>
        <h2 className={HEADING_CLASS}>{heading}</h2>
      </GridInner>
    </PageSection>
  );
}

export function UseCasePageV2({ page }: { page: Page }) {
  const appId = page.app === "plans" ? "plan" : page.app;
  const AppIcon = APP_ICONS[page.app];
  const ctaHref = firstPartyAppUrl(page.hero.button.url);

  useEffect(() => {
    trackEvent("use_case_view", { slug: page.slug, app: page.app });
  }, [page.slug, page.app]);

  const faqs = page.faqs.items;

  return (
    <div className="builder-brand-tokens">
      <JsonLd
        value={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: page.seo_title,
          description: page.meta_description,
          dateModified: page.updated,
        }}
      />
      <JsonLd
        value={faqSchema(
          faqs.map(({ q, a }) => ({ q: plainText(q), a: plainText(a) })),
        )}
      />

      <PageSection>
        <GridInner className="flex flex-col items-center gap-[var(--spacing-6)] px-[var(--spacing-8)] pt-[var(--spacing-30)] pb-[var(--spacing-20)] text-center">
          <span className="inline-flex items-center gap-[var(--spacing-2)] rounded-full border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-page)] py-[6px] ps-[12px] pe-[8px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-label-1)] font-medium text-[var(--b-text-primary)]">
            <AppIcon size={16} stroke={1.75} aria-hidden="true" />
            {CATEGORY_NAMES[page.app]}
            <AppStatusBadge appId={appId} />
          </span>
          <h1 className="m-0 max-w-[760px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-1)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {page.title}
          </h1>
          <p className="m-0 max-w-[600px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            <InlineText text={page.hero.body} />
          </p>
          <a
            href={ctaHref}
            target="_blank"
            rel="noopener noreferrer"
            className="primary-button mt-[var(--spacing-2)]"
            style={{ gap: "4px" }}
            onClick={() =>
              trackEvent("use_case_cta_click", {
                slug: page.slug,
                app: page.app,
                location: "hero",
              })
            }
          >
            {page.hero.button.label}
            <IconArrowUpRight size={16} />
          </a>
        </GridInner>
        <GridInner className="border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-10)] py-[var(--spacing-20)]">
          <ThemedImage
            image={page.hero.image}
            sizes="(min-width: 1300px) 1220px, 100vw"
            priority
          />
        </GridInner>
      </PageSection>

      <SectionHead heading={page.how_to.heading} />
      <PageSection showGrid={false}>
        <GridInner>
          <ol className="m-0 flex list-none flex-col border-t border-x border-solid border-[var(--b-border-subtle)] p-0">
            {page.how_to.steps.map((step, index) => {
              const textFirst = index % 2 === 0;
              return (
                <li
                  key={step.title}
                  className="grid border-t border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-page)] first:border-t-0 lg:grid-cols-3"
                >
                  <div
                    className={`flex flex-col justify-center gap-[var(--spacing-3)] p-[var(--spacing-8)] lg:p-[var(--spacing-12)] ${
                      textFirst ? "" : "lg:order-2"
                    }`}
                  >
                    <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-4)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]">
                      {step.title}
                    </h3>
                    <p className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
                      <InlineText text={step.body} />
                    </p>
                  </div>
                  <div
                    className={`flex items-center border-solid border-[var(--b-border-subtle)] px-[var(--spacing-8)] pb-[var(--spacing-8)] lg:col-span-2 lg:px-[var(--spacing-10)] lg:py-[var(--spacing-30)] ${
                      textFirst ? "lg:border-s" : "lg:order-1 lg:border-e"
                    }`}
                  >
                    <ThemedImage
                      image={step.image}
                      sizes="(min-width: 1300px) 790px, 100vw"
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        </GridInner>
      </PageSection>
      <SectionHead heading={page.features.heading} />
      {/* The card grid draws its own dividers, so the three-column overlay is
          off here; leaving it on would double every line. */}
      <PageSection showGrid={false}>
        <GridInner>
          <div className={CARD_GRID_CLASS}>
            {page.features.items.map((feature) => (
              <ContentCard
                key={feature.title}
                title={feature.title}
                body={feature.body}
              />
            ))}
          </div>
        </GridInner>
      </PageSection>

      <SectionHead heading={page.integrations.heading} />
      <PageSection showGrid={false}>
        <GridInner>
          <div className={CARD_GRID_CLASS}>
            {page.integrations.cards.map((card) => (
              <ContentCard
                key={card.title}
                eyebrow={
                  <div className="mb-[var(--spacing-6)] flex min-h-7 flex-wrap items-center gap-[var(--spacing-4)]">
                    {card.logos.map((name) => (
                      <ToolLogo key={name} name={name} />
                    ))}
                    {card.more ? (
                      <span
                        aria-hidden="true"
                        className="flex size-7 items-center justify-center rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] text-[var(--b-text-secondary)]"
                      >
                        <IconPlus size={16} stroke={1.75} />
                      </span>
                    ) : null}
                  </div>
                }
                title={card.title}
                body={card.body}
              />
            ))}
          </div>
        </GridInner>
      </PageSection>

      {page.other_uses ? (
        <>
          <SectionHead heading={page.other_uses.heading} />
          <PageSection showGrid={false}>
            <GridInner>
              <div className={CARD_GRID_CLASS}>
                {page.other_uses.cards.map((card) => (
                  <ContentCard
                    key={card.url}
                    title={card.title}
                    body={card.body}
                    href={sitePath(card.url)}
                  />
                ))}
              </div>
            </GridInner>
          </PageSection>
        </>
      ) : null}

      {/* The open question's background covers the grid overlay's edge
          lines, so the FAQ draws its own side borders. */}
      <PageSection className="pt-[var(--spacing-40)] pb-[var(--spacing-40)]">
        <GridInner className="border border-solid border-[var(--b-border-default)] border-x-[var(--b-border-subtle)]">
          <FaqAccordion
            idPrefix={`${page.slug}-faq`}
            title={page.faqs.heading}
            items={faqs.map((item, index) => ({
              id: `q${index + 1}`,
              question: item.q,
              answer: (
                <p className="m-0">
                  <InlineText text={item.a} />
                </p>
              ),
            }))}
          />
        </GridInner>
      </PageSection>
    </div>
  );
}
