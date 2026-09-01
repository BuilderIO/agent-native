import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";

import { BuildOnlinePopover } from "../components/BuilderWaitlistPopover";
import {
  COMMUNITY_TEMPLATE_SUBMISSION_URL,
  CommunityTemplateCard,
  communityTemplates,
} from "../components/CommunityTemplateCard";
import { sitePathForLocale } from "../components/docs-locale";
import { featuredTemplates, TemplateCard } from "../components/TemplateCard";
import { Button } from "../components/website-redesign/ds/button";
import { NavLink } from "../components/website-redesign/ds/nav-link";
import {
  GridInner,
  PageSection,
} from "../components/website-redesign/page-grid";

const HEADING_2_CLASS =
  "m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]";

const HEADING_5_CLASS =
  "m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-5)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]";

const PARAGRAPH_2_CLASS =
  "m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.4] text-[var(--b-text-secondary)]";

// Dividers are a 1px gap over the border color with each cell painting its own
// page-bg on top, so a line only appears between cells that end up adjacent
// whatever the column count is.
const CARD_GRID_CLASS =
  "grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-2 narrow:grid-cols-1";

export default function TemplatesPage() {
  const t = useT();
  const { locale } = useLocale();

  return (
    <main className="builder-brand-tokens">
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
          <h1 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-1)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)] mobile:leading-[1.2]">
            {t("templatesPage.title")}
          </h1>
          <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-pretty text-[var(--b-text-secondary)]">
            {t("templatesPage.eyebrow")}{" "}
            <span className="text-[var(--b-text-primary)]">
              {t("templatesPage.body")}
            </span>
          </p>
        </GridInner>
      </PageSection>

      <PageSection>
        <GridInner>
          <div className={CARD_GRID_CLASS}>
            {featuredTemplates.map((template) => (
              <TemplateCard key={template.name} template={template} />
            ))}

            {/* Not a card component like the apps above: it holds two
                interactive children of its own, and nesting those inside the
                card's anchor would be invalid. Vertically centred rather than
                top-aligned since it has no screenshot to anchor its top.
                It is the only cell in the last row, so nothing stretches it to
                an app card's height — the aspect ratio is one card's own
                proportions (a 433px column, screenshot plus copy), which
                tracks the column width instead of pinning a pixel height.
                aspect-ratio only sets a preferred size, so the copy can still
                push the tile taller at narrow widths. */}
            <div className="flex aspect-[433/560] flex-col items-start justify-center gap-[var(--spacing-4)] bg-[var(--b-bg-page)] p-[var(--spacing-5)] transition-[background-color] duration-150 ease-[ease] hover:bg-[var(--b-bg-raised)]">
              <h2 className={HEADING_5_CLASS}>{t("buildFromScratch.title")}</h2>
              <p className={PARAGRAPH_2_CLASS}>
                {t("buildFromScratch.description")}
              </p>
              {/* Wraps rather than shrinks: the ds Button labels are
                  whitespace-nowrap, so in a one-column card they stack
                  instead of overflowing. */}
              <div className="mt-[var(--spacing-2)] flex flex-wrap gap-[var(--spacing-2)]">
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
                  data-an-prefetch="viewport"
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

            {/* 12 apps plus the tile above leaves the last row one cell short
                at both 3 and 2 columns, and an empty cell would show the
                grid's own background — the divider color — with no card there
                to paint over it. These spacers paint page-bg into those slots:
                two of them at 3 columns, one at 2, none at 1. */}
            <div
              aria-hidden="true"
              className="bg-[var(--b-bg-page)] narrow:hidden"
            />
            <div
              aria-hidden="true"
              className="bg-[var(--b-bg-page)] mobile:hidden"
            />
          </div>
        </GridInner>
      </PageSection>

      <PageSection>
        <GridInner className="flex items-end justify-between gap-[var(--spacing-5)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-8)] mobile:flex-col mobile:items-start">
          <div className="flex max-w-[633px] flex-col gap-[var(--spacing-3)]">
            <h2 className={HEADING_2_CLASS}>
              {t("templatesPage.communityTitle")}
            </h2>
            <p className={PARAGRAPH_2_CLASS}>
              {t("templatesPage.communityDescription")}
            </p>
          </div>
          <Button
            variant="white"
            href={COMMUNITY_TEMPLATE_SUBMISSION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 uppercase"
          >
            {t("templatesPage.submitCommunityTemplate")}
          </Button>
        </GridInner>

        <GridInner className="flex flex-col gap-[var(--spacing-5)] px-[var(--spacing-8)] pb-[var(--spacing-24)]">
          {communityTemplates.length > 0 ? (
            <div className="grid min-w-0 grid-cols-3 gap-[var(--spacing-5)] mobile:grid-cols-2 narrow:grid-cols-1">
              {communityTemplates.map((template) => (
                <CommunityTemplateCard
                  key={`${template.repository}:${template.app ?? ""}`}
                  template={template}
                  labels={{
                    copyInstallCommand: t(
                      "templatesPage.copyCommunityInstallCommand",
                    ),
                    copied: t("common.copied"),
                    repository: t("templatesPage.viewRepository"),
                    tryDemo: t("templatesPage.tryCommunityDemo"),
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-[var(--spacing-4)] rounded-[var(--b-radius)] border border-dashed border-[var(--b-border-default)] p-[var(--spacing-5)] mobile:flex-col mobile:items-start">
              <p className={`${PARAGRAPH_2_CLASS} max-w-[633px]`}>
                {t("templatesPage.communityEmpty")}
              </p>
              <div className="shrink-0">
                <NavLink
                  href={`${sitePathForLocale("/docs/creating-templates", locale)}#publishing`}
                  showArrow
                >
                  {t("templatesPage.publishGuide")}
                </NavLink>
              </div>
            </div>
          )}

          <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.5] text-[var(--b-text-muted)]">
            {t("templatesPage.communityTrust")}
          </p>
        </GridInner>
      </PageSection>
    </main>
  );
}
