import {
  PromptComposer,
  isInBuilderFrame,
  navigateWithAgentChatViewTransition,
  useActionQuery,
  useChatModels,
  useT,
} from "@agent-native/core/client";
import {
  IconArrowUpRight,
  IconStack3,
  type IconProps,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { submitOverviewPrompt } from "../lib/overview-chat";
import type { WorkspaceAppSummary } from "../lib/workspace-apps";
import { ActionQueryError } from "./action-query-error";
import { CreateAppPopover } from "./create-app-popover";
import { DispatchShell } from "./dispatch-shell";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { WorkspaceAppCard } from "./workspace-app-card";

const WORKSPACE_LINKS = [
  { to: "/automations", labelKey: "dispatch.nav.automations" },
  { to: "/approvals", labelKey: "dispatch.nav.approvals" },
  { to: "/destinations", labelKey: "dispatch.nav.delivery" },
  { to: "/agents", labelKey: "dispatch.nav.agents" },
  { to: "/vault", labelKey: "dispatch.nav.vault" },
  { to: "/audit", labelKey: "dispatch.nav.audit" },
] as const;

function SectionHeader({
  icon: Icon,
  title,
  detail,
  action,
}: {
  icon: React.ComponentType<IconProps>;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon size={16} className="shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">
            {title}
          </h2>
          {detail ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {detail}
            </p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function CommandPanel() {
  const t = useT();
  const { selectedModel } = useChatModels();
  const navigate = useNavigate();
  const promptSuggestions = [
    t("dispatch.pages.suggestionWorkspaceHealth", {
      defaultValue: "Summarize the current workspace health",
    }),
    t("dispatch.pages.suggestionOnboardingApp", {
      defaultValue: "Create an app for onboarding requests",
    }),
    t("dispatch.pages.suggestionAnalyticsAgents", {
      defaultValue: "Check which agents can help with analytics",
    }),
  ];

  function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;

    if (isInBuilderFrame()) {
      submitOverviewPrompt(trimmed, selectedModel);
      return;
    }

    navigateWithAgentChatViewTransition(
      navigate,
      "/chat",
      {
        state: {
          dispatchPrompt: {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            message: trimmed,
            selectedModel,
          },
        },
      },
    );
  }

  return (
    <section className="flex flex-col">
      <nav
        aria-label={t("dispatch.pages.chatViewsAria", {
          defaultValue: "Dispatch chat views",
        })}
        className="flex items-center gap-6 border-b"
      >
        <span className="border-b-2 border-foreground px-0.5 pb-2.5 text-sm font-medium text-foreground">
          {t("dispatch.pages.askTab", { defaultValue: "Ask" })}
        </span>
        <Link
          to="/chat"
          onClick={(event) => {
            if (
              !event.metaKey &&
              !event.ctrlKey &&
              !event.shiftKey &&
              !event.altKey
            ) {
              event.preventDefault();
              navigateWithAgentChatViewTransition(navigate, "/chat");
            }
          }}
          className="px-0.5 pb-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("dispatch.nav.chat", { defaultValue: "Chat" })}
        </Link>
      </nav>
      <div className="mx-auto flex w-full max-w-3xl flex-col pt-8 sm:pt-10">
        <div className="mb-5 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {t("dispatch.pages.chatAcrossApps", {
              defaultValue: "Chat across your apps",
            })}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            {t("dispatch.pages.chatAcrossAppsDescription", {
              defaultValue:
                "Route work, inspect status, or create something new from one place.",
            })}
          </p>
        </div>
        <PromptComposer
          placeholder={t("dispatch.pages.overviewPromptPlaceholder", {
            defaultValue: "Ask Dispatch anything...",
          })}
          onSubmit={(text) => send(text)}
        />
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {promptSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => send(suggestion)}
              className="cursor-pointer rounded-md border border-transparent bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-[background-color,color] hover:bg-muted hover:text-foreground"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function WorkspaceLinks() {
  const t = useT();

  return (
    <nav
      aria-label={t("dispatch.pages.workspaceShortcutsAria")}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
    >
      <span className="font-medium text-foreground/70">
        {t("dispatch.pages.also")}
      </span>
      {WORKSPACE_LINKS.map((item, index) => (
        <span key={item.to} className="inline-flex items-center gap-x-3">
          {index > 0 ? (
            <span aria-hidden className="text-border">
              ·
            </span>
          ) : null}
          <Link
            to={item.to}
            className="transition hover:text-foreground hover:underline underline-offset-4"
          >
            {t(item.labelKey)}
          </Link>
        </span>
      ))}
    </nav>
  );
}

function AppsPanel({
  apps,
  isLoading,
}: {
  apps: WorkspaceAppSummary[];
  isLoading: boolean;
}) {
  const visibleApps = apps.filter((app) => !app.isDispatch && !app.archived);
  const showSkeletons = isLoading && visibleApps.length === 0;

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        icon={IconStack3}
        title="Apps"
        detail={
          visibleApps.length === 1 ? "1 active" : `${visibleApps.length} active`
        }
        action={
          <Button variant="outline" size="sm" asChild>
            <Link to="/apps">
              View all
              <IconArrowUpRight size={14} />
            </Link>
          </Button>
        }
      />
      {showSkeletons ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-lg border bg-card p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-3 h-3 w-24" />
              <Skeleton className="mt-3 h-3 w-full" />
            </div>
          ))}
        </div>
      ) : visibleApps.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {visibleApps.map((app) => (
            <WorkspaceAppCard key={app.id} app={app} className="min-h-32" />
          ))}
        </div>
      ) : (
        <CreateAppPopover />
      )}
    </section>
  );
}

export function DispatchControlPlane() {
  const appsQuery = useActionQuery<WorkspaceAppSummary[]>(
    "list-workspace-apps",
    { includeAgentCards: false, includeArchived: true },
  );
  const { data: workspaceApps = [], isLoading: appsLoading } = appsQuery;

  return (
    <DispatchShell
      title="Overview"
      description="Ask Dispatch or jump into a workspace app."
    >
      <div className="flex flex-col gap-6">
        <CommandPanel />
        <WorkspaceLinks />
        {appsQuery.isError ? (
          <ActionQueryError
            error={appsQuery.error}
            onRetry={() => void appsQuery.refetch()}
          />
        ) : (
          <AppsPanel apps={workspaceApps ?? []} isLoading={appsLoading} />
        )}
      </div>
    </DispatchShell>
  );
}
