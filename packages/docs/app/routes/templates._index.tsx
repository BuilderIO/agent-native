import { useLocale, useT } from "@agent-native/core/client";
import { Link } from "react-router";

import { sitePathForLocale } from "../components/docs-locale";
import {
  featuredTemplates,
  TemplateCard,
  trackEvent,
} from "../components/TemplateCard";

export default function TemplatesPage() {
  const { locale } = useLocale();
  const t = useT();

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
      </div>

      <div className="mt-12 text-center">
        <p className="mb-4 text-sm text-[var(--fg-secondary)]">
          {t("templatesPage.community")}
        </p>
        <Link
          data-an-prefetch="render"
          to={sitePathForLocale("/docs/getting-started", locale)}
          onClick={() =>
            trackEvent("start from scratch", { location: "templates_index" })
          }
          className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("templatesPage.createYourOwn")}
        </Link>
      </div>
    </main>
  );
}
