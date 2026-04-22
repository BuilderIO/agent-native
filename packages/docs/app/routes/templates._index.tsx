import {
  templates,
  TemplateCard,
  trackEvent,
} from "../components/TemplateCard";

export default function TemplatesPage() {
  return (
    <main className="mx-auto max-w-[1200px] px-6 py-20">
      <div className="mb-12 text-center">
        <h1 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
          Open-source, AI-native app templates you own
        </h1>
        <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
          Fork a template, run it locally, and let the agent evolve it.
          Alternatives to Superhuman, Notion, Google Calendar, PowerPoint, and
          more — you own the code and can customize everything.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <TemplateCard key={t.name} template={t} />
        ))}
      </div>

      <div className="mt-12 text-center">
        <p className="mb-4 text-sm text-[var(--fg-secondary)]">
          Every template is forkable and open source. The community can build
          and share their own.
        </p>
        <a
          href="/docs"
          onClick={() =>
            trackEvent("create_your_own", { location: "templates_index" })
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
          Create your own
        </a>
      </div>
    </main>
  );
}
