import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  useLoaderData,
  useSearchParams,
  type ClientLoaderFunctionArgs,
} from "react-router";

import { BuildOnlinePopover } from "../components/BuilderWaitlistPopover";
import { communityApps } from "../components/community-apps";
import { fetchCommunityApps } from "../components/community-apps.client";
import { CommunityAppCard } from "../components/CommunityAppCard";
import { CommunityAppSubmissionDialog } from "../components/CommunityAppSubmissionDialog";
import { sitePathForLocale } from "../components/docs-locale";
import { featuredTemplates, TemplateCard } from "../components/TemplateCard";
import { Button } from "../components/website-redesign/ds/button";
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

export function loader() {
  return { apps: communityApps, source: "seed" as const };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  const fallback = await serverLoader<typeof loader>();
  try {
    return { apps: await fetchCommunityApps(), source: "builder" as const };
  } catch {
    return fallback;
  }
}

clientLoader.hydrate = true;

export default function TemplatesPage() {
  const t = useT();
  const { locale } = useLocale();
  const { apps: communityApps } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const submissionReceived =
    searchParams.get("community-submission") === "received";

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
            </div>
          </section>

          {/* Its own band under the card grid rather than a cell inside it,
              where it read as one more app. Left transparent, unlike the
              heading bands, so the page's column rules carry through it. */}
          <section aria-labelledby="build-from-scratch-heading">
            <div className="flex flex-col items-center gap-[var(--spacing-4)] py-[120px] text-center">
              <h2
                id="build-from-scratch-heading"
                className={`m-0 ${SECTION_HEADING_CLASS}`}
              >
                {t("buildFromScratch.title")}
              </h2>
              <p className="m-0 max-w-[560px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
                {t("buildFromScratch.description")}
              </p>
              <div className="mt-[var(--spacing-2)] flex flex-wrap justify-center gap-[var(--spacing-2)]">
                <BuildOnlinePopover
                  location="templates_index"
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
                  href={sitePathForLocale("/docs/getting-started", locale)}
                  onClick={() =>
                    trackEvent("start from scratch", {
                      location: "templates_index",
                      action: "read_docs",
                    })
                  }
                  className="uppercase"
                >
                  {t("buildFromScratch.readDocs")}
                </Button>
              </div>
            </div>
          </section>

          {/* Same shape as the first-party section above: break out of the page
              padding so the top rule spans the full measure, then restore it so
              the heading stays aligned with the rest of the page. */}
          <section
            className="-mx-4 border-t border-solid border-[var(--b-border-default)] px-4 sm:-mx-6 sm:px-6"
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
              <div className="-mx-[15px] grid min-w-0 gap-5 border-b border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-page)] px-5 pt-5 pb-10 sm:-mx-[23px] sm:grid-cols-2 lg:grid-cols-3">
                {communityApps.map((app) => (
                  <CommunityAppCard key={app.slug} app={app} />
                ))}
              </div>
            ) : null}

            <div className="flex flex-col items-center gap-[var(--spacing-4)] pt-[120px] pb-16 text-center">
              <h3 className={`m-0 ${SECTION_HEADING_CLASS}`}>
                {t("templatesPage.communitySubmissionTitle")}
              </h3>
              <p className="m-0 max-w-[560px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
                {t("templatesPage.communitySubmissionDescription")}
              </p>
              <div className="mt-[var(--spacing-2)] flex flex-col items-center gap-[var(--spacing-4)]">
                <CommunityAppSubmissionDialog />
                {submissionReceived ? (
                  <p
                    role="status"
                    className="m-0 font-[family-name:var(--b-font-sans)] text-sm leading-[1.4] text-[var(--b-text-secondary)]"
                  >
                    {t("templatesPage.communitySubmissionReady")}
                  </p>
                ) : null}
              </div>
              <p className="m-0 max-w-[560px] font-[family-name:var(--b-font-sans)] text-sm leading-[1.4] text-[var(--b-text-muted)]">
                {t("templatesPage.communityTrust")}{" "}
                <a
                  href={sitePathForLocale("/docs/creating-templates", locale)}
                  className="text-[var(--b-text-link)] underline underline-offset-2"
                >
                  {t("templatesPage.publishGuide")}
                </a>
              </p>
            </div>
          </section>
        </GridInner>
      </PageSection>
    </div>
  );
}
