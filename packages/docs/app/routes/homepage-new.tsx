import { useLocale } from "@agent-native/core/client";
import {
  IconActivity,
  IconAppWindow,
  IconArrowRight,
  IconBlocks,
  IconChartDots,
  IconCode,
  IconDatabase,
  IconGitBranch,
  IconLock,
  IconMicrophone,
  IconNetwork,
  IconPackage,
  IconPlugConnected,
  IconRefresh,
  IconRobot,
  IconServer,
  IconSettingsAutomation,
  IconShare,
  IconShieldLock,
  IconStack2,
  IconTerminal2,
  IconUsers,
} from "@tabler/icons-react";
import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router";

import { sitePathForLocale } from "../components/docs-locale";
import {
  featuredTemplates,
  trackEvent,
  type Template,
} from "../components/TemplateCard";
import { agentNativeSocialImageUrl, withDefaultSocialImage } from "../seo";

type IconComponent = ComponentType<{
  className?: string;
  size?: number;
  stroke?: number;
  "aria-hidden"?: boolean;
}>;

type ModuleCard = {
  name: string;
  description: string;
  icon: IconComponent;
  tags: string[];
};

type ExampleApp = {
  template: Template;
  description: string;
  modules: string[];
};

const HERO_TEMPLATE_SLUGS = ["plan", "clips", "design", "analytics"];
const EXAMPLE_TEMPLATE_SLUGS = [
  "plan",
  "clips",
  "design",
  "analytics",
  "mail",
  "calendar",
];

const heroTemplates = HERO_TEMPLATE_SLUGS.flatMap((slug) =>
  featuredTemplates.filter((template) => template.slug === slug),
);

const exampleDescriptions: Record<string, Omit<ExampleApp, "template">> = {
  plan: {
    description:
      "Visual planning, comments, review state, and artifacts that agents can read back as structured context.",
    modules: ["sharing", "collab", "audit logs", "agent context"],
  },
  clips: {
    description:
      "Screen capture, voice context, desktop handoff, durable uploads, and shareable review links.",
    modules: ["voice", "queues", "sharing", "desktop"],
  },
  design: {
    description:
      "A robust UI where the agent can inspect screens, generate directions, and safely modify source-backed views.",
    modules: ["generative UI", "sync", "workspaces", "skills"],
  },
  analytics: {
    description:
      "Provider APIs, dashboards, SQL-backed analysis, and observability surfaces for agent-run reporting.",
    modules: ["MCP", "ORM", "observability", "provider grants"],
  },
  mail: {
    description:
      "Human approval loops, provider auth, queueable drafts, and actions shared by UI and agent.",
    modules: ["auth", "actions", "governance", "approvals"],
  },
  calendar: {
    description:
      "Scheduling workflows with durable state, external integrations, and agent-operable booking flows.",
    modules: ["automations", "external agents", "workspaces", "sharing"],
  },
};

const exampleApps: ExampleApp[] = EXAMPLE_TEMPLATE_SLUGS.flatMap((slug) => {
  const template = featuredTemplates.find((item) => item.slug === slug);
  const details = exampleDescriptions[slug];
  return template && details ? [{ template, ...details }] : [];
});

const moduleCards: ModuleCard[] = [
  {
    name: "Auto state syncing",
    description:
      "Agent changes update the UI, and the UI state stays visible to the agent without inventing another bridge.",
    icon: IconRefresh,
    tags: ["application state", "UI sync", "agent context"],
  },
  {
    name: "Actions",
    description:
      "One operation surface powers the agent, frontend, CLI, MCP, A2A, and HTTP instead of six divergent APIs.",
    icon: IconCode,
    tags: ["tools", "mutations", "shared contracts"],
  },
  {
    name: "SQL state and ORM",
    description:
      "Durable data, application state, migrations, admin views, and provider-agnostic schemas.",
    icon: IconDatabase,
    tags: ["Drizzle", "SQLite", "Postgres"],
  },
  {
    name: "Auth and governance",
    description:
      "Login, organizations, multi-tenancy, permissions, approvals, and policy hooks for real users.",
    icon: IconShieldLock,
    tags: ["auth", "RBAC", "organizations"],
  },
  {
    name: "Sharing",
    description:
      "Share links, scoped access, public/private resource state, comments, and review surfaces.",
    icon: IconShare,
    tags: ["links", "visibility", "comments"],
  },
  {
    name: "Realtime collaboration",
    description:
      "Multi-user collaboration, live cursors, optimistic UI, and server-backed reconciliation for shared work.",
    icon: IconUsers,
    tags: ["Yjs", "SSE", "presence"],
  },
  {
    name: "Agent interoperability",
    description:
      "A2A, MCP, MCP apps, external agents, harness agents, and handoffs between focused apps.",
    icon: IconNetwork,
    tags: ["A2A", "MCP", "external agents"],
  },
  {
    name: "Automations and queues",
    description:
      "Event-triggered work, scheduled tasks, reliable mutations, background runs, and queueable jobs.",
    icon: IconSettingsAutomation,
    tags: ["cron", "jobs", "durable runs"],
  },
  {
    name: "Agent UI surface",
    description:
      "Chat, skills, instructions, generative UI, voice input, and the context the agent needs to work.",
    icon: IconRobot,
    tags: ["chat", "skills", "voice"],
  },
  {
    name: "Observability",
    description:
      "Tracing, evals, feedback, audit logs, experiments, and the proof that agents did what they claimed.",
    icon: IconChartDots,
    tags: ["traces", "evals", "audit logs"],
  },
  {
    name: "Workspaces",
    description:
      "Composable agentic apps that discover each other and coordinate without becoming one giant app.",
    icon: IconBlocks,
    tags: ["mini-apps", "A2A", "context"],
  },
  {
    name: "Source ownership",
    description:
      "Framework modules and example app source live where local agents can inspect, fork, eject, and replace them.",
    icon: IconPackage,
    tags: ["node_modules", "forkable", "replaceable"],
  },
];

const appShapes = [
  {
    title: "Automation-first apps",
    description:
      "Use no-browser apps for schedules, queues, scripts, and provider integrations when the workflow does not need a UI yet.",
    icon: IconTerminal2,
  },
  {
    title: "Agents with robust UIs",
    description:
      "Give humans dense, polished application surfaces while the agent operates the same state and actions.",
    icon: IconAppWindow,
  },
  {
    title: "Applications with an agentic core",
    description:
      "Make the agent part of the architecture, not a chat box bolted onto a product that cannot see itself.",
    icon: IconStack2,
  },
];

const sourceFlow = [
  {
    title: "Built-in modules",
    body: "Human-reviewed pieces for the production parts agents should not invent from scratch.",
    detail:
      "@agent-native/core modules, docs, skills, server plugins, client helpers",
  },
  {
    title: "Example apps",
    body: "Real compositions like Plan, Clips, Design, Analytics, Mail, and Calendar prove how modules work together.",
    detail:
      "Fork them, mine patterns from them, or replace the pieces that are not your differentiator.",
  },
  {
    title: "Your app",
    body: "Keep the verified pieces and focus your agent on product logic, workflows, and the thing only you can build.",
    detail:
      "Start with chat, fork a working app, or run automation-first when no browser UI is needed yet.",
  },
];

export const meta = () =>
  withDefaultSocialImage(
    [
      { title: "Agent-Native Homepage Direction" },
      {
        name: "description",
        content:
          "A module-first homepage direction for building agentic applications with replaceable Agent-Native modules and forkable example apps.",
      },
      {
        property: "og:title",
        content: "Agent-Native Homepage Direction",
      },
      {
        property: "og:description",
        content:
          "Build chat-first agentic apps, robust agent UIs, and automation-first workflows from replaceable modules.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
    agentNativeSocialImageUrl("Agentic applications", "Agent-Native"),
  );

function ArrowLink({
  children,
  to,
  location,
  variant = "primary",
}: {
  children: ReactNode;
  to: string;
  location: string;
  variant?: "primary" | "secondary";
}) {
  const isInternalPath = to.startsWith("/");
  const className =
    variant === "primary"
      ? "inline-flex min-w-0 items-center justify-center gap-2 rounded-full bg-[var(--fg)] px-5 py-3 text-sm font-medium text-[var(--bg)] no-underline transition hover:opacity-85 hover:no-underline"
      : "inline-flex min-w-0 items-center justify-center gap-2 rounded-full border border-[var(--docs-border)] bg-[var(--bg)] px-5 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline";

  if (isInternalPath) {
    return (
      <Link
        data-an-prefetch="render"
        to={to}
        className={className}
        onClick={() =>
          trackEvent("click cta", {
            label: typeof children === "string" ? children : "homepage_new",
            location,
          })
        }
      >
        <span className="truncate">{children}</span>
        <IconArrowRight className="size-4 shrink-0" aria-hidden />
      </Link>
    );
  }

  return (
    <a
      href={to}
      className={className}
      onClick={() =>
        trackEvent("click cta", {
          label: typeof children === "string" ? children : "homepage_new",
          location,
        })
      }
    >
      <span className="truncate">{children}</span>
      <IconArrowRight className="size-4 shrink-0" aria-hidden />
    </a>
  );
}

function HeroScreens() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-[var(--docs-border)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,var(--bg)_0%,transparent_18%,transparent_68%,var(--bg)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,transparent_0%,transparent_34%,var(--bg)_76%)] opacity-95" />
      <div className="absolute inset-x-[-7rem] top-6 grid rotate-[-4deg] grid-cols-2 gap-5 opacity-15 md:inset-x-[-8rem] md:top-0 md:grid-cols-4 md:opacity-35">
        {heroTemplates.map((template, index) => (
          <div
            key={template.slug}
            className={`overflow-hidden rounded-lg border border-[var(--docs-border)] bg-[var(--bg-secondary)] shadow-[0_18px_70px_rgba(0,0,0,0.12)] ${
              index % 2 === 0 ? "translate-y-16" : "-translate-y-2"
            }`}
          >
            <img
              src={template.screenshot}
              alt=""
              className="aspect-[4/3] w-full object-cover"
              loading="lazy"
              decoding="async"
              aria-hidden="true"
            />
          </div>
        ))}
      </div>
      <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--bg)_72%,transparent)] md:hidden" />
    </div>
  );
}

function ModuleCardView({ module }: { module: ModuleCard }) {
  const Icon = module.icon;
  return (
    <article className="flex h-full min-w-0 flex-col gap-4 rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-[var(--docs-border)] bg-[var(--bg-secondary)] text-[var(--docs-accent)]">
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="m-0 text-base font-semibold leading-snug text-[var(--fg)]">
            {module.name}
          </h3>
          <p className="m-0 mt-2 text-sm leading-relaxed text-[var(--fg-secondary)]">
            {module.description}
          </p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        {module.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-md border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-2.5 py-1 text-xs text-[var(--fg-secondary)]"
          >
            {tag}
          </span>
        ))}
      </div>
    </article>
  );
}

function ExampleAppCard({ app }: { app: ExampleApp }) {
  const displayName =
    app.template.name === "Plans" ? "Plan" : app.template.name;
  return (
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-[var(--docs-border)] bg-[var(--bg)]">
      <div className="relative border-b border-[var(--docs-border)] bg-[var(--bg-secondary)]">
        <img
          src={app.template.screenshot}
          alt={`${displayName} app screenshot`}
          className="aspect-[16/10] w-full object-cover transition duration-300 group-hover:scale-[1.015]"
          loading="lazy"
          decoding="async"
        />
      </div>
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div>
          <h3 className="m-0 text-lg font-semibold text-[var(--fg)]">
            {displayName}
          </h3>
          <p className="m-0 mt-2 text-sm leading-relaxed text-[var(--fg-secondary)]">
            {app.description}
          </p>
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          {app.modules.map((module) => (
            <span
              key={module}
              className="rounded-md bg-[var(--docs-accent-light)] px-2.5 py-1 text-xs font-medium text-[var(--docs-accent)]"
            >
              {module}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="mx-auto mb-10 max-w-3xl text-center">
      <p className="mb-3 text-sm font-semibold text-[var(--docs-accent)]">
        {eyebrow}
      </p>
      <h2 className="m-0 text-3xl font-semibold leading-tight text-[var(--fg)] md:text-4xl">
        {title}
      </h2>
      <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
        {body}
      </p>
    </div>
  );
}

export default function HomepageNew() {
  const { locale } = useLocale();
  const localizedPath = (path: string) => sitePathForLocale(path, locale);

  return (
    <main className="min-w-0 overflow-x-clip">
      <section className="relative border-b border-[var(--docs-border)] px-6 py-16 md:min-h-[calc(100svh-10rem)] md:py-20">
        <HeroScreens />
        <div className="relative z-10 mx-auto flex max-w-[1120px] flex-col items-center justify-center text-center md:min-h-[calc(100svh-24rem)]">
          <div className="mb-5 inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--docs-border)] bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] px-4 py-1.5 text-sm text-[var(--fg-secondary)] backdrop-blur">
            <span className="size-2 shrink-0 rounded-full bg-[var(--docs-accent)]" />
            <span className="truncate">
              Homepage direction: modules for agentic applications
            </span>
          </div>
          <h1 className="m-0 max-w-4xl text-5xl font-semibold leading-[1.04] text-[var(--fg)] md:text-7xl">
            Agentic applications
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[var(--fg-secondary)] md:text-xl">
            Build chat-first agentic apps, agents with robust UIs, and
            automation-first workflows. Agent-Native gives you replaceable,
            battle-tested modules so your agent can focus on what makes your
            product different.
          </p>
          <div className="mt-9 flex w-full max-w-xl flex-col justify-center gap-3 sm:flex-row">
            <ArrowLink to="#modules" location="homepage_new_hero">
              Browse modules
            </ArrowLink>
            <ArrowLink
              to="#example-apps"
              location="homepage_new_hero"
              variant="secondary"
            >
              Explore example apps
            </ArrowLink>
          </div>
          <div className="mt-7 flex w-full max-w-2xl items-center gap-3 rounded-lg border border-[var(--code-border)] bg-[color-mix(in_srgb,var(--code-bg)_90%,transparent)] px-4 py-3 text-left font-mono text-sm text-[var(--fg)] backdrop-blur">
            <IconTerminal2 className="size-4 shrink-0 text-[var(--fg-secondary)]" />
            <code className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-sm">
              npx @agent-native/core@latest create my-app
            </code>
          </div>
        </div>
      </section>

      <section className="border-b border-[var(--docs-border)] px-6 py-16">
        <div className="mx-auto grid max-w-[1120px] gap-4 md:grid-cols-3">
          {appShapes.map((shape) => {
            const Icon = shape.icon;
            return (
              <article
                key={shape.title}
                className="rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] p-5"
              >
                <Icon
                  className="mb-4 size-6 text-[var(--docs-accent)]"
                  aria-hidden
                />
                <h2 className="m-0 text-lg font-semibold text-[var(--fg)]">
                  {shape.title}
                </h2>
                <p className="m-0 mt-2 text-sm leading-relaxed text-[var(--fg-secondary)]">
                  {shape.description}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="modules" className="px-6 py-20 md:py-24">
        <div className="mx-auto max-w-[1200px]">
          <SectionHeading
            eyebrow="The modular framework"
            title="Human-verified pieces for the boring-hard parts"
            body="Instead of asking agents to invent auth, sync, collaboration, sharing, MCP, queues, audit logs, and UI state from scratch, Agent-Native ships the pieces as modules you get for free and can replace when you need to."
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {moduleCards.map((module) => (
              <ModuleCardView key={module.name} module={module} />
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--docs-border)] bg-[var(--bg-secondary)] px-6 py-20 md:py-24">
        <div className="mx-auto max-w-[1120px]">
          <SectionHeading
            eyebrow="Own the source"
            title="Keep the solid parts. Replace anything."
            body="The framework should be inspectable by local agents: module docs, source, skills, and example apps live in node_modules so your app can fork, eject, patch, or replace a module without losing the map."
          />
          <div className="grid gap-4 md:grid-cols-3">
            {sourceFlow.map((step, index) => (
              <article
                key={step.title}
                className="relative rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] p-5"
              >
                <div className="mb-4 flex size-9 items-center justify-center rounded-md bg-[var(--fg)] text-sm font-semibold text-[var(--bg)]">
                  {index + 1}
                </div>
                <h3 className="m-0 text-lg font-semibold text-[var(--fg)]">
                  {step.title}
                </h3>
                <p className="m-0 mt-2 text-sm leading-relaxed text-[var(--fg-secondary)]">
                  {step.body}
                </p>
                <p className="m-0 mt-4 rounded-md border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--fg-secondary)]">
                  {step.detail}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="example-apps" className="px-6 py-20 md:py-24">
        <div className="mx-auto max-w-[1200px]">
          <SectionHeading
            eyebrow="Example apps, not blank starters"
            title="Real applications show the modules working together"
            body="Example apps are forkable compositions. They prove the modules in production-shaped software, and they give agents concrete source to copy from before they touch your differentiated product code."
          />
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {exampleApps.map((app) => (
              <ExampleAppCard key={app.template.slug} app={app} />
            ))}
          </div>
          <div className="mt-10 flex justify-center">
            <ArrowLink
              to={localizedPath("/apps")}
              location="homepage_new_example_apps"
              variant="secondary"
            >
              View current app gallery
            </ArrowLink>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--docs-border)] px-6 py-20 md:py-24">
        <div className="mx-auto grid max-w-[1120px] gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <div>
            <p className="mb-3 text-sm font-semibold text-[var(--docs-accent)]">
              Deeply agentic, not AI-adjacent
            </p>
            <h2 className="m-0 text-3xl font-semibold leading-tight text-[var(--fg)] md:text-4xl">
              The agent and app share one operational core
            </h2>
            <p className="mt-5 text-base leading-relaxed text-[var(--fg-secondary)]">
              Every important workflow belongs to actions, SQL state, and
              context the agent can actually inspect. Humans can click through a
              robust UI; agents can do the same work headlessly; both paths use
              the same contracts.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <ArrowLink
                to={localizedPath("/docs/what-is-agent-native")}
                location="homepage_new_agentic_core"
              >
                Read the framework guide
              </ArrowLink>
              <ArrowLink
                to={localizedPath("/docs/actions")}
                location="homepage_new_agentic_core"
                variant="secondary"
              >
                See actions
              </ArrowLink>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] p-5">
            <div className="grid gap-3">
              {[
                {
                  icon: IconGitBranch,
                  title: "One action surface",
                  body: "UI, agent, HTTP, MCP, A2A, and CLI all call the same operations.",
                },
                {
                  icon: IconLock,
                  title: "Scoped by default",
                  body: "Auth, sharing, governance, and audit logs travel with the work.",
                },
                {
                  icon: IconServer,
                  title: "Apps, automations, and agents",
                  body: "Run the same operation from chat, UI, scheduled jobs, queues, external agents, or scripts.",
                },
                {
                  icon: IconMicrophone,
                  title: "Context-rich input",
                  body: "Chat, voice, skills, instructions, and UI state stay in the loop.",
                },
                {
                  icon: IconPlugConnected,
                  title: "Open agent protocols",
                  body: "A2A, MCP, MCP apps, and external agents are framework-level primitives.",
                },
                {
                  icon: IconActivity,
                  title: "Observable by design",
                  body: "Traces, evals, feedback, and audit history make agent work inspectable.",
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 rounded-md border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-3"
                  >
                    <div className="flex size-10 items-center justify-center rounded-md bg-[var(--bg)] text-[var(--docs-accent)]">
                      <Icon className="size-5" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <h3 className="m-0 text-sm font-semibold text-[var(--fg)]">
                        {item.title}
                      </h3>
                      <p className="m-0 mt-1 text-sm leading-relaxed text-[var(--fg-secondary)]">
                        {item.body}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
