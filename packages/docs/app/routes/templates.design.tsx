import { Link } from "react-router";
import { useState } from "react";
import { templates, trackEvent } from "../components/TemplateCard";

export const meta = () => [
  {
    title: "AI-Native Design — Open Source AI Design Tool & Figma Alternative",
  },
  {
    name: "description",
    content:
      "Create and edit visual designs with AI. Open source alternative to Figma and Canva. Generate layouts from prompts, edit on a real canvas, and refine conversationally with an agent that designs alongside you.",
  },
  {
    property: "og:title",
    content:
      "AI-Native Design — Open Source AI Design Tool & Figma Alternative",
  },
  {
    property: "og:description",
    content:
      "An AI-native design tool. Generate, edit, and refine designs conversationally — built on an agent you own.",
  },
  {
    name: "keywords",
    content:
      "AI design tool, AI Figma alternative, open source design tool, Canva alternative, AI graphic design, AI image generation, agent-native design, prompt to design, AI canvas editor, AI vector tool, generative design",
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
              {template.replaces}
            </div>

            <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
              The open-source AI alternative to Figma &amp; Canva
            </h1>

            <p className="mb-6 text-lg leading-relaxed text-[var(--fg-secondary)]">
              Generate visuals from a prompt, edit on a real canvas, and refine
              conversationally. The agent designs with you — and you own every
              pixel of the source code.
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
              desc: "Tell the agent what you're making — a poster, a social post, a product mockup. Attach references.",
            },
            {
              step: "2",
              title: "Generate",
              desc: "The agent lays out elements on the canvas — typography, color, imagery, alignment.",
            },
            {
              step: "3",
              title: "Refine",
              desc: "Drag, click, and tweak directly. Or just say what you want changed and watch it happen.",
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
          A full visual editor with an agent that designs alongside you.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Real Canvas Editing</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Click to select, drag to move, resize handles, alignment guides,
              snapping. Designed to feel like Figma.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">AI Image Generation</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Generate hero imagery, illustrations, and textures inline.
              Reference images for brand-consistent results.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">
              Typography &amp; Layout
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Hundreds of fonts, smart pairings, and auto-layout for cards,
              grids, and stacks.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Conversational Edits</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              "Make the headline bolder", "swap the photo for something darker",
              "add a CTA button". The agent applies edits on the canvas.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Brand Kits</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Save colors, fonts, and logos. The agent uses your kit
              automatically when generating new designs.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-1 text-sm font-semibold">Export Anywhere</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              PNG, SVG, PDF, and copy-paste-ready HTML. Share read-only links
              for review.
            </p>
          </div>
        </div>
      </section>

      {/* Two-column highlight */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--docs-border)] p-6">
            <h3 className="mb-2 text-base font-semibold">Multiplayer Canvas</h3>
            <p className="mb-4 text-sm text-[var(--fg-secondary)]">
              Live cursors, presence, and real-time edits powered by Yjs CRDTs.
              The agent participates as a peer — you see what it's doing as it
              works.
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
                Live cursors and selection awareness
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
                Watch the agent edit in real time
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
                Comments anchored to specific elements
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] p-6">
            <h3 className="mb-2 text-base font-semibold">
              Conversational Refinement
            </h3>
            <p className="mb-4 text-sm text-[var(--fg-secondary)]">
              The agent edits the canvas in real time. Plain-English
              instructions become structured changes you can undo, redo, and
              inspect.
            </p>
            <div className="space-y-3 rounded-lg bg-[var(--bg-secondary)] p-4 font-mono text-sm">
              <div className="text-[var(--fg-secondary)]">
                "Make this look more premium"
              </div>
              <div className="text-[var(--fg-secondary)]">
                "Try a darker color palette"
              </div>
              <div className="text-[var(--fg-secondary)]">
                "Resize the logo and center it"
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
                  Figma / Canva
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  AI Image Generators
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
                <td className="px-5 py-3">Yes</td>
                <td className="px-5 py-3">None</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Visual + agent + code
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  AI generation
                </td>
                <td className="px-5 py-3">Plugin add-ons</td>
                <td className="px-5 py-3">One-shot prompt</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Iterative, conversational
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Editable output
                </td>
                <td className="px-5 py-3">Yes</td>
                <td className="px-5 py-3">Flat raster</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Full layered canvas
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
          Fork the template and start designing with an agent that actually
          understands your brand.
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
