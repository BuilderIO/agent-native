import { Link } from "react-router";
import { useState } from "react";
import { templates, trackEvent } from "../components/TemplateCard";

export const meta = () => [
  {
    title: "Agent-Native Video — Open Source AI Video Editor & Remotion Studio",
  },
  {
    name: "description",
    content:
      "Create and edit video compositions with AI. Open source video studio built on Remotion. Track-based animation system, 30+ easing curves, interactive cursor system, 6D camera controls, keyframe editing, and 12 example compositions.",
  },
  {
    property: "og:title",
    content:
      "Agent-Native Video — Open Source AI Video Editor & Remotion Studio",
  },
  {
    property: "og:description",
    content:
      "Create and edit video compositions with AI. Full animation studio built on Remotion.",
  },
  {
    name: "keywords",
    content:
      "AI video editor, AI video generator, open source video editor, Remotion video, AI video creation, agent-native video, programmatic video, AI motion graphics, AI animation tool, open source animation studio, React video editor",
  },
];

const template = templates.find((t) => t.slug === "video")!;

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

export default function VideoTemplate() {
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
              An open-source, Agent-native video editor
            </h1>

            <p className="mb-6 text-lg leading-relaxed text-[var(--fg-secondary)]">
              A full composition studio built on Remotion — keyframe animation,
              30+ easing curves, and an agent that edits with you.
            </p>

            <div className="mb-8 flex flex-wrap items-center gap-3">
              <a
                href="https://videos.agent-native.com"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  trackEvent("click try demo", {
                    template: template.slug,
                    location: "landing_page",
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
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                Try It
              </a>
              <CliCopy />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)]">
            <img
              src={template.screenshot}
              alt="Video template screenshot"
              className="w-full object-cover object-top"
            />
          </div>
        </div>
      </section>

      {/* By the numbers */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="mx-auto grid max-w-3xl gap-px overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--docs-border)] sm:grid-cols-4">
          {[
            { number: "30+", label: "Easing curves" },
            { number: "12", label: "Example compositions" },
            { number: "3", label: "Track types" },
            { number: "6D", label: "Camera controls" },
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

      {/* Animation system - two column highlight */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          Professional animation system
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          Every animation is a track in the timeline — visible, editable, and
          reorderable.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Duration Tracks</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Drag handles to set start/end. Visual bars in the timeline.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Keyframe Tracks</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Diamond markers at arbitrary frames. Per-property with independent
              easing.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Expression Tracks</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Programmatic animations — typing reveals, particle bursts, stagger
              effects.
            </p>
          </div>
        </div>
      </section>

      {/* Easing + camera - split section */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--docs-border)] p-6">
            <h3 className="mb-2 text-base font-semibold">30+ Easing Curves</h3>
            <p className="mb-4 text-sm text-[var(--fg-secondary)]">
              Visual curve picker shows the shape of each easing.
            </p>
            <div className="flex flex-wrap gap-2 text-xs text-[var(--fg-secondary)]">
              {[
                "linear",
                "power1-4",
                "back",
                "bounce",
                "circ",
                "elastic",
                "expo",
                "sine",
                "spring",
              ].map((e) => (
                <span
                  key={e}
                  className="rounded-md border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-2 py-1"
                >
                  {e}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] p-6">
            <h3 className="mb-2 text-base font-semibold">6D Camera Controls</h3>
            <p className="mb-4 text-sm text-[var(--fg-secondary)]">
              Pan, zoom, and 3D tilt with perspective depth.
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
                Pan X/Y, zoom scale, rotateX/Y
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
                3x internal scale for crisp output at high zoom
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
                Animated camera keyframes
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Interactive cursor + keyframes */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight">
              Interactive cursor system
            </h2>
            <p className="mb-4 text-base text-[var(--fg-secondary)]">
              Three cursor styles with hover zone detection, smooth transitions,
              and click animations. Perfect for product demos.
            </p>
            <div className="flex gap-4 text-sm text-[var(--fg-secondary)]">
              <div className="rounded-lg border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-4 py-2 text-center">
                <div className="mb-1 text-lg">↖</div>
                Arrow
              </div>
              <div className="rounded-lg border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-4 py-2 text-center">
                <div className="mb-1 text-lg">☝</div>
                Pointer
              </div>
              <div className="rounded-lg border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-4 py-2 text-center">
                <div className="mb-1 text-lg">|</div>
                I-beam
              </div>
            </div>
          </div>
          <div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight">
              Multi-keyframe editing
            </h2>
            <p className="mb-4 text-base text-[var(--fg-secondary)]">
              Box-select multiple keyframes, shift-click to add/remove, drag
              groups while preserving relative timing.
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
                Per-property keyframes at arbitrary frames
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
                Independent easing per keyframe
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
                Group drag with relative timing preserved
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Remotion powered */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="mx-auto grid max-w-3xl gap-px overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--docs-border)] sm:grid-cols-3">
          <div className="bg-[var(--bg)] p-6 text-center">
            <div className="mb-1 text-sm font-semibold">React Components</div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Videos are React at 1920x1080, 30fps
            </p>
          </div>
          <div className="bg-[var(--bg)] p-6 text-center">
            <div className="mb-1 text-sm font-semibold">Render to MP4/WebM</div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Export via Remotion CLI
            </p>
          </div>
          <div className="bg-[var(--bg)] p-6 text-center">
            <div className="mb-1 text-sm font-semibold">12 Compositions</div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Kinetic text, logos, UI demos, and more
            </p>
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
                  After Effects / Premiere
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  AI Video Tools
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--docs-accent)]">
                  Agent-Native Video
                </th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Timeline editor
                </td>
                <td className="px-5 py-3">Professional</td>
                <td className="px-5 py-3">None / basic</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Visual tracks + keyframes
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  AI assistance
                </td>
                <td className="px-5 py-3">None / basic</td>
                <td className="px-5 py-3">Generation only</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Full create + edit + iterate
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Programmatic
                </td>
                <td className="px-5 py-3">ExtendScript</td>
                <td className="px-5 py-3">API-only</td>
                <td className="px-5 py-3 text-[var(--fg)]">React components</td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Customization
                </td>
                <td className="px-5 py-3">Plugins</td>
                <td className="px-5 py-3">Templates only</td>
                <td className="px-5 py-3 text-[var(--fg)]">Full source code</td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Pricing
                </td>
                <td className="px-5 py-3">$55+/mo subscription</td>
                <td className="px-5 py-3">Per-render</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Free & open source
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
          Fork the template and start creating video compositions with AI.
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
