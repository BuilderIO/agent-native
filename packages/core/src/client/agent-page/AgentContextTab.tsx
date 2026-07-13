import {
  IconChartTreemap,
  IconInfoCircle,
  IconList,
  IconLock,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import type {
  ContextManifest,
  ContextManifestSystemSection,
  ContextPreview,
} from "../../shared/context-xray.js";
import { manifestConversationTokens } from "../../shared/context-xray.js";
import { ContextMeter } from "../context-xray/ContextMeter.js";
import { ContextTreemap } from "../context-xray/ContextTreemap.js";
import { formatTokens, resolveContextWindow } from "../context-xray/format.js";
import { useT } from "../i18n.js";
import { useActionQuery } from "../use-action.js";
import { useChatThreads, type ChatThreadSummary } from "../use-chat-threads.js";
import { cn } from "../utils.js";
import type { AgentPageTabProps } from "./types.js";

type PreviewQuery = {
  data?: ContextPreview;
  isLoading?: boolean;
  error?: unknown;
};
type ManifestQuery = { data?: ContextManifest; isLoading?: boolean };

export function mostRecentlyUpdatedThread(
  threads: ChatThreadSummary[],
): ChatThreadSummary | undefined {
  return threads.reduce<ChatThreadSummary | undefined>(
    (latest, thread) =>
      !latest || thread.updatedAt > latest.updatedAt ? thread : latest,
    undefined,
  );
}

const PROVENANCE_ORDER = [
  "framework-core",
  "actions-prompt",
  "enterprise-workspace-core",
  "template",
  "sql-workspace",
  "legacy-app-default",
  "organization",
  "personal",
  "memory",
  "db-schema",
  "tools",
  "model-overlay",
  "runtime-context",
] as const;

type Translate = (key: string, options?: Record<string, unknown>) => string;

function provenanceLabel(
  provenance: ContextManifestSystemSection["provenance"],
  t: Translate,
): string {
  switch (provenance) {
    case "framework-core":
      return t("contextXray.provenance.frameworkCore", {
        defaultValue: "Framework",
      });
    case "actions-prompt":
      return t("contextXray.provenance.actionsPrompt", {
        defaultValue: "Actions",
      });
    case "template":
      return t("contextXray.provenance.template", {
        defaultValue: "Template",
      });
    case "enterprise-workspace-core":
      return t("contextXray.provenance.enterpriseWorkspaceCore", {
        defaultValue: "Enterprise workspace core",
      });
    case "sql-workspace":
      return t("contextXray.provenance.sqlWorkspace", {
        defaultValue: "Workspace",
      });
    case "legacy-app-default":
      return t("contextXray.provenance.legacyAppDefault", {
        defaultValue: "App defaults",
      });
    case "organization":
      return t("contextXray.provenance.organization", {
        defaultValue: "Organization",
      });
    case "personal":
      return t("contextXray.provenance.personal", {
        defaultValue: "Personal",
      });
    case "memory":
      return t("contextXray.provenance.memory", {
        defaultValue: "Memory",
      });
    case "db-schema":
      return t("contextXray.provenance.dbSchema", {
        defaultValue: "SQL schema",
      });
    case "tools":
      return t("contextXray.provenance.tools", { defaultValue: "Tools" });
    case "model-overlay":
      return t("contextXray.provenance.modelOverlay", {
        defaultValue: "Model overlay",
      });
    case "runtime-context":
      return t("contextXray.provenance.runtimeContext", {
        defaultValue: "Runtime context",
      });
  }
}

function governanceLabel(
  governance: ContextManifestSystemSection["governance"],
  t: Translate,
): string {
  switch (governance) {
    case "required":
      return t("contextXray.governance.required", {
        defaultValue: "Required",
      });
    case "inherited":
      return t("contextXray.governance.inherited", {
        defaultValue: "Inherited",
      });
    case "user":
      return t("contextXray.governance.user", {
        defaultValue: "Your context",
      });
  }
}

function sourceLabel(section: ContextManifestSystemSection): string {
  return (
    section.sourceRef?.path ??
    section.sourceRef?.resourceId ??
    section.sourceRef?.scope ??
    "framework"
  );
}

function previewAsManifest(preview: ContextPreview): ContextManifest {
  return {
    threadId: "context-preview",
    computedAt: preview.computedAt,
    ...(preview.model ? { model: preview.model } : {}),
    totalTokens: preview.totalTokens,
    rawTokens: preview.totalTokens,
    reclaimedTokens: 0,
    tokenCountMethod: preview.tokenCountMethod,
    conversationTokens: 0,
    systemTokens: preview.systemTokens,
    source: "preview",
    enforceable: false,
    segments: [],
    systemSections: preview.sections,
  };
}

function ContextSplitMeter({
  manifest,
  budget,
}: {
  manifest: ContextManifest;
  budget: number;
}) {
  const t = useT();
  const systemTokens = manifest.systemTokens ?? 0;
  const conversationTokens = manifestConversationTokens(manifest);
  const total = Math.max(1, systemTokens + conversationTokens);
  return (
    <div className="space-y-2">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="bg-slate-700 dark:bg-slate-400"
          style={{ width: `${(systemTokens / total) * 100}%` }}
        />
        <div
          className="bg-sky-500"
          style={{ width: `${(conversationTokens / total) * 100}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="mr-1.5 inline-block size-2 rounded-full bg-slate-700 dark:bg-slate-400" />
          {t("contextXray.system", { defaultValue: "System" })}{" "}
          {formatTokens(systemTokens)}
        </span>
        <span>
          <span className="mr-1.5 inline-block size-2 rounded-full bg-sky-500" />
          {t("contextXray.conversation", { defaultValue: "Conversation" })}{" "}
          {formatTokens(conversationTokens)}
        </span>
        <span>
          {formatTokens(Math.max(0, budget - manifest.totalTokens))}{" "}
          {t("contextXray.free", { defaultValue: "free" })}
        </span>
      </div>
    </div>
  );
}

function SystemSectionList({
  sections,
  totalTokens,
}: {
  sections: ContextManifestSystemSection[];
  totalTokens: number;
}) {
  const t = useT();
  const grouped = useMemo(() => {
    const map = new Map<
      ContextManifestSystemSection["provenance"],
      ContextManifestSystemSection[]
    >();
    for (const section of sections) {
      const items = map.get(section.provenance) ?? [];
      items.push(section);
      map.set(section.provenance, items);
    }
    return PROVENANCE_ORDER.flatMap((provenance) => {
      const items = map.get(provenance);
      return items && items.length > 0 ? [{ provenance, items }] : [];
    });
  }, [sections]);

  return (
    <div className="space-y-4">
      {grouped.map((group) => {
        const tokens = group.items.reduce(
          (sum, item) => sum + item.tokenCount,
          0,
        );
        return (
          <section key={group.provenance}>
            <div className="mb-1 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="size-2 rounded-full bg-indigo-500" />
                <h3 className="truncate text-sm font-medium">
                  {provenanceLabel(group.provenance, t)}
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  {governanceLabel(
                    group.items[0]?.governance ?? "inherited",
                    t,
                  )}
                </span>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatTokens(tokens)} ·{" "}
                {totalTokens > 0 ? Math.round((tokens / totalTokens) * 100) : 0}
                %
              </span>
            </div>
            <div className="divide-y divide-border/60 rounded-md border border-border/60">
              {group.items
                .slice()
                .sort((a, b) => b.tokenCount - a.tokenCount)
                .map((section) => (
                  <div
                    key={section.segmentId}
                    className="flex gap-3 px-3 py-2.5"
                  >
                    <IconLock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="truncate text-sm font-medium">
                          {section.label}
                        </div>
                        <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatTokens(section.tokenCount)} ·{" "}
                          {totalTokens > 0
                            ? Math.round(
                                (section.tokenCount / totalTokens) * 100,
                              )
                            : 0}
                          %
                        </div>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {sourceLabel(section)}
                        {section.tokenMethod === "estimate"
                          ? " · estimated"
                          : ""}
                      </div>
                      {section.preview ? (
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
                          {section.preview}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
            </div>
          </section>
        );
      })}
      {grouped.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t("contextXray.noSystemContext", {
            defaultValue: "No system context is available for this scope yet.",
          })}
        </div>
      ) : null}
    </div>
  );
}

export function AgentContextTab({ scope }: AgentPageTabProps) {
  const t = useT();
  const [view, setView] = useState<"list" | "map">("list");
  const previewQuery = useActionQuery(
    "context-preview-get",
    { scope },
    { staleTime: 5_000 },
  ) as PreviewQuery;
  const threads = useChatThreads(undefined, "agent-context-page", null, {
    autoCreate: false,
    restoreActiveThread: false,
  });
  const latestThread = mostRecentlyUpdatedThread(threads.threads);
  const liveManifestQuery = useActionQuery(
    "context-manifest-get",
    latestThread ? { threadId: latestThread.id } : undefined,
    { enabled: Boolean(latestThread), staleTime: 1_000 },
  ) as ManifestQuery;
  const preview = previewQuery.data;
  const previewManifest = preview ? previewAsManifest(preview) : null;
  const budget = resolveContextWindow(preview?.model);
  const title = t("contextXray.pageTitle", { defaultValue: "Context" });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6 lg:p-10">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {t("contextXray.agent", { defaultValue: "Agent" })}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t("contextXray.headerDescription", {
                defaultValue:
                  "See the system instructions and conversation tokens that shape the agent.",
              })}
            </p>
          </div>
          {previewManifest ? (
            <ContextMeter manifest={previewManifest} enabled />
          ) : null}
        </div>
        {previewManifest ? (
          <ContextSplitMeter manifest={previewManifest} budget={budget} />
        ) : null}
      </header>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              {t("contextXray.whatAgentKnows", {
                defaultValue: "What the agent knows",
              })}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("contextXray.orderedSystemDescription", {
                defaultValue:
                  "Ordered system context is grouped by where it comes from. System sections are visible here but cannot be evicted from a thread.",
              })}
            </p>
          </div>
          <div className="inline-flex rounded-md bg-muted/50 p-0.5">
            <button
              type="button"
              onClick={() => setView("list")}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-xs",
                view === "list"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              <IconList className="size-3.5" />
              {t("contextXray.list", { defaultValue: "List" })}
            </button>
            <button
              type="button"
              onClick={() => setView("map")}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-xs",
                view === "map"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              <IconChartTreemap className="size-3.5" />
              {t("contextXray.treemap", { defaultValue: "Treemap" })}
            </button>
          </div>
        </div>
        {previewQuery.isLoading ? (
          <div className="rounded-md border border-border/60 p-8 text-center text-sm text-muted-foreground">
            {t("contextXray.loadingPreview", {
              defaultValue: "Loading context preview…",
            })}
          </div>
        ) : previewQuery.error ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {t("contextXray.previewUnavailable", {
              defaultValue: "Context preview is not available yet.",
            })}
          </div>
        ) : previewManifest ? (
          view === "map" ? (
            <ContextTreemap
              segments={[]}
              systemSections={previewManifest.systemSections}
            />
          ) : (
            <SystemSectionList
              sections={previewManifest.systemSections ?? []}
              totalTokens={previewManifest.totalTokens}
            />
          )
        ) : (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {t("contextXray.noPreview", {
              defaultValue:
                "No context preview is available for this scope yet.",
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">
            {t("contextXray.liveThread", { defaultValue: "Live thread" })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("contextXray.liveThreadDescription", {
              defaultValue:
                "The latest thread snapshot, when one exists. This is a single current snapshot, not an append-only history.",
            })}
          </p>
        </div>
        {latestThread && liveManifestQuery.data ? (
          <div className="space-y-3 rounded-md border border-border/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {latestThread.title ||
                    latestThread.preview ||
                    t("contextXray.latestThread", {
                      defaultValue: "Latest thread",
                    })}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatTokens(liveManifestQuery.data.totalTokens)} tokens ·{" "}
                  {latestThread.id}
                </div>
              </div>
              <ContextMeter threadId={latestThread.id} />
            </div>
            <ContextTreemap
              segments={liveManifestQuery.data.segments}
              systemSections={liveManifestQuery.data.systemSections}
            />
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {t("contextXray.noLiveThread", {
              defaultValue: "No live thread snapshot is available yet.",
            })}
          </div>
        )}
      </section>

      <section className="flex gap-3 rounded-md border border-border/60 bg-muted/20 p-4">
        <IconInfoCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            {t("contextXray.orderedTokensTitle", {
              defaultValue: "Context is ordered tokens, not weighted tokens.",
            })}
          </p>
          <p>
            {t("contextXray.orderedTokensDescription", {
              defaultValue:
                "Required framework and enterprise policy come first, followed by inherited template, workspace, and organization instructions. Personal instructions and memory arrive later and can narrow or override earlier guidance where the prompt permits. These system sections are not evictable; only run-local conversation segments support pin, evict, and restore.",
            })}
          </p>
        </div>
      </section>
    </div>
  );
}
