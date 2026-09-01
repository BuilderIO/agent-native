import { useLocale, useT } from "@agent-native/core/client/i18n";

import { BuildFromScratchCta } from "../components/BuildFromScratchCta";
import {
  COMMUNITY_APP_SUBMISSION_URL,
  communityApps,
} from "../components/community-apps";
import { CommunityAppCard } from "../components/CommunityAppCard";
import { CommunityAppSubmissionForm } from "../components/CommunityAppSubmissionForm";
import { sitePathForLocale } from "../components/docs-locale";
import { featuredTemplates, TemplateCard } from "../components/TemplateCard";
import {
  GridInner,
  PageSection,
} from "../components/website-redesign/page-grid";

// Every section heading on this page shares one size. 32px falls between
// --b-t-heading-3 (37px) and --b-t-heading-4 (28px), so it is spelled out
// rather than taken from the scale — which also means it does not shrink at the
// mobile breakpoint the way the scale tokens do.
const SECTION_HEADING_CLASS =
  "font-[family-name:var(--b-font-sans)] text-[32px] font-medium leading-[1.1] tracking-[-0.02em] text-[var(--b-text-primary)]";

export default function TemplatesPage() {
  const t = useT();
  const { locale } = useLocale();

  return (
    <div className="builder-brand-tokens min-h-screen">
      {/* One section for the whole page rather than one per band: the
          decoration is absolutely positioned across its section's full height,
          so a single wrapper draws the column rules unbroken from the header to
          the footer. GridInner keeps the content on the same max-w-site measure
          the rules are drawn on. */}
      <PageSection as="main" className="templates-index-page">
        <GridInner className="min-w-0 px-4 pb-24 pt-20 sm:px-6 lg:pt-[200px]">
          <header className="max-w-[805px]">
            <h1 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.03em] text-[var(--b-text-primary)]">
              {t("templatesPage.title")}
            </h1>
            <p className="mt-5 mb-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
              {t("templatesPage.eyebrow")}{" "}
              <span className="text-[var(--b-text-primary)]">
                {t("templatesPage.body")}
              </span>
            </p>
          </header>

          {/* The section breaks out of the page's horizontal padding so its top
              rule spans the full content measure, then restores that padding so
              the heading still lines up with the page header above it. */}
          <section
            className="-mx-4 mt-16 border-t border-solid border-[var(--b-border-default)] px-4 sm:-mx-6 sm:px-6"
            aria-labelledby="first-party-apps-heading"
          >
            {/* Carries the section's top padding so its fill covers the
                decorative column rules for the whole heading band, leaving no
                stub of rule between the top rule and the card band. The
                negative margin and the padding cancel out, so the heading text
                stays on the same measure as the page header. */}
            <div className="-mx-[15px] bg-[var(--b-bg-page)] px-[15px] pt-16 pb-6 sm:-mx-[23px] sm:px-[23px]">
              <h2
                id="first-party-apps-heading"
                className={`m-0 ${SECTION_HEADING_CLASS}`}
              >
                {t("templatesPage.firstPartyTitle")}
              </h2>
            </div>
            {/* Breaks back out of the section's padding, but stops 1px short of
                the full measure at each breakpoint: the page's decorative
                column rules are drawn as a border inside that measure, and this
                band's own background would otherwise paint over them for its
                whole height. */}
            <div className="-mx-[15px] grid min-w-0 gap-5 border-b border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-page)] p-5 sm:-mx-[23px] sm:grid-cols-2 lg:grid-cols-3">
              {featuredTemplates.map((template) => (
                <TemplateCard key={template.name} template={template} />
              ))}
              <div className="flex min-h-full items-center border border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-page)] p-1 transition-[background-color] duration-150 hover:bg-[var(--b-bg-raised)]">
                <BuildFromScratchCta
                  location="templates_index"
                  variant="grid"
                />
              </div>
            </div>
          </section>

          {/* Same shape as the first-party section above: break out of the page
              padding so the top rule spans the full measure, then restore it so
              the heading stays aligned with the rest of the page. */}
          <section
            className="-mx-4 mt-24 border-t border-solid border-[var(--b-border-default)] px-4 sm:-mx-6 sm:px-6"
            aria-labelledby="community-apps-heading"
          >
            {/* Same opaque heading band as the first-party section above. */}
            <div className="-mx-[15px] bg-[var(--b-bg-page)] px-[15px] pt-16 pb-6 sm:-mx-[23px] sm:px-[23px]">
              <div className="max-w-[720px]">
                <h2
                  id="community-apps-heading"
                  className={`m-0 ${SECTION_HEADING_CLASS}`}
                >
                  {t("templatesPage.communityTitle")}
                </h2>
                <p className="mt-4 mb-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
                  {t("templatesPage.communityDescription")}
                </p>
              </div>
            </div>

            {communityApps.length > 0 ? (
              // Matches the first-party band, including the 1px inset that
              // keeps this fill from painting over the decorative column rules.
              <div className="-mx-[15px] grid min-w-0 gap-5 border-b border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-page)] p-5 sm:-mx-[23px] sm:grid-cols-2 lg:grid-cols-3">
                {communityApps.map((app) => (
                  <CommunityAppCard key={app.slug} app={app} />
                ))}
              </div>
            ) : null}

            {/* Breaks out and restores the padding for the same reason as the
                section above: this is a section-level divider, so it belongs on
                the full measure rather than stopping at the text inset. */}
            <div className="-mx-4 mt-16 grid gap-8 border-t border-solid border-[var(--b-border-default)] px-4 pt-10 sm:-mx-6 sm:px-6 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)] lg:gap-16">
              <div>
                <h3 className={`m-0 ${SECTION_HEADING_CLASS}`}>
                  {t("templatesPage.communitySubmissionTitle")}
                </h3>
                <p className="mt-3 mb-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
                  {t("templatesPage.communitySubmissionDescription")}
                </p>
                <a
                  href={COMMUNITY_APP_SUBMISSION_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-paragraph-2)] uppercase tracking-[0.04em] text-[var(--b-text-link)] underline underline-offset-2"
                >
                  {t("templatesPage.submitCommunityTemplate")}
                </a>
              </div>
              <CommunityAppSubmissionForm />
            </div>

            <p className="mt-8 max-w-[720px] font-[family-name:var(--b-font-sans)] text-sm leading-[1.4] text-[var(--b-text-muted)]">
              {t("templatesPage.communityTrust")}{" "}
              <a
                href={sitePathForLocale("/docs/creating-templates", locale)}
                className="text-[var(--b-text-link)] underline underline-offset-2"
              >
                {t("templatesPage.publishGuide")}
              </a>
            </p>
          </section>
        </GridInner>
      </PageSection>
    </div>
  );
}
