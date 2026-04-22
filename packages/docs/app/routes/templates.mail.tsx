import { Link } from "react-router";
import { useState } from "react";
import { templates, trackEvent } from "../components/TemplateCard";

export const meta = () => [
  {
    title: "AI-Native Mail — Open Source Alternative to Gmail & Superhuman",
  },
  {
    name: "description",
    content:
      "Build an AI-powered email client you own. Superhuman-style keyboard shortcuts, AI triage, smart search, and a fully customizable interface. Open source alternative to Gmail and Superhuman.",
  },
  {
    property: "og:title",
    content: "AI-Native Mail — Open Source Alternative to Gmail & Superhuman",
  },
  {
    property: "og:description",
    content:
      "Superhuman-style email client with keyboard shortcuts, AI triage, and a fully customizable interface. Own your inbox workflow.",
  },
  {
    name: "keywords",
    content:
      "AI email client, open source email, Gmail alternative, Superhuman alternative, AI inbox, keyboard shortcuts email, agent-native mail, AI email triage, smart inbox, natural language email",
  },
];

const template = templates.find((t) => t.slug === "mail")!;

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

export default function MailTemplate() {
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
              {template.replaces}
            </div>

            <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
              The open-source alternative to Superhuman and Gmail
            </h1>

            <p className="mb-6 text-lg leading-relaxed text-[var(--fg-secondary)]">
              Superhuman-style keyboard shortcuts, AI triage, smart search, and
              multi-account support — built on an agent you own. No subscription
              fees, no vendor lock-in.
            </p>

            <div className="mb-8 flex flex-wrap items-center gap-3">
              <a
                href="https://mail.agent-native.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
                onClick={() =>
                  trackEvent("try_live_demo", {
                    template: "mail",
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
              alt="Mail template screenshot"
              className="w-full object-cover object-top"
            />
          </div>
        </div>
      </section>

      {/* By the numbers */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="mx-auto grid max-w-3xl gap-px overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--docs-border)] sm:grid-cols-4">
          {[
            { number: "⌨️", label: "Keyboard-first" },
            { number: "AI", label: "Inbox triage" },
            { number: "3", label: "Views" },
            { number: "∞", label: "Customizable" },
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
          What you can do
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          Everything you need to replace your email client with an AI-powered
          inbox you fully own.
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
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">Keyboard Shortcuts</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Superhuman-style bindings for compose, archive, reply, and
              navigation. Zero mouse required.
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
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">AI Triage</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              The agent reads your inbox, surfaces what matters, drafts replies,
              and handles routine emails automatically. Set up automations for
              auto-labeling and auto-archiving.
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
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">Smart Search</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Natural language search across your entire inbox. "Emails from
              last week about the budget" just works.
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
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">Self-Improving</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              The agent modifies the app itself. Need a custom folder, filter,
              or automation? Just ask.
            </p>
          </div>
        </div>
      </section>

      {/* Inbox + Compose */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--docs-border)] p-6">
            <h3 className="mb-2 text-base font-semibold">
              AI-Powered Inbox Management
            </h3>
            <p className="mb-4 text-sm text-[var(--fg-secondary)]">
              Let the agent do the heavy lifting — triage, label, archive, and
              draft responses from natural language instructions.
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
                Automatic labeling, priority sorting, and auto-archive rules
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
                AI-drafted replies for routine messages
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
                Thread summarization and action items
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] p-6">
            <h3 className="mb-2 text-base font-semibold">
              Keyboard-First Compose
            </h3>
            <p className="mb-4 text-sm text-[var(--fg-secondary)]">
              Write and send email at the speed of thought. Full keyboard
              navigation, Notion-style shortcuts, and AI-assisted drafting.
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
                Multiple draft tabs for composing several emails at once
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
                AI expands short drafts into full emails
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
                Send later, snooze, and follow-up reminders
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Agent actions */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight">
              Agent-powered email workflows
            </h2>
            <p className="mb-6 text-base text-[var(--fg-secondary)]">
              The agent reads, drafts, and organizes your email through natural
              language. Every workflow is a script you can inspect and extend.
            </p>
            <ul className="m-0 list-none space-y-3 p-0 text-sm text-[var(--fg-secondary)]">
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
                "Summarize my unread emails from this week"
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
                "Draft a reply to the investor update thread"
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
                "Archive all newsletters older than 7 days"
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
                "Find all emails waiting on a reply from me"
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-6">
            <div className="space-y-3 font-mono text-sm">
              <div className="text-[var(--fg-secondary)]">
                {"// Available agent actions"}
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">$</span>{" "}
                <span className="text-[var(--fg)]">
                  pnpm action sync-inbox --since 7d
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">$</span>{" "}
                <span className="text-[var(--fg)]">
                  pnpm action triage --label priority
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">$</span>{" "}
                <span className="text-[var(--fg)]">
                  pnpm action draft-reply --thread "RE: Q2 update"
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">$</span>{" "}
                <span className="text-[var(--fg)]">
                  pnpm action summarize --unread
                </span>
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
                  Gmail
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  Superhuman
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--docs-accent)]">
                  Agent-Native Mail
                </th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Keyboard shortcuts
                </td>
                <td className="px-5 py-3">Basic</td>
                <td className="px-5 py-3">Excellent</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Fully customizable
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  AI assistance
                </td>
                <td className="px-5 py-3">Smart compose</td>
                <td className="px-5 py-3">AI replies</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Full agent: triage, draft, automate
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Customization
                </td>
                <td className="px-5 py-3">Settings only</td>
                <td className="px-5 py-3">Themes only</td>
                <td className="px-5 py-3 text-[var(--fg)]">Full source code</td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Data ownership
                </td>
                <td className="px-5 py-3">Google's servers</td>
                <td className="px-5 py-3">Vendor-hosted</td>
                <td className="px-5 py-3 text-[var(--fg)]">You own the code</td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Pricing
                </td>
                <td className="px-5 py-3">Free / Workspace</td>
                <td className="px-5 py-3">$30/mo per user</td>
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
          Fork the template, connect your email provider, and start managing
          your inbox with AI.
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
