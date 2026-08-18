import { useLocale, useT } from "@agent-native/core/client/i18n";
import { IconArrowUpRight } from "@tabler/icons-react";

import { BuildFromScratchCta } from "../components/BuildFromScratchCta";
import {
  COMMUNITY_TEMPLATE_SUBMISSION_URL,
  CommunityTemplateCard,
  communityTemplates,
} from "../components/CommunityTemplateCard";
import { sitePathForLocale } from "../components/docs-locale";
import { featuredTemplates, TemplateCard } from "../components/TemplateCard";

export default function TemplatesPage() {
  const t = useT();
  const { locale } = useLocale();

  return (
    <main className="templates-index-page mx-auto w-full min-w-0 max-w-[1200px] overflow-x-clip px-4 py-20 sm:px-6">
      <div className="mb-12 text-center">
        <h1 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
          {t("templatesPage.title")}
        </h1>
        <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
          {t("templatesPage.eyebrow")}
          <span className="font-semibold text-[var(--docs-accent)]">
            {" "}
            {t("templatesPage.body")}
          </span>
        </p>
      </div>

      <div className="grid min-w-0 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {featuredTemplates.map((template) => (
          <TemplateCard key={template.name} template={template} />
        ))}
        <div className="flex items-center justify-center">
          <BuildFromScratchCta location="templates_index" variant="grid" />
        </div>
      </div>

      <section className="mt-24 border-t border-[var(--docs-border)] pt-12">
        <div className="mb-8 flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <h2 className="mb-2 text-2xl font-bold tracking-tight md:text-3xl">
              {t("templatesPage.communityTitle")}
            </h2>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              {t("templatesPage.communityDescription")}
            </p>
          </div>
          <a
            href={COMMUNITY_TEMPLATE_SUBMISSION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white no-underline transition-[background-color] hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            {t("templatesPage.submitCommunityTemplate")}
            <IconArrowUpRight className="size-4" aria-hidden="true" />
          </a>
        </div>

        {communityTemplates.length > 0 ? (
          <div className="grid min-w-0 gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
          <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-dashed border-[var(--docs-border)] px-5 py-5 sm:flex-row sm:items-center">
            <p className="m-0 max-w-2xl text-sm leading-relaxed text-[var(--fg-secondary)]">
              {t("templatesPage.communityEmpty")}
            </p>
            <a
              href={`${sitePathForLocale("/docs/creating-templates", locale)}#publishing`}
              className="shrink-0 text-sm font-medium text-[var(--docs-accent)] no-underline hover:underline"
            >
              {t("templatesPage.publishGuide")}
            </a>
          </div>
        )}

        <p className="mt-5 text-xs leading-relaxed text-[var(--fg-secondary)]">
          {t("templatesPage.communityTrust")}
        </p>
      </section>
    </main>
  );
}
