import {
  PromptComposer,
  isInBuilderFrame,
  useActionQuery,
  useChatModels,
} from "@agent-native/core/client";
import {
  IconArrowUpRight,
  IconBroadcast,
  IconStack3,
  type IconProps,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { CreateAppPopover } from "@/components/create-app-popover";
import { DispatchShell } from "@/components/dispatch-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceAppCard } from "@/components/workspace-app-card";
import { submitOverviewPrompt } from "@/lib/overview-chat";
import type { WorkspaceAppSummary } from "@/lib/workspace-apps";

const PROMPT_SUGGESTIONS = [
  "Summarize the current workspace health",
  "Create an app for onboarding requests",
  "Check which agents can help with analytics",
];

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
  const { selectedModel } = useChatModels();
  const navigate = useNavigate();

  function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;

    if (isInBuilderFrame()) {
      submitOverviewPrompt(trimmed, selectedModel);
      return;
    }

    navigate("/chat", {
      state: {
        dispatchPrompt: {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          message: trimmed,
          selectedModel,
        },
      },
    });
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <IconBroadcast size={16} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Ask Dispatch
          </h2>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/chat">
            Open chat
            <IconArrowUpRight size={14} />
          </Link>
        </Button>
      </div>
      <PromptComposer
        placeholder="Route work, inspect status, or create an app..."
        onSubmit={(text) => send(text)}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {PROMPT_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => send(suggestion)}
            className="cursor-pointer rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </section>
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
  const { data: workspaceApps = [], isLoading: appsLoading } = useActionQuery<
    WorkspaceAppSummary[]
  >(
    "list-workspace-apps",
    { includeAgentCards: false, includeArchived: true },
    { refetchInterval: 2_000 },
  );

  return (
    <DispatchShell
      title="Overview"
      description="Ask Dispatch or jump into a workspace app."
    >
      <div className="flex flex-col gap-6">
        <CommandPanel />
        <AppsPanel apps={workspaceApps ?? []} isLoading={appsLoading} />
      </div>
    </DispatchShell>
  );
}
