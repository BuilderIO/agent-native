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

export default function TemplatesPage() {
  const t = useT();
  const { locale } = useLocale();

  return (
    <div className="builder-brand-tokens min-h-screen">
      <main className="templates-index-page mx-auto w-full min-w-0 max-w-site overflow-x-clip px-4 pb-24 pt-20 sm:px-6 lg:pt-28">
        <header className="max-w-[720px]">
          <h1 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-1)] font-medium leading-[1.05] tracking-[-0.03em] text-[var(--b-text-primary)]">
            {t("templatesPage.title")}
          </h1>
          <p className="mt-5 mb-0 max-w-[620px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templatesPage.eyebrow")}{" "}
            <span className="text-[var(--b-text-primary)]">
              {t("templatesPage.body")}
            </span>
          </p>
        </header>

        <section className="mt-16" aria-labelledby="first-party-apps-heading">
          <h2
            id="first-party-apps-heading"
            className="mb-6 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-3)] font-medium leading-[1.1] tracking-[-0.02em] text-[var(--b-text-primary)]"
          >
            {t("templatesPage.firstPartyTitle")}
          </h2>
          <div className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featuredTemplates.map((template) => (
              <TemplateCard key={template.name} template={template} />
            ))}
            <div className="flex min-h-full items-center border border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-page)] p-1 transition-[background-color] duration-150 hover:bg-[var(--b-bg-raised)]">
              <BuildFromScratchCta location="templates_index" variant="grid" />
            </div>
          </div>
        </section>

        <section
          className="mt-24 border-t border-solid border-[var(--b-border-default)] pt-16"
          aria-labelledby="community-apps-heading"
        >
          <div className="max-w-[720px]">
            <h2
              id="community-apps-heading"
              className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]"
            >
              {t("templatesPage.communityTitle")}
            </h2>
            <p className="mt-4 mb-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
              {t("templatesPage.communityDescription")}
            </p>
          </div>

          {communityApps.length > 0 ? (
            <div className="mt-8 grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {communityApps.map((app) => (
                <CommunityAppCard key={app.slug} app={app} />
              ))}
            </div>
          ) : null}

          <div className="mt-16 grid gap-8 border-t border-solid border-[var(--b-border-default)] pt-10 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)] lg:gap-16">
            <div>
              <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-4)] font-medium leading-[1.1] tracking-[-0.02em] text-[var(--b-text-primary)]">
                {t("templatesPage.communitySubmissionTitle")}
              </h3>
              <p className="mt-3 mb-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.4] text-[var(--b-text-secondary)]">
                {t("templatesPage.communitySubmissionDescription")}
              </p>
              <a
                href={COMMUNITY_APP_SUBMISSION_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] uppercase tracking-[0.04em] text-[var(--b-text-link)] underline underline-offset-2"
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
      </main>
    </div>
  );
}
