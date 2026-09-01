import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import { IconBrandGithub } from "@tabler/icons-react";

import { BuildOnlinePopover } from "../components/BuilderWaitlistPopover";
import {
  COMMUNITY_TEMPLATE_SUBMISSION_URL,
  CommunityTemplateCard,
  communityTemplates,
} from "../components/CommunityTemplateCard";
import { sitePathForLocale } from "../components/docs-locale";
import { featuredTemplates, TemplateCard } from "../components/TemplateCard";
import { Button } from "../components/website-redesign/ds/button";
import { IconBox } from "../components/website-redesign/ds/icon-box";
import {
  GridInner,
  PageSection,
} from "../components/website-redesign/page-grid";

const HEADING_3_CLASS =
  "m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-3)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]";

const HEADING_4_CLASS =
  "m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-4)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]";

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

  // The two things an author does, in one definition for two placements:
  // inside the empty-state band, and below the card grid once listings exist.
  // The parent owns the alignment, so the same markup reads centred in the
  // band and left-aligned under the grid.
  const authorActions = (
    <div className="flex flex-wrap gap-[var(--spacing-3)]">
      <Button
        variant="white"
        href={COMMUNITY_TEMPLATE_SUBMISSION_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="uppercase"
      >
        {t("templatesPage.submitCommunityTemplate")}
      </Button>
      <Button
        variant="secondary"
        href={`${sitePathForLocale("/docs/creating-templates", locale)}#publishing`}
        data-an-prefetch="viewport"
        className="uppercase"
      >
        {t("templatesPage.publishGuide")}
      </Button>
    </div>
  );

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
          </div>
        </GridInner>
      </PageSection>

      <PageSection>
        {/* The top padding is the spacer between the card grid and this band;
            the section's own gridlines carry through it. */}
        <GridInner className="pt-[var(--spacing-12)] pb-[var(--spacing-4)]">
          <div className="flex flex-col items-center gap-[var(--spacing-5)] border border-solid border-[var(--b-border-subtle)] px-[var(--spacing-8)] py-[var(--spacing-16)] text-center">
            <div className="flex flex-col items-center gap-[var(--spacing-2)]">
              <h2 className={HEADING_4_CLASS}>{t("buildFromScratch.title")}</h2>
              <p className={`${PARAGRAPH_2_CLASS} max-w-[520px] text-pretty`}>
                {t("buildFromScratch.description")}
              </p>
            </div>
            {/* justify-center rather than relying on the parent's items-center:
                that centres the row as a box, but a wrapped second line would
                still start at the left edge. */}
            <div className="flex flex-wrap justify-center gap-[var(--spacing-3)]">
              <BuildOnlinePopover
                location="templates_index"
                trigger={
                  // Caps come from CSS, not the label: an all-caps string
                  // becomes the accessible name and screen readers spell it
                  // out letter by letter.
                  <Button variant="white" icon={null} className="uppercase">
                    {t("buildFromScratch.buildOnline")}
                  </Button>
                }
              />
              <Button
                variant="secondary"
                icon={null}
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
        </GridInner>
      </PageSection>

      <PageSection>
        {/* Snapped to the decorative gridlines behind it: the heading takes the
            first column and the copy the other two, so the section sits on the
            same structure as the card grid above rather than floating as a
            centred block. Both paragraphs here address someone installing a
            community app — what these listings are, and that the code is
            third-party. The author-facing actions live further down. */}
        <GridInner className="grid grid-cols-3 items-start gap-[var(--spacing-8)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-12)] mobile:grid-cols-1">
          <h2 className={HEADING_3_CLASS}>
            {t("templatesPage.communityTitle")}
          </h2>
          <div className="col-span-2 flex flex-col items-start gap-[var(--spacing-4)] mobile:col-span-1">
            <p className="m-0 max-w-[560px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-pretty text-[var(--b-text-secondary)]">
              {t("templatesPage.communityDescription")}
            </p>
            <p className="m-0 max-w-[560px] font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-paragraph-3)] leading-[1.6] text-[var(--b-text-muted)]">
              {t("templatesPage.communityTrust")}
            </p>
          </div>
        </GridInner>

        <GridInner className="flex flex-col gap-[var(--spacing-6)] pb-[var(--spacing-40)]">
          {communityTemplates.length > 0 ? (
            <>
              <div className={CARD_GRID_CLASS}>
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
              {/* Outside the grid once there are listings, so submitting and
                  the publishing guide are never conditional on the empty state
                  being the thing on screen. */}
              <div className="flex flex-col items-start px-[var(--spacing-8)]">
                {authorActions}
              </div>
            </>
          ) : (
            // A hairline-bounded band on the same edges as the card grid, not a
            // dashed box floating inside the column: with no listings yet this
            // is the section's main surface, so it reads as page structure.
            <div className="flex flex-col items-center gap-[var(--spacing-5)] border border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-raised)] px-[var(--spacing-8)] py-[var(--spacing-20)] text-center">
              <IconBox>
                <IconBrandGithub size={20} stroke={1.5} />
              </IconBox>
              <p className="m-0 max-w-[520px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-pretty text-[var(--b-text-secondary)]">
                {t("templatesPage.communityEmpty")}
              </p>
              {authorActions}
            </div>
          )}
        </GridInner>
      </PageSection>
    </main>
  );
}
