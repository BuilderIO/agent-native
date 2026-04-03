import { Link } from "react-router";
import { useState } from "react";
import { templates, trackEvent } from "../components/TemplateCard";

export const meta = () => [
  {
    title:
      "AI-Native Content — Open Source Alternative to Notion & Google Docs",
  },
  {
    name: "description",
    content:
      "Write and organize content with an AI agent that knows your brand. Open source alternative to Notion and Google Docs. AI-powered writing, editing, and publishing workflows you own.",
  },
  {
    property: "og:title",
    content:
      "AI-Native Content — Open Source Alternative to Notion & Google Docs",
  },
  {
    property: "og:description",
    content:
      "Write and organize content with an AI agent that knows your brand.",
  },
  {
    name: "keywords",
    content:
      "AI content editor, open source Notion alternative, Google Docs alternative, AI writing tool, AI content management, agent-native content, AI-powered CMS, AI document editor, AI content creation, open source writing app",
  },
];

const template = templates.find((t) => t.slug === "content")!;

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

export default function ContentTemplate() {
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
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--fg-secondary)]">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: template.color }}
              />
              {template.replaces}
            </div>

            <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
              Agent-Native Content Generation
            </h1>

            <p className="mb-6 text-lg leading-relaxed text-[var(--fg-secondary)]">
              A content workspace with an AI agent that knows your brand voice.
              Write, organize, and publish — the agent drafts, rewrites, and can
              even modify the app itself.
            </p>

            <div className="mb-8 flex flex-wrap items-center gap-3">
              <a
                href="https://content.agent-native.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
                onClick={() =>
                  trackEvent("try_live_demo", {
                    template: "content",
                    location: "landing_page",
                  })
                }
              >
                Try Live Demo
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

          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]">
            <img
              src={template.screenshot}
              alt="Content template screenshot"
              className="w-full object-cover object-top"
            />
          </div>
        </div>
      </section>

      {/* How it works - 3 panels */}
      <section className="border-t border-[var(--border)] py-16">
        <div className="mx-auto grid max-w-3xl gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
          <div className="bg-[var(--bg)] p-6 text-center">
            <div className="mb-3 flex justify-center text-[var(--accent)]">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </div>
            <div className="mb-1 text-sm font-semibold">Write</div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Rich editor with formatting, headings, code blocks with syntax
              highlighting, and media.
            </p>
          </div>
          <div className="bg-[var(--bg)] p-6 text-center">
            <div className="mb-3 flex justify-center text-[#7928ca]">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div className="mb-1 text-sm font-semibold">Refine with AI</div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Rewrite, expand, summarize, or change tone on any selection.
            </p>
          </div>
          <div className="bg-[var(--bg)] p-6 text-center">
            <div className="mb-3 flex justify-center text-[#f59e0b]">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </div>
            <div className="mb-1 text-sm font-semibold">Publish</div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Push to WordPress, Contentful, Builder, or any headless CMS.
            </p>
          </div>
        </div>
      </section>

      {/* Core features */}
      <section className="border-t border-[var(--border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          Everything you need
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          A complete content workspace — like Notion, but you own the code.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Projects & Documents</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Organize into projects with nested documents. Sidebar tree nav and
              search.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Brand-Aware AI</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              The agent learns your voice, style guide, and tone. Every draft
              sounds like you.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Notion Import/Export</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Two-way Notion sync. Import pages from Notion, edit locally, and
              push changes back.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              Code Block Syntax Highlighting
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Full syntax highlighting for code blocks. Language detection and
              formatting built in.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Script Automation</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Batch content generation, cross-referencing, and publishing
              pipelines.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Self-Improving</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              The agent modifies the app itself. Need a new workflow? Just ask.
            </p>
          </div>
        </div>
      </section>

      {/* Publishing highlight */}
      <section className="border-t border-[var(--border)] py-16">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight">
              Write here, publish everywhere
            </h2>
            <p className="mb-6 text-base text-[var(--fg-secondary)]">
              Connect to any headless CMS via scripts. The agent handles the
              entire workflow.
            </p>
            <ul className="m-0 list-none space-y-3 p-0 text-sm text-[var(--fg-secondary)]">
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
                WordPress, Contentful, Builder, or any CMS
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
                Agent runs publishing scripts autonomously
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
                Markdown, HTML, or any format you prefer
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
                All content stored as files you own
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
            <div className="space-y-3 font-mono text-sm">
              <div className="text-[var(--fg-secondary)]">
                {"// Agent publishing workflow"}
              </div>
              <div>
                <span className="text-[var(--accent)]">1.</span>{" "}
                <span className="text-[var(--fg)]">
                  Draft content in editor
                </span>
              </div>
              <div>
                <span className="text-[var(--accent)]">2.</span>{" "}
                <span className="text-[var(--fg)]">
                  "Publish this to WordPress"
                </span>
              </div>
              <div>
                <span className="text-[var(--accent)]">3.</span>{" "}
                <span className="text-[var(--fg)]">
                  Agent runs publish script
                </span>
              </div>
              <div>
                <span className="text-[var(--accent)]">4.</span>{" "}
                <span className="text-[var(--fg)]">
                  Content live on your site
                </span>
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
                  Notion / Google Docs
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  ChatGPT / Claude
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--accent)]">
                  Agent-Native Content
                </th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Editor UI
                </td>
                <td className="px-5 py-3">Full, rigid</td>
                <td className="px-5 py-3">Chat only</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Full, customizable
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Brand awareness
                </td>
                <td className="px-5 py-3">None</td>
                <td className="px-5 py-3">Per-conversation</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Persistent, trained
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  CMS publishing
                </td>
                <td className="px-5 py-3">Separate step</td>
                <td className="px-5 py-3">Manual copy-paste</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Integrated workflow
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]">
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
                <td className="px-5 py-3">Per-seat</td>
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
          Fork the template, connect your CMS, start writing with AI.
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
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            View all templates
          </Link>
        </div>
      </section>
    </main>
  );
}
