import { trackEvent, useT } from "@agent-native/core/client";
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
  id: string;
  titleKey: string;
  descriptionKey: string;
  icon: ModuleIcon;
};

export const agentNativeModules: AgentNativeModule[] = [
  {
    id: "auto-state-syncing",
    titleKey: "home.modules.items.autoStateSyncing.title",
    descriptionKey: "home.modules.items.autoStateSyncing.body",
    icon: IconRefresh,
  },
  {
    id: "actions",
    titleKey: "home.modules.items.actions.title",
    descriptionKey: "home.modules.items.actions.body",
    icon: IconCode,
  },
  {
    id: "sql-state-orm",
    titleKey: "home.modules.items.sqlStateOrm.title",
    descriptionKey: "home.modules.items.sqlStateOrm.body",
    icon: IconDatabase,
  },
  {
    id: "db-admin",
    titleKey: "home.modules.items.dbAdmin.title",
    descriptionKey: "home.modules.items.dbAdmin.body",
    icon: IconDatabase,
  },
  {
    id: "auth-governance",
    titleKey: "home.modules.items.authGovernance.title",
    descriptionKey: "home.modules.items.authGovernance.body",
    icon: IconShieldLock,
  },
  {
    id: "sharing",
    titleKey: "home.modules.items.sharing.title",
    descriptionKey: "home.modules.items.sharing.body",
    icon: IconShare,
  },
  {
    id: "realtime-collaboration",
    titleKey: "home.modules.items.realtimeCollaboration.title",
    descriptionKey: "home.modules.items.realtimeCollaboration.body",
    icon: IconUsers,
  },
  {
    id: "agent-interoperability",
    titleKey: "home.modules.items.agentInteroperability.title",
    descriptionKey: "home.modules.items.agentInteroperability.body",
    icon: IconNetwork,
  },
  {
    id: "automations-queues",
    titleKey: "home.modules.items.automationsQueues.title",
    descriptionKey: "home.modules.items.automationsQueues.body",
    icon: IconSettingsAutomation,
  },
  {
    id: "agent-ui-surface",
    titleKey: "home.modules.items.agentUiSurface.title",
    descriptionKey: "home.modules.items.agentUiSurface.body",
    icon: IconRobot,
  },
  {
    id: "observability",
    titleKey: "home.modules.items.observability.title",
    descriptionKey: "home.modules.items.observability.body",
    icon: IconChartDots,
  },
  {
    id: "workspaces",
    titleKey: "home.modules.items.workspaces.title",
    descriptionKey: "home.modules.items.workspaces.body",
    icon: IconBlocks,
  },
  {
    id: "source-ownership",
    titleKey: "home.modules.items.sourceOwnership.title",
    descriptionKey: "home.modules.items.sourceOwnership.body",
    icon: IconPackage,
  },
  {
    id: "audit-logs",
    titleKey: "home.modules.items.auditLogs.title",
    descriptionKey: "home.modules.items.auditLogs.body",
    icon: IconActivity,
  },
];

function ModuleCard({ module }: { module: AgentNativeModule }) {
  const t = useT();
  const Icon = module.icon;
  return (
    <article className="flex min-h-[170px] min-w-0 flex-col rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] p-5">
      <div className="mb-4 flex size-10 shrink-0 items-center justify-center rounded-md border border-[var(--docs-border)] bg-[var(--bg-secondary)] text-[var(--docs-accent)]">
        <Icon size={20} stroke={1.8} aria-hidden />
      </div>
      <h3 className="m-0 text-base font-semibold leading-snug text-[var(--fg)]">
        {t(module.titleKey)}
      </h3>
      <p className="m-0 mt-2 text-sm leading-relaxed text-[var(--fg-secondary)]">
        {t(module.descriptionKey)}
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
  const t = useT();

  return (
    <div className="templates-side-scroll -mx-6 flex snap-x gap-5 overflow-x-auto overflow-y-hidden px-8 pb-3 pl-10 [scroll-padding-left:2.5rem]">
      {modulePairs().map((pair) => (
        <div
          key={pair.map((module) => module.id).join("-")}
          className="grid w-[320px] shrink-0 snap-start scroll-ml-10 grid-rows-2 gap-5 sm:w-[360px]"
        >
          {pair.map((module) => (
            <ModuleCard key={module.id} module={module} />
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
            {t("home.modules.viewAll")}
          </h3>
          <span className="primary-button">
            {t("home.modules.viewAll")}
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
        <ModuleCard key={module.id} module={module} />
      ))}
    </div>
  );
}
