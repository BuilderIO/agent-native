import { useLocale } from "@agent-native/core/client";
import { Link } from "react-router";

import { sitePathForLocale } from "../components/docs-locale";
import { ModulesGrid } from "../components/module-catalog";
import { agentNativeSocialImageUrl, withDefaultSocialImage } from "../seo";

export const meta = () =>
  withDefaultSocialImage(
    [
      { title: "Agent-Native Modules" },
      {
        name: "description",
        content:
          "Explore the built-in Agent-Native modules for building agentic applications: actions, state, auth, sharing, realtime sync, collaboration, MCP, A2A, jobs, observability, and more.",
      },
      {
        property: "og:title",
        content: "Agent-Native Modules",
      },
      {
        property: "og:description",
        content:
          "Human-verified framework modules for the production pieces agentic applications need.",
      },
    ],
    agentNativeSocialImageUrl("Agent-Native Modules", "Agent-Native"),
  );

export default function ModulesPage() {
  const { locale } = useLocale();
  const localizedPath = (path: string) => sitePathForLocale(path, locale);

  return (
    <main className="mx-auto w-full min-w-0 max-w-[1200px] overflow-x-clip px-4 py-20 sm:px-6">
      <div className="mb-12 text-center">
        <p className="mb-3 text-sm font-semibold text-[var(--docs-accent)]">
          Modular framework
        </p>
        <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
          Built-in modules for agentic apps
        </h1>
        <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
          Agent-Native ships human-verified pieces for the production work
          agents should not improvise from scratch. Use them as-is, inspect the
          source, or replace the module when your product needs something
          different.
        </p>
      </div>

      <ModulesGrid />

      <div className="mt-12 text-center">
        <Link
          data-an-prefetch="render"
          to={localizedPath("/apps")}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
        >
          Browse apps built from modules
          <span aria-hidden>→</span>
        </Link>
      </div>
    </main>
  );
}
