import {
  ActionButton,
  Skeleton,
  Tabs,
} from "@agent-native/toolkit/design-system";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type {
  DesignSystemArtifact,
  DesignSystemWorkspaceSnapshot,
} from "../shared/design-system-authoring.js";
import { cn } from "./utils.js";

export interface DesignSystemWorkspaceLabels {
  foundations: string;
  components: string;
  rules: string;
  colors: string;
  typography: string;
  spacing: string;
  radius: string;
  sources: string;
  addSources: string;
  use: string;
  back: string;
  retry: string;
  empty: string;
  emptySection: string;
  conversation: string;
  canvas: string;
  chatTab: string;
  canvasTab: string;
  tokenDetails: string;
  openPreview: string;
  loadFailed: string;
  previewFailed: string;
  selected: string;
  preparing: string;
  awaitingDirection: string;
  readingSources: string;
  draftingFoundations: string;
  buildingComponents: string;
  ready: string;
  needsAttention: string;
  extracted: string;
  inferred: string;
  generated: string;
  freshKickoff: string;
  referencesKickoff: string;
  excludeSource: string;
  restoreSource: string;
}

export interface DesignSystemWorkspaceViewProps {
  snapshot?: DesignSystemWorkspaceSnapshot;
  labels: DesignSystemWorkspaceLabels;
  chat: ReactNode;
  selectedTargetId: string | null;
  error?: string;
  pending?: boolean;
  using?: boolean;
  sourceCollector?: ReactNode;
  onSelect: (target: DesignSystemArtifact) => void;
  renderArtifact: (
    target: DesignSystemArtifact,
    onSelect: () => void,
  ) => ReactNode;
  onBack: () => void;
  onRetry: () => void;
  onAddSources: () => void;
  onUse?: () => void;
  onSourceAction?: (
    id: string,
    action: "retry" | "exclude" | "restore",
  ) => void;
}

export function designSystemWorkspaceLabels(
  t: (key: string) => string,
): DesignSystemWorkspaceLabels {
  const keys = [
    "foundations",
    "components",
    "rules",
    "colors",
    "typography",
    "spacing",
    "radius",
    "sources",
    "addSources",
    "use",
    "back",
    "retry",
    "empty",
    "emptySection",
    "conversation",
    "canvas",
    "chatTab",
    "canvasTab",
    "tokenDetails",
    "openPreview",
    "loadFailed",
    "previewFailed",
    "selected",
    "preparing",
    "awaitingDirection",
    "readingSources",
    "draftingFoundations",
    "buildingComponents",
    "ready",
    "needsAttention",
    "extracted",
    "inferred",
    "generated",
  ] as const;
  return Object.fromEntries(
    [
      ...keys,
      "freshKickoff",
      "referencesKickoff",
      "excludeSource",
      "restoreSource",
    ].map((key) => [key, t(`systemWorkspace.${key}`)]),
  ) as unknown as DesignSystemWorkspaceLabels;
}

export function designSystemWorkspaceStatus(
  snapshot: DesignSystemWorkspaceSnapshot | undefined,
  labels: DesignSystemWorkspaceLabels,
): string {
  if (!snapshot) return labels.preparing;
  const run = snapshot.workspace?.run;
  if (!run) return labels.awaitingDirection;
  if (run.status === "queued") return labels.preparing;
  if (["failed", "cancelled"].includes(run.status))
    return labels.needsAttention;
  switch (run.stage) {
    case "reading-sources":
      return labels.readingSources;
    case "drafting-foundations":
      return labels.draftingFoundations;
    case "building-components":
      return labels.buildingComponents;
    case "writing-rules":
      return labels.rules;
    case "awaiting-input":
      return labels.awaitingDirection;
    case "ready":
      return labels.ready;
    case "needs-attention":
      return labels.needsAttention;
  }
}

export function DesignSystemWorkspaceView({
  snapshot,
  labels,
  chat,
  selectedTargetId,
  error,
  pending,
  using,
  sourceCollector,
  onSelect,
  renderArtifact,
  onBack,
  onRetry,
  onAddSources,
  onUse,
  onSourceAction,
}: DesignSystemWorkspaceViewProps) {
  const workspace = snapshot?.workspace;
  const working = Boolean(pending || workspace?.run?.status === "running");
  const artifacts = workspace?.artifacts ?? [];
  const [panel, setPanel] = useState<"chat" | "canvas">("chat");
  const [wide, setWide] = useState(false);
  const surfaces = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const select = (target: DesignSystemArtifact) => {
    onSelect(target);
    setPanel("chat");
    requestAnimationFrame(() => {
      surfaces.current
        ?.querySelector<HTMLElement>(
          '[data-workspace-chat] [contenteditable="true"], [data-workspace-chat] textarea',
        )
        ?.focus({ preventScroll: true });
    });
  };
  const sections = [
    { kind: "foundation", title: labels.foundations },
    { kind: "component", title: labels.components },
    { kind: "usage-rule", title: labels.rules },
  ] as const;
  const canvas = (
    <section
      aria-label={labels.canvas}
      className="@container/canvas h-full min-h-0 overflow-y-auto bg-muted/20"
    >
      {sourceCollector ? (
        <div className="border-b bg-background p-4 sm:p-6">
          {sourceCollector}
        </div>
      ) : null}
      <div className="flex flex-col gap-6 p-4 sm:p-6">
        {workspace?.sources.length ? (
          <details>
            <summary className="w-fit cursor-pointer text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {labels.sources}
            </summary>
            <ul className="mt-3 flex flex-col gap-2 text-xs">
              {workspace.sources.map((source) => (
                <li key={source.id} className="min-w-0 break-words">
                  <span>
                    {source.kind === "file" ? source.name : source.url}
                  </span>
                  {source.error ? (
                    <span role="alert" className="ms-2 text-destructive">
                      {source.error.message}
                    </span>
                  ) : null}
                  {snapshot?.canEdit && onSourceAction ? (
                    <span className="ms-2 inline-flex gap-1">
                      {!source.excluded && source.error ? (
                        <ActionButton
                          emphasis="ghost"
                          size="compact"
                          onPress={() => onSourceAction(source.id, "retry")}
                        >
                          {labels.retry}
                        </ActionButton>
                      ) : null}
                      <ActionButton
                        emphasis="ghost"
                        size="compact"
                        onPress={() =>
                          onSourceAction(
                            source.id,
                            source.excluded ? "restore" : "exclude",
                          )
                        }
                      >
                        {source.excluded
                          ? labels.restoreSource
                          : labels.excludeSource}
                      </ActionButton>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {!artifacts.length ? (
          working ? (
            <div
              aria-label={labels.preparing}
              className="grid grid-cols-2 gap-4"
            >
              <Skeleton className="h-48 w-full rounded-xl" />
              <Skeleton className="h-48 w-full rounded-xl" />
              <Skeleton className="col-span-2 h-28 w-full rounded-xl" />
            </div>
          ) : (
            <div className="flex min-h-64 items-center justify-center">
              <p className="max-w-sm text-center text-sm text-muted-foreground">
                {labels.empty}
              </p>
            </div>
          )
        ) : null}
        {sections.map((section) => {
          const targets = artifacts.filter(
            (artifact) => artifact.kind === section.kind,
          );
          if (!targets.length) return null;
          return (
            <section
              key={section.kind}
              aria-label={section.title}
              className="flex flex-col gap-3"
            >
              <h2 className="text-sm font-medium">{section.title}</h2>
              <div
                className={cn(
                  "grid items-start gap-3",
                  section.kind !== "usage-rule" && "@xl/canvas:grid-cols-2",
                  section.kind === "component" && "@6xl/canvas:grid-cols-4",
                )}
              >
                {targets.map((target) => (
                  <div
                    key={target.id}
                    className="min-w-0"
                    data-selected={selectedTargetId === target.id || undefined}
                  >
                    {renderArtifact(target, () => select(target))}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground"
      data-system-authoring-workspace
    >
      <header className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-b px-4 py-3 sm:flex">
        <ActionButton emphasis="ghost" size="compact" onPress={onBack}>
          {labels.back}
        </ActionButton>
        {snapshot ? (
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
            {snapshot.title}
          </h1>
        ) : (
          <Skeleton className="h-5 w-40" />
        )}
        <span
          role="status"
          className="hidden text-xs text-muted-foreground xl:block"
        >
          {designSystemWorkspaceStatus(snapshot, labels)}
        </span>
        <div className="col-span-2 flex min-w-0 items-center justify-end gap-2">
          <ActionButton
            emphasis="outline"
            size="compact"
            disabled={!workspace || !snapshot?.canEdit}
            onPress={() => {
              setPanel("canvas");
              onAddSources();
            }}
          >
            {labels.addSources}
          </ActionButton>
          {onUse ? (
            <ActionButton
              size="compact"
              disabled={
                !workspace ||
                !artifacts.length ||
                using ||
                (workspace.runtime === "builder" &&
                  !snapshot?.canUse &&
                  !snapshot?.canPublish)
              }
              pending={using}
              onPress={onUse}
            >
              {labels.use}
            </ActionButton>
          ) : null}
        </div>
      </header>
      {error || workspace?.run?.error ? (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 text-sm text-destructive"
        >
          <span className="min-w-0 break-words">
            {error ?? workspace?.run?.error?.message}
          </span>
          {error ? (
            <ActionButton emphasis="ghost" size="compact" onPress={onRetry}>
              {labels.retry}
            </ActionButton>
          ) : null}
        </div>
      ) : null}
      <div ref={surfaces} className="min-h-0 min-w-0 flex-1">
        <Tabs
          value={panel}
          onChange={setPanel}
          display={wide ? "panels" : "tabs"}
          aria-label={labels.canvas}
          className={cn(
            "grid h-full min-h-0 [&>[role=tablist]]:m-3 [&>[role=tablist]]:w-fit [&>[role=tabpanel]]:mt-0 [&>[role=tabpanel]]:min-h-0 [&>[role=tabpanel]]:overflow-hidden [&>[role=region]]:mt-0 [&>[role=region]]:min-h-0 [&>[role=region]]:overflow-hidden",
            wide
              ? "grid-cols-[22rem_minmax(0,1fr)] grid-rows-1"
              : "grid-cols-1 grid-rows-[auto_minmax(0,1fr)]",
          )}
          items={[
            {
              value: "chat",
              label: labels.chatTab,
              keepMounted: true,
              content: (
                <section
                  data-workspace-chat
                  aria-label={labels.conversation}
                  className="h-full min-h-0 overflow-hidden lg:border-e"
                >
                  {chat}
                </section>
              ),
            },
            {
              value: "canvas",
              label: labels.canvasTab,
              keepMounted: true,
              content: canvas,
            },
          ]}
        />
      </div>
    </div>
  );
}
