import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { templates, trackEvent } from "../../components/TemplateCard";

export const Route = createFileRoute("/templates/slides")({
  component: SlidesTemplate,
  head: () => ({
    meta: [
      { title: "AI-Native Slides — Open Source AI Presentation Builder" },
      {
        name: "description",
        content:
          "Generate and edit presentations with AI. Open source alternative to Google Slides and Pitch. Create slide decks via natural language with visual editing, 8 layouts, image generation, logo search, sharing, and presentation mode.",
      },
      {
        property: "og:title",
        content: "AI-Native Slides — Open Source AI Presentation Builder",
      },
      {
        property: "og:description",
        content:
          "Generate and edit presentations with AI. Create slide decks via natural language.",
      },
      {
        name: "keywords",
        content:
          "AI presentation maker, AI slide generator, open source Google Slides alternative, Pitch alternative, AI PowerPoint, AI deck builder, agent-native slides, AI presentation tool, AI slide deck, prompt to presentation",
      },
    ],
  }),
});

const template = templates.find((t) => t.slug === "slides")!;

function CliCopy() {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(template.cliCommand);
    setCopied(true);
    trackEvent("copy_cli_command", {
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

function SlidesTemplate() {
  return (
    <main className="mx-auto max-w-[1200px] px-6">
      {/* Hero */}
      <section className="py-20">
        <div className="mb-4">
          <Link
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
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--fg-secondary)]">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: template.color }}
              />
              {template.replaces}
            </div>

            <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
              Agent-Native Slide Deck Generation
            </h1>

            <p className="mb-6 text-lg leading-relaxed text-[var(--fg-secondary)]">
              Describe your presentation. The agent generates a complete deck
              with layouts, content, and images. Refine conversationally or edit
              visually.
            </p>

            <div className="mb-8 flex flex-col items-start gap-3">
              <a
                href="https://builder.io"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  trackEvent("launch_template_cloud", {
                    template: template.slug,
                    location: "hero",
                  })
                }
                className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                </svg>
                Launch in Cloud
              </a>
              <CliCopy />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]">
            <img
              src={template.screenshot}
              alt="Slides template screenshot"
              className="w-full object-cover object-top"
            />
          </div>
        </div>
      </section>

      {/* How it works - numbered steps */}
      <section className="border-t border-[var(--border)] py-16">
        <h2 className="mb-8 text-2xl font-bold tracking-tight">How it works</h2>
        <div className="mx-auto grid max-w-3xl gap-6 sm:grid-cols-3">
          {[
            {
              step: "1",
              title: "Describe",
              desc: "Tell the agent your topic, audience, and tone. Attach reference PDFs or images.",
            },
            {
              step: "2",
              title: "Generate",
              desc: "The agent builds a complete deck — structure, content, layouts, and image prompts.",
            },
            {
              step: "3",
              title: "Refine",
              desc: "Edit visually, conversationally, or in code. Changes appear instantly via SSE.",
            },
          ].map((s) => (
            <div key={s.step} className="text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-bold text-white">
                {s.step}
              </div>
              <h3 className="mb-1 text-sm font-semibold">{s.title}</h3>
              <p className="m-0 text-sm text-[var(--fg-secondary)]">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Core features - icon cards */}
      <section className="border-t border-[var(--border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          Everything you need
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          A full presentation studio with AI built in.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">8 Slide Layouts</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Title, section, content, two-column, image, statement, full-bleed,
              and blank.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              Visual + Code Editing
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Click to edit styles, double-click for text. Switch to raw HTML
              for full control.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">AI Image Generation</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Generate images with Gemini. Style references for brand
              consistency. 3 variations to pick from.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Logo & Image Search</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Search company logos via Logo.dev or Brandfetch. Google Images for
              stock photos.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              Drag & Drop Reordering
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Reorder slides in the sidebar. Duplicate or delete with hover
              actions.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Presentation Mode</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Full-screen with keyboard nav, auto-hiding controls, and speaker
              notes.
            </p>
          </div>
        </div>
      </section>

      {/* Two-column highlight */}
      <section className="border-t border-[var(--border)] py-16">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] p-6">
            <h3 className="mb-2 text-base font-semibold">
              Sharing & Collaboration
            </h3>
            <p className="mb-4 text-sm text-[var(--fg-secondary)]">
              Generate share links for read-only presentation access. Full
              undo/redo history with labeled entries.
            </p>
            <ul className="m-0 list-none space-y-2 p-0 text-sm text-[var(--fg-secondary)]">
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--accent)]"
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
                Share links with read-only access
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--accent)]"
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
                Cmd+Z undo/redo with full history
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--accent)]"
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
                Navigate to any point in history
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-6">
            <h3 className="mb-2 text-base font-semibold">
              Conversational Refinement
            </h3>
            <p className="mb-4 text-sm text-[var(--fg-secondary)]">
              The agent edits slides in real time. Changes appear instantly via
              SSE.
            </p>
            <div className="space-y-3 rounded-lg bg-[var(--bg-secondary)] p-4 font-mono text-sm">
              <div className="text-[var(--fg-secondary)]">
                "Make the title bigger"
              </div>
              <div className="text-[var(--fg-secondary)]">
                "Add a chart on slide 3"
              </div>
              <div className="text-[var(--fg-secondary)]">
                "Change the color scheme to blue"
              </div>
              <div className="text-[var(--fg-secondary)]">
                "Add speaker notes for slide 5"
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="border-t border-[var(--border)] py-16">
        <h2 className="mb-8 text-2xl font-bold tracking-tight">
          How it compares
        </h2>
        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
          <table className="comparison-table w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]">
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg)]"></th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  Google Slides / Pitch
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  AI Slide Generators
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--accent)]">
                  Agent-Native Slides
                </th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Visual editor
                </td>
                <td className="px-5 py-3">Yes, template-bound</td>
                <td className="px-5 py-3">Limited / none</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Visual + code + agent
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  AI generation
                </td>
                <td className="px-5 py-3">Basic / none</td>
                <td className="px-5 py-3">One-shot, rigid</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Iterative, conversational
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Image generation
                </td>
                <td className="px-5 py-3">None</td>
                <td className="px-5 py-3">Basic</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Gemini with style refs
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Customization
                </td>
                <td className="px-5 py-3">Themes only</td>
                <td className="px-5 py-3">Prompt only</td>
                <td className="px-5 py-3 text-[var(--fg)]">Full source code</td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Pricing
                </td>
                <td className="px-5 py-3">Free / per-seat</td>
                <td className="px-5 py-3">Subscription</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Free & open source
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--border)] py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          Get started in minutes
        </h2>
        <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
          Fork the template and start creating presentations with AI.
        </p>
        <div className="flex items-center justify-center gap-4">
          <a
            href="https://builder.io"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              trackEvent("launch_template_cloud", {
                template: template.slug,
                location: "bottom_cta",
              })
            }
            className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Launch in Cloud
          </a>
          <Link
            to="/templates"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            View all templates
          </Link>
        </div>
      </section>
    </main>
  );
}
