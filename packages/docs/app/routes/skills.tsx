import { Link } from "react-router";
import { useState } from "react";
import { IconBrandGithub } from "@tabler/icons-react";
import { trackEvent } from "@agent-native/core/client";
import { withDefaultSocialImage } from "../seo";

export const meta = () =>
  withDefaultSocialImage([
    {
      title: "Agent Skills — Visual Plan & Visual Recap for coding agents",
    },
    {
      name: "description",
      content:
        "Install app-backed skills your coding agent runs as slash commands. /visual-plan opens structured visual plans before you build; /visual-recap turns a PR diff into a high-altitude review. One install, free and open source.",
    },
    {
      property: "og:title",
      content: "Agent Skills — Visual Plan & Visual Recap for coding agents",
    },
    {
      property: "og:description",
      content:
        "Give your coding agent new superpowers: structured visual plans and high-altitude PR recaps, hosted and shareable. One install, free and open source.",
    },
    {
      name: "keywords",
      content:
        "agent skills, visual plan, visual recap, coding agent, Claude Code, Codex, PR review, planning, slash command, agent-native",
    },
  ]);

const INSTALL_COMMAND = "npx @agent-native/core@latest skills add visual-plan";
const GITHUB_ACTION_COMMAND =
  "npx @agent-native/core@latest skills add visual-plan --with-github-action";
const DEMO_URL = "https://plan.agent-native.com";

type Skill = {
  command: string;
  name: string;
  tagline: string;
  description: string;
  features: string[];
  docsTo: string;
  note?: string;
};

const SKILLS: Skill[] = [
  {
    command: "/visual-plan",
    name: "Visual Plan",
    tagline: "Plan before you implement",
    description:
      "Structured visual planning mode for coding agents. The plan you'd normally write in Markdown, but as a scannable document with editable blocks — and an optional visual review surface for anything UI.",
    features: [
      "Inline diagrams and data-model maps near each claim",
      "Annotated code for the key files you'll touch",
      "Optional wireframe canvas plus a clickable prototype",
      "Comments, annotations, and a shareable review link",
    ],
    docsTo: "/docs/template-plan",
  },
  {
    command: "/visual-recap",
    name: "Visual Recap",
    tagline: "Review a diff at a higher altitude",
    description:
      "The reverse of forward planning: turn a PR or git diff into a structured recap — schema, API, file, and before/after changes as grounded blocks instead of a wall of diff a reviewer has to read line by line.",
    features: [
      "Schema, API, file-tree, and diagram blocks built from the diff",
      "High-altitude shape of the change before the literal lines",
      "Optional GitHub Action recaps every pull request",
      "Posts one sticky PR comment with an inline screenshot",
    ],
    docsTo: "/docs/pr-visual-recap",
    note: "Interactive install can offer the PR Action, or add it later with --with-github-action.",
  },
];

function CheckIcon() {
  return (
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
  );
}

function ExternalIcon() {
  return (
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
  );
}

function CliCopy({
  command,
  location,
  className = "",
}: {
  command: string;
  location: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(command);
    setCopied(true);
    trackEvent("copy cli command", { skill: "visual-plan", location });
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={handleCopy}
      className={`group flex w-full min-w-0 items-center gap-3 rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] px-4 py-3 font-mono text-sm transition hover:border-[var(--fg-secondary)] sm:px-5 ${className}`}
    >
      <span className="shrink-0 text-[var(--fg-secondary)]">$</span>
      <span className="min-w-0 truncate text-left text-[var(--fg)]">
        {command}
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

function SkillCard({ skill }: { skill: Skill }) {
  return (
    <article className="flex flex-col rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-6">
      <div className="mb-3 flex items-center gap-3">
        <span className="rounded-md border border-[var(--code-border)] bg-[var(--code-bg)] px-2 py-1 font-mono text-sm text-[var(--fg)]">
          {skill.command}
        </span>
        <span className="text-sm text-[var(--fg-secondary)]">
          {skill.tagline}
        </span>
      </div>

      <h3 className="mb-2 text-lg font-semibold tracking-tight">
        {skill.name}
      </h3>
      <p className="mb-5 text-sm leading-relaxed text-[var(--fg-secondary)]">
        {skill.description}
      </p>

      <ul className="m-0 mb-5 list-none space-y-2 p-0 text-sm text-[var(--fg-secondary)]">
        {skill.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <CheckIcon />
            {f}
          </li>
        ))}
      </ul>

      {skill.note && (
        <p className="mb-5 rounded-lg bg-[var(--code-bg)] px-3 py-2 font-mono text-xs text-[var(--fg-secondary)]">
          {skill.note}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-4 pt-1">
        <Link
          data-an-prefetch="render"
          to={skill.docsTo}
          onClick={() =>
            trackEvent("skill read docs", {
              skill: skill.command,
              location: "skills_card",
            })
          }
          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--fg)] no-underline hover:text-[var(--docs-accent)]"
        >
          Read the docs
          <span aria-hidden>→</span>
        </Link>
        <a
          href={DEMO_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() =>
            trackEvent("skill try demo", {
              skill: skill.command,
              location: "skills_card",
            })
          }
          className="inline-flex items-center gap-1 text-sm text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)]"
        >
          Live demo
          <ExternalIcon />
        </a>
      </div>
    </article>
  );
}

export default function SkillsPage() {
  return (
    <main className="mx-auto w-full max-w-[1200px] overflow-x-clip px-4 sm:px-6">
      {/* Hero */}
      <section className="py-12 sm:py-16 lg:py-20">
        <div className="grid min-w-0 gap-10 lg:grid-cols-2 lg:items-center lg:gap-12">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--fg-secondary)]">
              <span className="inline-block h-2 w-2 rounded-full bg-[var(--docs-accent)]" />
              Agent skills
            </div>

            <h1 className="mb-4 text-[2rem] font-bold leading-[1.08] tracking-tight sm:text-4xl md:text-5xl">
              Give your coding agent new superpowers
            </h1>

            <p className="mb-6 text-base leading-7 text-[var(--fg-secondary)] sm:text-lg sm:leading-relaxed">
              Install app-backed skills your coding agent runs as slash commands
              — structured visual plans before you build, and high-altitude
              recaps of any diff. Hosted, shareable, and 100% open source.
            </p>

            <CliCopy command={INSTALL_COMMAND} location="skills_hero" />
            <p className="mt-3 text-xs text-[var(--fg-secondary)]">
              One install adds the full Agent-Native Plan skill set — including{" "}
              <code className="font-mono">/visual-recap</code>.
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)]">
            <img
              src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fb6f4213ac7cc42eeb10c12e8ccda8936?format=webp&width=1000"
              alt="An Agent-Native visual plan with inline diagrams and structured blocks"
              className="w-full object-cover object-top"
            />
          </div>
        </div>
      </section>

      {/* Skill cards */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          Two skills, one install
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          Both ship in the same bundle and publish to the hosted Plan app, so
          your agent can open a plan and hand you a link to review.
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          {SKILLS.map((skill) => (
            <SkillCard key={skill.command} skill={skill} />
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-8 text-2xl font-bold tracking-tight">How it works</h2>
        <div className="mx-auto grid max-w-3xl gap-6 sm:grid-cols-3">
          {[
            {
              step: "1",
              title: "Install",
              desc: "Run one command. It adds the slash-command skills and wires up the hosted Plan connector your agent publishes to.",
            },
            {
              step: "2",
              title: "Run a slash command",
              desc: "Ask your agent for /visual-plan before a change, or /visual-recap after one. It authors the plan and returns a link.",
            },
            {
              step: "3",
              title: "Review & share",
              desc: "Open the interactive plan, annotate or comment inline, and share a review link — reviewers edit as a guest.",
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

        <div className="mx-auto mt-12 max-w-3xl rounded-xl border border-[var(--docs-border)] p-6 sm:p-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-3 py-1 text-xs font-medium text-[var(--docs-accent)]">
            <IconBrandGithub size={14} stroke={1.5} />
            GitHub Action
          </div>
          <h3 className="mb-2 text-xl font-semibold tracking-tight">
            Get a visual recap on every pull request
          </h3>
          <p className="mb-5 max-w-2xl text-sm leading-relaxed text-[var(--fg-secondary)]">
            Add the PR Visual Recap action and every PR reviews itself: a coding
            agent reads the diff, publishes an interactive{" "}
            <code className="font-mono">/visual-recap</code> plan, and upserts
            one sticky comment with an inline screenshot linking to it.
            High-altitude review built into your workflow — informational and
            non-blocking.
          </p>
          <CliCopy
            command={GITHUB_ACTION_COMMAND}
            location="skills_github_action"
          />
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--fg-secondary)]">
            The interactive install also offers this Action when no workflow is
            present. After the workflow is written, run{" "}
            <code className="font-mono">
              npx @agent-native/core@latest recap setup
            </code>{" "}
            and{" "}
            <code className="font-mono">
              npx @agent-native/core@latest recap doctor
            </code>{" "}
            to configure and verify GitHub Actions.
          </p>
          <Link
            data-an-prefetch="render"
            to="/docs/pr-visual-recap"
            onClick={() =>
              trackEvent("skill read docs", {
                skill: "/visual-recap",
                location: "skills_github_action",
              })
            }
            className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-[var(--fg)] no-underline hover:text-[var(--docs-accent)]"
          >
            Read the PR Visual Recap docs
            <span aria-hidden>→</span>
          </Link>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--docs-border)] py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          Add it to your agent in seconds
        </h2>
        <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
          Works with Claude Code, Codex, Cursor, and any MCP-compatible agent.
        </p>
        <div className="mx-auto max-w-xl">
          <CliCopy command={INSTALL_COMMAND} location="skills_cta" />
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
          <Link
            data-an-prefetch="render"
            to="/docs/template-plan"
            className="inline-flex items-center gap-1 text-sm font-medium text-[var(--fg)] no-underline hover:text-[var(--docs-accent)]"
          >
            Read the Visual Plans docs
            <span aria-hidden>→</span>
          </Link>
          <Link
            data-an-prefetch="render"
            to="/templates"
            className="inline-flex items-center gap-1 text-sm text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)]"
          >
            Browse templates
            <span aria-hidden>→</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
