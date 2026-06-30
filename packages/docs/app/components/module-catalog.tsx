import { trackEvent } from "@agent-native/core/client";
import {
  IconActivity,
  IconBlocks,
  IconChartDots,
  IconCode,
  IconDatabase,
  IconNetwork,
  IconPackage,
  IconRefresh,
  IconRobot,
  IconSettingsAutomation,
  IconShare,
  IconShieldLock,
  IconUsers,
} from "@tabler/icons-react";
import { Link } from "react-router";

type ModuleIcon = typeof IconRefresh;

export type AgentNativeModule = {
  name: string;
  description: string;
  icon: ModuleIcon;
};

export const agentNativeModules: AgentNativeModule[] = [
  {
    name: "Auto state syncing",
    description:
      "Agent changes update the UI, and the UI state stays visible to the agent without another bridge.",
    icon: IconRefresh,
  },
  {
    name: "Actions",
    description:
      "Define work once and use it from the UI, agent, HTTP, MCP, A2A, and CLI.",
    icon: IconCode,
  },
  {
    name: "SQL state and ORM",
    description:
      "Durable app data, application state, migrations, and provider-agnostic schemas.",
    icon: IconDatabase,
  },
  {
    name: "DB admin",
    description:
      "Agent-readable schemas, query surfaces, migrations, and admin tools without a custom back office.",
    icon: IconDatabase,
  },
  {
    name: "Auth and governance",
    description:
      "Login, organizations, multi-tenancy, permissions, approvals, and policy hooks.",
    icon: IconShieldLock,
  },
  {
    name: "Sharing",
    description:
      "Share links, scoped access, public/private resources, comments, and review surfaces.",
    icon: IconShare,
  },
  {
    name: "Realtime collaboration",
    description:
      "Multi-user editing, live presence, optimistic UI, and server-backed reconciliation.",
    icon: IconUsers,
  },
  {
    name: "Agent interoperability",
    description:
      "A2A, MCP, MCP apps, external agents, harness agents, and cross-app handoffs.",
    icon: IconNetwork,
  },
  {
    name: "Automations and queues",
    description:
      "Event-triggered work, scheduled tasks, background runs, and reliable mutations.",
    icon: IconSettingsAutomation,
  },
  {
    name: "Agent UI surface",
    description:
      "Chat, skills, instructions, generative UI, voice input, and agent-visible context.",
    icon: IconRobot,
  },
  {
    name: "Observability",
    description:
      "Tracing, evals, feedback, experiments, and proof that agents did what they claimed.",
    icon: IconChartDots,
  },
  {
    name: "Workspaces",
    description:
      "Composable headed or headless apps that discover each other and coordinate over A2A.",
    icon: IconBlocks,
  },
  {
    name: "Source ownership",
    description:
      "Docs and source live where agents can inspect, fork, eject, patch, or replace them.",
    icon: IconPackage,
  },
  {
    name: "Audit logs",
    description:
      "A durable record of human and agent changes, scoped to the resources users can access.",
    icon: IconActivity,
  },
];

function ModuleCard({ module }: { module: AgentNativeModule }) {
  const Icon = module.icon;
  return (
    <article className="flex min-h-[170px] min-w-0 flex-col rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] p-5">
      <div className="mb-4 flex size-10 shrink-0 items-center justify-center rounded-md border border-[var(--docs-border)] bg-[var(--bg-secondary)] text-[var(--docs-accent)]">
        <Icon size={20} stroke={1.8} aria-hidden />
      </div>
      <h3 className="m-0 text-base font-semibold leading-snug text-[var(--fg)]">
        {module.name}
      </h3>
      <p className="m-0 mt-2 text-sm leading-relaxed text-[var(--fg-secondary)]">
        {module.description}
      </p>
    </article>
  );
}

function modulePairs() {
  const pairs: AgentNativeModule[][] = [];
  for (let i = 0; i < agentNativeModules.length; i += 2) {
    pairs.push(agentNativeModules.slice(i, i + 2));
  }
  return pairs;
}

export function ModulesRail({ allModulesPath }: { allModulesPath: string }) {
  return (
    <div className="templates-side-scroll -mx-6 flex snap-x gap-5 overflow-x-auto overflow-y-hidden px-8 pb-3 pl-10 [scroll-padding-left:2.5rem]">
      {modulePairs().map((pair) => (
        <div
          key={pair.map((module) => module.name).join("-")}
          className="grid w-[320px] shrink-0 snap-start scroll-ml-10 grid-rows-2 gap-5 sm:w-[360px]"
        >
          {pair.map((module) => (
            <ModuleCard key={module.name} module={module} />
          ))}
        </div>
      ))}
      <div className="flex w-[320px] shrink-0 snap-start scroll-ml-10 sm:w-[360px]">
        <Link
          data-an-prefetch="render"
          to={allModulesPath}
          className="flex min-h-full w-full flex-col items-center justify-center gap-5 rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] px-6 py-8 text-center no-underline hover:border-[var(--fg-secondary)] hover:no-underline"
          onClick={() =>
            trackEvent("click cta", {
              label: "view_all_modules",
              location: "modules_scroll_end",
            })
          }
        >
          <h3 className="m-0 text-2xl font-semibold tracking-tight text-[var(--fg)]">
            View all modules
          </h3>
          <span className="primary-button">
            View all modules
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </span>
        </Link>
      </div>
    </div>
  );
}

export function ModulesGrid() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {agentNativeModules.map((module) => (
        <ModuleCard key={module.name} module={module} />
      ))}
    </div>
  );
}
