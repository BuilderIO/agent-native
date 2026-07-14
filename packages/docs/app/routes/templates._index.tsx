import { useT } from "@agent-native/core/client";

import { BuildFromScratchCta } from "../components/BuildFromScratchCta";
import { featuredTemplates, TemplateCard } from "../components/TemplateCard";

export default function TemplatesPage() {
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
        <div className="flex items-center justify-center">
          <BuildFromScratchCta location="templates_index" variant="grid" />
        </div>
      </div>
    </main>
  );
}
