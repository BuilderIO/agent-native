import { useT } from "@agent-native/core/client";

import { BuildFromScratchCard } from "../components/BuildFromScratchCard";
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
        <div className="sm:col-span-2 lg:col-span-3">
          <BuildFromScratchCard layout="banner" location="templates_index" />
        </div>
      </div>
    </main>
  );
}
