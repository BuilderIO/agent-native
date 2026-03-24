import { Link } from "react-router";
import { useState } from "react";
import { templates, trackEvent } from "../components/TemplateCard";

export const meta = () => [
  {
    title:
      "AI-Native Calendar — Open Source Alternative to Google Calendar & Calendly",
  },
  {
    name: "description",
    content:
      "Build an AI-powered calendar you own. Open source alternative to Google Calendar and Calendly. Google Calendar sync, public booking pages, configurable availability, and natural language scheduling.",
  },
  {
    property: "og:title",
    content:
      "AI-Native Calendar — Open Source Alternative to Google Calendar & Calendly",
  },
  {
    property: "og:description",
    content:
      "Build an AI-powered calendar you own. Google Calendar sync, public booking pages, and natural language scheduling.",
  },
  {
    name: "keywords",
    content:
      "AI calendar, open source calendar, Google Calendar alternative, Calendly alternative, AI scheduling, agent-native calendar, AI booking page, open source scheduling, AI appointment booking, natural language scheduling",
  },
];

const template = templates.find((t) => t.slug === "calendar")!;

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

export default function CalendarTemplate() {
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
              Agent-Native Calendar
            </h1>

            <p className="mb-6 text-lg leading-relaxed text-[var(--fg-secondary)]">
              A full calendar app with Google Calendar sync and a Calendly-style
              public booking page. Let the agent manage your schedule, find open
              slots, and handle bookings.
            </p>

            <div className="mb-8 flex flex-col items-start gap-3">
              <CliCopy />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]">
            <img
              src={template.screenshot}
              alt="Calendar template screenshot"
              className="w-full object-cover object-top"
            />
          </div>
        </div>
      </section>

      {/* By the numbers */}
      <section className="border-t border-[var(--border)] py-16">
        <div className="mx-auto grid max-w-3xl gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-4">
          {[
            { number: "3", label: "Calendar views" },
            { number: "4", label: "Agent scripts" },
            { number: "1", label: "Public booking page" },
            { number: "2-way", label: "Google sync" },
          ].map((stat) => (
            <div key={stat.label} className="bg-[var(--bg)] p-6 text-center">
              <div className="mb-1 text-2xl font-bold text-[var(--accent)]">
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
      <section className="border-t border-[var(--border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          What you can do
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          Everything you need to replace your calendar and scheduling stack.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--accent)]">
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
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">
              Multiple Calendar Views
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Month, week, and day views with drag-and-drop event management.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--accent)]">
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
            <h3 className="mb-1 text-sm font-semibold">
              Natural Language Scheduling
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Tell the agent to find a slot, create an event, or reschedule — it
              handles the rest.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--accent)]">
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
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="20" y1="8" x2="20" y2="14" />
                <line x1="23" y1="11" x2="17" y2="11" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">Public Booking Page</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Calendly-style booking at /book/meeting. Visitors pick a slot from
              your availability.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--accent)]">
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
              The agent modifies the app itself. Need a new view or booking
              flow? Just ask.
            </p>
          </div>
        </div>
      </section>

      {/* Google Calendar + Booking */}
      <section className="border-t border-[var(--border)] py-16">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] p-6">
            <h3 className="mb-2 text-base font-semibold">
              Google Calendar Sync
            </h3>
            <p className="mb-4 text-sm text-[var(--fg-secondary)]">
              Connect via OAuth 2.0 and pull events from any Google Calendar.
              Create events that sync back to Google.
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
                OAuth 2.0 with automatic token refresh
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
                Pull-based sync — no webhooks needed
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
                Create, update, and delete events on Google
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-6">
            <h3 className="mb-2 text-base font-semibold">
              Calendly-Style Booking
            </h3>
            <p className="mb-4 text-sm text-[var(--fg-secondary)]">
              A public page where anyone can book time with you based on your
              configured availability.
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
                Date picker + time slot selection
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
                Respects your availability and existing events
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
                Visitor info capture + confirmation
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Agent scripts */}
      <section className="border-t border-[var(--border)] py-16">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight">
              Agent-powered scheduling
            </h2>
            <p className="mb-6 text-base text-[var(--fg-secondary)]">
              The agent runs scripts to sync calendars, create events, check
              availability, and manage bookings. All through natural language.
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
                "Sync my Google Calendar for this month"
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
                "Find a 30-minute slot next Tuesday for a team meeting"
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
                "Create a recurring standup at 9am every weekday"
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
                "Show me my availability for next week"
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
            <div className="space-y-3 font-mono text-sm">
              <div className="text-[var(--fg-secondary)]">
                {"// Available agent scripts"}
              </div>
              <div>
                <span className="text-[var(--accent)]">$</span>{" "}
                <span className="text-[var(--fg)]">
                  pnpm script sync-google-calendar --from 2026-01-01 --to
                  2026-06-01
                </span>
              </div>
              <div>
                <span className="text-[var(--accent)]">$</span>{" "}
                <span className="text-[var(--fg)]">
                  pnpm script create-event --title "Team Standup" --start
                  "2026-03-15T09:00"
                </span>
              </div>
              <div>
                <span className="text-[var(--accent)]">$</span>{" "}
                <span className="text-[var(--fg)]">
                  pnpm script check-availability --date "2026-03-18" --duration
                  30
                </span>
              </div>
              <div>
                <span className="text-[var(--accent)]">$</span>{" "}
                <span className="text-[var(--fg)]">
                  pnpm script list-events --from "2026-03-14" --to "2026-03-21"
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
                  Google Calendar
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  Calendly
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--accent)]">
                  Agent-Native Calendar
                </th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Calendar UI
                </td>
                <td className="px-5 py-3">Full, rigid</td>
                <td className="px-5 py-3">Minimal</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Full, fully customizable
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  AI scheduling
                </td>
                <td className="px-5 py-3">None</td>
                <td className="px-5 py-3">None</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Natural language, full control
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Booking page
                </td>
                <td className="px-5 py-3">Appointment slots</td>
                <td className="px-5 py-3">Yes, limited branding</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Fully customizable, own domain
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Customization
                </td>
                <td className="px-5 py-3">Settings only</td>
                <td className="px-5 py-3">Branding only</td>
                <td className="px-5 py-3 text-[var(--fg)]">Full source code</td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Pricing
                </td>
                <td className="px-5 py-3">Free / Workspace</td>
                <td className="px-5 py-3">$10+/mo per seat</td>
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
          Fork the template, connect Google Calendar, and start scheduling with
          AI.
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
