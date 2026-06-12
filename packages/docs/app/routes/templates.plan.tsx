import { Link } from "react-router";
import { useState } from "react";
import { templates, trackEvent } from "../components/TemplateCard";
import { TemplateDocsLink } from "../components/template-docs";
import { withTemplateSocialImage } from "../seo";

export const meta = () =>
  withTemplateSocialImage(
    [
      {
        title:
          "Agent-Native Plans — Visual Planning for Codex, Claude Code & Coding Agents",
      },
      {
        name: "description",
        content:
          "Give your coding agent a visual plan surface. Wireframes, diagrams, annotated code, prototypes, and shareable review links — installed in seconds as a skill for Codex, Claude Code, and any coding agent.",
      },
      {
        property: "og:title",
        content:
          "Agent-Native Plans — Visual Planning for Codex, Claude Code & Coding Agents",
      },
      {
        property: "og:description",
        content:
          "Give your coding agent a visual plan surface. Wireframes, diagrams, annotated code, and shareable review links.",
      },
      {
        name: "keywords",
        content:
          "AI coding agent plans, visual planning, Codex visual plan, Claude Code plans, coding agent wireframe, agent plan skill, visual plan mode, AI diagram generator, agent-native plans, annotated code review, shareable agent plans",
      },
    ],
    "Plans",
  );

const template = templates.find((t) => t.slug === "plan")!;

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
      data-template-cli-copy
      className="group col-span-full flex w-full min-w-0 max-w-full items-center gap-3 rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] px-4 py-3 font-mono text-sm transition hover:border-[var(--fg-secondary)] sm:w-auto sm:max-w-[min(100%,36rem)] sm:px-5"
    >
      <span className="shrink-0 text-[var(--fg-secondary)]">$</span>
      <span
        data-template-cli-copy-text
        className="min-w-0 truncate text-[var(--fg)]"
      >
        {template.cliCommand}
      </span>
      <span className="ml-auto shrink-0 text-[var(--fg-secondary)] opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
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

export default function PlanTemplate() {
  return (
    <main className="template-detail-page mx-auto w-full max-w-[1200px] overflow-x-clip px-4 sm:px-6">
      {/* Hero */}
      <section className="py-12 sm:py-16 lg:py-20">
        <div className="mb-4">
          <Link
            data-an-prefetch="render"
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

        <div className="grid min-w-0 gap-10 lg:grid-cols-2 lg:items-start lg:gap-12">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--fg-secondary)]">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: template.color }}
              />
              Agent-Native {template.name}
            </div>

            <h1 className="mb-4 text-[2rem] font-bold leading-[1.08] tracking-tight sm:text-4xl md:text-5xl">
              Visual plans for Codex, Claude Code &amp; coding agents
            </h1>

            <p className="mb-6 text-base leading-7 text-[var(--fg-secondary)] sm:text-lg sm:leading-relaxed">
              Install in one command. Your agent opens structured plans with
              wireframes, diagrams, annotated code, and shareable review links —
              instead of dumping walls of markdown in the terminal.
            </p>

            <div className="template-detail-actions mb-8 grid grid-cols-2 items-stretch gap-3 sm:flex sm:flex-wrap sm:items-center">
              <a
                href="https://plan.agent-native.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
                onClick={() =>
                  trackEvent("try live demo", {
                    template: "plan",
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
              <TemplateDocsLink template={template} location="landing_page" />
              <CliCopy />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)]">
            <img
              src={template.screenshot}
              alt="Plans template screenshot"
              className="w-full object-cover object-top"
            />
          </div>
        </div>
      </section>

      {/* By the numbers */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="mx-auto grid max-w-3xl gap-px overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--docs-border)] sm:grid-cols-4">
          {[
            { number: "10+", label: "Block types" },
            { number: "3", label: "Agent integrations" },
            { number: "Live", label: "Shareable links" },
            { number: "AI", label: "Prototype runner" },
          ].map((stat) => (
            <div key={stat.label} className="bg-[var(--bg)] p-6 text-center">
              <div className="mb-1 text-2xl font-bold text-[var(--docs-accent)]">
                {stat.number}
              </div>
              <div className="text-sm text-[var(--fg-secondary)]">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Core capabilities */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          What agents can do
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          Every block type is a first-class citizen — structured data, not raw
          HTML, so the agent can read and update plans as the work evolves.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--docs-accent)]">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <rect x="7" y="7" width="3" height="9" />
                <rect x="14" y="7" width="3" height="5" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">Wireframes</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Sketchy UI mockups grounded in your real product — not generic
              desktop placeholders.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--docs-accent)]">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="5" r="2" />
                <circle cx="5" cy="19" r="2" />
                <circle cx="19" cy="19" r="2" />
                <line x1="12" y1="7" x2="5" y2="17" />
                <line x1="12" y1="7" x2="19" y2="17" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">Diagrams</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Architecture flowcharts, data models, and sequence diagrams
              rendered inline.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--docs-accent)]">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
                <line x1="12" y1="4" x2="12" y2="20" strokeDasharray="2 2" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">Annotated Code</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Real source files with per-line notes, diffs, and change rationale
              — not raw code dumps.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--docs-accent)]">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">Shareable Links</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Every plan gets a public URL. Share with teammates for async
              review, comments, and approvals.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--docs-accent)]">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 4h6l2 3h8v13H4z" />
                <path d="M8 13h8" />
                <path d="M12 9v8" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">Desktop File Sync</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Mirror hosted plans to local MDX files from Agent Native Desktop
              without cloning the app or running a CLI.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">How it works</h2>
        <p className="mb-10 max-w-2xl text-base text-[var(--fg-secondary)]">
          Planning lives in a shared app — both you and the agent can read and
          update it throughout the lifecycle of a feature.
        </p>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              step: "1",
              title: "Add the skill",
              body: "One command installs the plan skill into your Codex or Claude Code project. No separate app to deploy.",
            },
            {
              step: "2",
              title: "Agent opens a plan",
              body: "Ask your agent to plan a feature. It calls /visual-plan and the plan opens in your browser — structured blocks, not a wall of markdown.",
            },
            {
              step: "3",
              title: "Review & comment",
              body: "Pin comments to any block. Ask questions, flag concerns, or approve sections — the agent can see all feedback.",
            },
            {
              step: "4",
              title: "Agent iterates",
              body: "The agent reads your comments and updates the plan in-place. Diffs show exactly what changed and why.",
            },
          ].map((item) => (
            <div key={item.step} className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-sm font-bold text-[var(--docs-accent)] ring-1 ring-[var(--docs-border)]">
                {item.step}
              </div>
              <div>
                <h3 className="mb-1 text-sm font-semibold">{item.title}</h3>
                <p className="m-0 text-sm text-[var(--fg-secondary)]">
                  {item.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Block types deep-dive */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight">
              Rich block library
            </h2>
            <p className="mb-6 text-base text-[var(--fg-secondary)]">
              Plans are composed of structured blocks — not free-form HTML. The
              agent knows the schema for each block and can create, update, and
              reason about them precisely.
            </p>
            <ul className="m-0 list-none space-y-3 p-0 text-sm text-[var(--fg-secondary)]">
              {[
                "Wireframe — sketchy UI mockup with component slots",
                "Annotated code — source file with per-line notes",
                "Diagram — flowchart, sequence, or architecture",
                "Prototype — live Alpine.js sandbox in an iframe",
                "Decision — settled choices with rationale",
                "API endpoint — method, path, request/response types",
                "Data model — schema with field annotations",
                "File tree — project structure with notes per path",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
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
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-6">
            <div className="space-y-3 font-mono text-sm">
              <div className="text-[var(--fg-secondary)]">
                {"// Example plan block"}
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">type:</span>{" "}
                <span className="text-[var(--fg)]">annotated-code</span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">file:</span>{" "}
                <span className="text-[var(--fg)]">
                  src/actions/create-post.ts
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">annotations:</span>
              </div>
              <div className="pl-4">
                <span className="text-[var(--docs-accent)]">line 12:</span>{" "}
                <span className="text-[var(--fg)]">
                  Validate owner before insert
                </span>
              </div>
              <div className="pl-4">
                <span className="text-[var(--docs-accent)]">line 24:</span>{" "}
                <span className="text-[var(--fg)]">
                  Emit event for automations
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">change:</span>{" "}
                <span className="text-[var(--fg)]">add</span>
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
        <div className="overflow-x-auto rounded-xl border border-[var(--docs-border)]">
          <table className="comparison-table min-w-[42rem] w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--docs-border)] bg-[var(--bg-secondary)]">
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg)]"></th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  Markdown in terminal
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  ChatGPT Canvas / Notion
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--docs-accent)]">
                  Agent-Native Plans
                </th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Visual rendering
                </td>
                <td className="px-5 py-3">No</td>
                <td className="px-5 py-3">Basic</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Rich blocks, wireframes, diagrams
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Agent can read &amp; update
                </td>
                <td className="px-5 py-3">Yes, raw text</td>
                <td className="px-5 py-3">Limited</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Yes, structured schema
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Shareable link
                </td>
                <td className="px-5 py-3">No</td>
                <td className="px-5 py-3">Yes</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Yes, with comments
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Prototype runner
                </td>
                <td className="px-5 py-3">No</td>
                <td className="px-5 py-3">No</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Live Alpine.js sandbox
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Works with Codex / Claude Code
                </td>
                <td className="px-5 py-3">Yes</td>
                <td className="px-5 py-3">No</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Yes, one-command install
                </td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Open source
                </td>
                <td className="px-5 py-3">N/A</td>
                <td className="px-5 py-3">No</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Yes, MIT licensed
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--docs-border)] py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          Get started in seconds
        </h2>
        <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
          One command adds visual planning to any Codex or Claude Code project.
          No separate deployment needed.
        </p>
        <div className="template-detail-cta-actions flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:gap-4">
          <TemplateDocsLink
            template={template}
            location="landing_page_cta"
            className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Read the docs
          </TemplateDocsLink>
          <Link
            data-an-prefetch="render"
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
