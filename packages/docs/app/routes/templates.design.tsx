import { Link } from "react-router";
import { useState } from "react";
import { templates, trackEvent } from "../components/TemplateCard";

export const meta = () => [
  {
    title: "Agent-Native Design — Open Source AI HTML Prototyping Tool",
  },
  {
    name: "description",
    content:
      "Create interactive HTML prototypes with AI. Generate Alpine/Tailwind designs from prompts, compare variants, refine with tweak controls, and export HTML, ZIP, or PDF.",
  },
  {
    property: "og:title",
    content: "Agent-Native Design — Open Source AI HTML Prototyping Tool",
  },
  {
    property: "og:description",
    content:
      "Generate, refine, preview, and export interactive HTML prototypes — built on an agent you own.",
  },
  {
    name: "keywords",
    content:
      "AI design tool, AI HTML prototype, open source design tool, AI UI generator, Alpine Tailwind prototype, agent-native design, prompt to HTML, generative design",
  },
];

const template = templates.find((t) => t.slug === "design")!;

function CliCopy() {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(template.cliCommand);
    setCopied(true);
    trackEvent("copy cli command", {
      template: template.slug,
      location: "landing_page",
    });
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={handleCopy}
      className="group flex items-center gap-3 rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] px-5 py-3 font-mono text-sm transition hover:border-[var(--fg-secondary)]"
    >
      <span className="shrink-0 text-[var(--fg-secondary)]">$</span>
      <span className="truncate text-[var(--fg)]">{template.cliCommand}</span>
      <span className="ml-auto shrink-0 text-[var(--fg-secondary)] opacity-0 transition group-hover:opacity-100">
        {copied ? (
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
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
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
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </span>
    </button>
  );
}

export default function DesignTemplate() {
  return (
    <main className="mx-auto max-w-[1200px] px-6">
      {/* Hero */}
      <section className="py-20">
        <div className="mb-4">
          <Link
            prefetch="render"
            to="/templates"
            className="inline-flex items-center gap-1 text-sm text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)]"
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
              <polyline points="15 18 9 12 15 6" />
            </svg>
            All Templates
          </Link>
        </div>

        <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--fg-secondary)]">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: template.color }}
              />
              Agent-Native {template.name}
            </div>

            <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
              The open-source AI HTML prototyping studio
            </h1>

            <p className="mb-6 text-lg leading-relaxed text-[var(--fg-secondary)]">
              Generate interactive Alpine/Tailwind prototypes from a prompt,
              compare variants, refine with tweak controls, and export real
              files you own.
            </p>

            <div className="mb-8 flex flex-wrap items-center gap-3">
              <a
                href="https://design.agent-native.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
                onClick={() =>
                  trackEvent("try live demo", {
                    template: "design",
                    location: "landing_page",
                  })
                }
              >
                Try It
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
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
              <CliCopy />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)]">
            <img
              src={template.screenshot}
              alt="Design template screenshot"
              className="w-full object-cover object-top"
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-8 text-2xl font-bold tracking-tight">How it works</h2>
        <div className="mx-auto grid max-w-3xl gap-6 sm:grid-cols-3">
          {[
            {
              step: "1",
              title: "Describe",
              desc: "Tell the agent what you're making — a landing page, product UI, brand direction, or interactive prototype.",
            },
            {
              step: "2",
              title: "Generate",
              desc: "The agent creates complete self-contained HTML with Tailwind styling and Alpine interactions.",
            },
            {
              step: "3",
              title: "Refine",
              desc: "Pick a variant, adjust tweak controls, or ask the agent for copy, layout, color, and interaction changes.",
            },
          ].map((s) => (
            <div key={s.step} className="text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--docs-accent)] text-sm font-bold text-white">
                {s.step}
              </div>
              <h3 className="mb-1 text-sm font-semibold">{s.title}</h3>
              <p className="m-0 text-sm text-[var(--fg-secondary)]">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Core features */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          Everything you need
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          A prototype studio with an agent that writes and refines the source.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              Complete HTML Prototypes
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Generate self-contained Alpine/Tailwind HTML that renders in the
              preview iframe and can be exported directly.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Variant Generation</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Start from multiple directions, compare them in the app, and keep
              refining the strongest design.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Tweak Controls</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Adjust common design variables visually while the agent handles
              larger structural and copy changes.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Conversational Edits</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              "Make the headline bolder", "try a warmer palette", "add a CTA
              button". The agent updates the underlying HTML.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Design Systems</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Save reusable design-system preferences so new generations stay
              closer to your product language.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Export Anywhere</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Export HTML, ZIP, or PDF from the generated prototype when you're
              ready to share or hand off.
            </p>
          </div>
        </div>
      </section>

      {/* Two-column highlight */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--docs-border)] p-6">
            <h3 className="mb-2 text-base font-semibold">
              Source-First Preview
            </h3>
            <p className="mb-4 text-sm text-[var(--fg-secondary)]">
              The preview is rendered from the same HTML the agent edits and the
              export uses, so there is less translation between concept and
              handoff.
            </p>
            <ul className="m-0 list-none space-y-2 p-0 text-sm text-[var(--fg-secondary)]">
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Iframe preview of the generated prototype
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Exportable HTML, ZIP, and PDF artifacts
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                SQL-backed design records you can fork and extend
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] p-6">
            <h3 className="mb-2 text-base font-semibold">
              Conversational Refinement
            </h3>
            <p className="mb-4 text-sm text-[var(--fg-secondary)]">
              The agent edits the prototype source. Plain-English instructions
              become changes to copy, layout, colors, spacing, and interactions.
            </p>
            <div className="space-y-3 rounded-lg bg-[var(--bg-secondary)] p-4 font-mono text-sm">
              <div className="text-[var(--fg-secondary)]">
                "Make this look more premium"
              </div>
              <div className="text-[var(--fg-secondary)]">
                "Try a darker color palette"
              </div>
              <div className="text-[var(--fg-secondary)]">
                "Make the hero layout more editorial"
              </div>
              <div className="text-[var(--fg-secondary)]">
                "Generate three variations of this"
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-8 text-2xl font-bold tracking-tight">
          How it compares
        </h2>
        <div className="overflow-hidden rounded-xl border border-[var(--docs-border)]">
          <table className="comparison-table w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--docs-border)] bg-[var(--bg-secondary)]">
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg)]"></th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  Static mockup tools
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  One-shot generators
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--docs-accent)]">
                  Agent-Native Design
                </th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Visual editor
                </td>
                <td className="px-5 py-3">Visual-first</td>
                <td className="px-5 py-3">Prompt-first</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Agent + preview + code
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  AI generation
                </td>
                <td className="px-5 py-3">Limited / plugins</td>
                <td className="px-5 py-3">One-shot prompt</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Iterative, conversational
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Editable output
                </td>
                <td className="px-5 py-3">Tool-native file</td>
                <td className="px-5 py-3">Often static</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Complete HTML/CSS/JS
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Customization
                </td>
                <td className="px-5 py-3">Plugins only</td>
                <td className="px-5 py-3">Prompt only</td>
                <td className="px-5 py-3 text-[var(--fg)]">Full source code</td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Pricing
                </td>
                <td className="px-5 py-3">$15+/mo per seat</td>
                <td className="px-5 py-3">Per-image credits</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Free &amp; open source
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--docs-border)] py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          Get started in minutes
        </h2>
        <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
          Fork the template and start generating interactive prototypes with an
          agent that edits the source.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            prefetch="render"
            to="/docs"
            className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Get Started
          </Link>
          <Link
            prefetch="render"
            to="/templates"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            View all templates
          </Link>
        </div>
      </section>
    </main>
  );
}
