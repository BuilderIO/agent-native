import {
  formatDesignSystemReference,
  useDesignSystemWorkspaceOrigin,
} from "@agent-native/core/client/agent-chat";
import {
  PromptComposer,
  type PromptComposerProps,
} from "@agent-native/core/client/composer";
import {
  actionErrorMessage,
  callAction,
  useActionQuery,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  ComposerContextSearchInput,
  type AgentChatContextItem,
  type ComposerContextMenuItem,
  type ComposerContextPageControls,
} from "@agent-native/toolkit/composer";
import {
  IconBrandFigma,
  IconCheck,
  IconLayout,
  IconPalette,
  IconPlus,
  IconPresentation,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { DesignSystemSetup } from "@/components/design-system/DesignSystemSetup";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatComposerContext,
  persistComposerContext,
  persistComposerSubmission,
  resolveComposerSource,
  snapshotComposerContext,
  type SlidesPromptSubmitOptions,
} from "@/lib/composer-context";

import {
  composerSourceKey,
  SlidesComposerContextSchema,
  type ComposerSource,
  type SlidesComposerContext,
} from "../../../shared/composer-context";
import {
  parseDesignSystemIndexingStatus,
  getDesignSystemIndexingStatus,
} from "../../../shared/design-system-validation";

type SourceKind = ComposerSource["source"] | "system";
type SourceResult = {
  id: string;
  title: string;
  context?: string;
  url?: string;
};
type SourceList = {
  items: SourceResult[];
  hasMore?: boolean;
  nextCursor?: string;
};
type ContextState = {
  scope: string;
  selection: SlidesComposerContext;
  items: AgentChatContextItem[];
};
const EMPTY_CONTEXT: SlidesComposerContext = {
  designSystemId: null,
  references: [],
};

async function resolveSelection(
  selection: SlidesComposerContext,
): Promise<AgentChatContextItem[]> {
  const sources: Array<{
    key: string;
    title: string;
    read: () => Promise<AgentChatContextItem>;
  }> = selection.references.map((source) => ({
    key: composerSourceKey(source),
    title: source.title,
    read: () => resolveComposerSource(source),
  }));
  if (selection.designSystemRef || selection.designSystemId) {
    const id = selection.designSystemRef?.id ?? selection.designSystemId!;
    sources.unshift({
      key: `system:${id}`,
      title: id,
      read: async () => {
        const system = (await callAction(
          "get-design-system",
          { id, ...selection.designSystemRef },
          { method: "GET" },
        )) as {
          title?: string;
          agentContext?: string;
          data?: string;
          customInstructions?: string;
          assets?: string;
          builder?: {
            warning?: string;
            builderStatus?: string;
            docCount?: number;
            tokenValues?: Record<string, string>;
          } | null;
        };
        if (
          (system.builder
            ? getDesignSystemIndexingStatus({
                source: "builder",
                builderStatus: system.builder.builderStatus,
              })
            : parseDesignSystemIndexingStatus(system.data)) !== "ready"
        )
          throw new Error(
            "This design system is not ready. Retry after indexing finishes.",
          );
        if (system.builder?.warning) throw new Error(system.builder.warning);
        const hasContent = (value: unknown): boolean => {
          if (typeof value === "string") return Boolean(value.trim());
          if (typeof value === "number") return Number.isFinite(value);
          if (value && typeof value === "object")
            return Object.values(value).some(hasContent);
          return false;
        };
        const data = system.data ? JSON.parse(system.data) : {};
        const assets = system.assets ? JSON.parse(system.assets) : [];
        const usable = system.builder
          ? Boolean(
              system.builder.docCount || hasContent(system.builder.tokenValues),
            )
          : [
              data?.colors,
              data?.typography,
              data?.spacing,
              data?.borders,
              data?.tokens,
              data?.notes,
              data?.customCSS,
              system.customInstructions,
              assets,
            ].some(hasContent);
        if (!usable)
          throw new Error(
            "This design system has no usable tokens, guidance, or assets.",
          );
        if (!system.agentContext?.trim())
          throw new Error("This design system has no usable context.");
        return {
          key: `system:${id}`,
          title: system.title ?? id,
          context: selection.designSystemRef
            ? formatDesignSystemReference(
                selection.designSystemRef,
                system.agentContext,
              )
            : system.agentContext,
          status: "ready",
        };
      },
    });
  }
  return Promise.all(
    sources.map(async (source) => {
      try {
        return await source.read();
      } catch (error) {
        return {
          key: source.key,
          title: source.title,
          context: "",
          status: "error" as const,
          statusMessage:
            actionErrorMessage(error) ??
            (error instanceof Error ? error.message : String(error)),
        };
      }
    }),
  );
}

export function useSlidesComposerContext(
  deckId?: string | null,
  draftScope = "new-deck",
  originScope = draftScope,
) {
  const t = useT();
  const { session } = useSession();
  const scope = deckId ? `deck:${deckId}` : draftScope;
  const contextId = `${session?.email ?? "guest"}:${session?.orgId ?? "personal"}:slides:${scope}`;
  const originId = `${contextId}:${originScope}`;
  const draftKey = `slides-composer-context:${contextId}`;
  const deckQuery = useActionQuery(
    "get-deck",
    { id: deckId ?? "", compact: "true" },
    { enabled: Boolean(deckId && session) },
  );
  const defaultsQuery = useActionQuery(
    "get-workspace-defaults",
    {},
    { enabled: !deckId && Boolean(session) },
  );
  const query = deckId ? deckQuery : defaultsQuery;
  const refetchDeck = deckQuery.refetch;
  const [state, setState] = useState<ContextState | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [view, setView] = useState<SourceKind | "inspect" | null>(null);
  const [creatingSystem, setCreatingSystem] = useState(false);
  const [creationAttempt, setCreationAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [cursors, setCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [figmaInput, setFigmaInput] = useState("");
  const [figmaUrl, setFigmaUrl] = useState("");
  const [inspectedKey, setInspectedKey] = useState<string>();
  const resumeSystems = useRef<(() => void) | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const run = useRef(0);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const localChange = useRef(false);
  const savedSignature = useRef<string | undefined>(undefined);
  const writes = useRef(Promise.resolve());
  const writeVersion = useRef(0);
  const snapshots = useRef(
    new Map<string, { scope: string; selection: SlidesComposerContext }>(),
  );
  const drafts = useRef(new Map<string, SlidesComposerContext>());
  const selection = state?.scope === scope ? state.selection : EMPTY_CONTEXT;
  const items = state?.scope === scope ? state.items : [];
  const snapshotKey = (items: readonly AgentChatContextItem[]) =>
    JSON.stringify(
      items
        .filter((item) => /^(system|design|slides|figma):/.test(item.key))
        .map((item) => item.key)
        .sort(),
    );
  if (state?.scope === scope)
    snapshots.current.set(snapshotKey(items), {
      scope,
      selection: snapshotComposerContext(selection),
    });

  const hydrate = useCallback(
    async (next: SlidesComposerContext) => {
      const version = ++run.current;
      const targetScope = scope;
      setBusy(true);
      setState({
        scope,
        selection: next,
        items: [
          ...(next.designSystemRef || next.designSystemId
            ? [
                {
                  key: `system:${next.designSystemRef?.id ?? next.designSystemId}`,
                  title: t("promptContext.designSystem"),
                  context: "",
                  status: "pending" as const,
                },
              ]
            : []),
          ...next.references.map((source) => ({
            key: composerSourceKey(source),
            title: source.title,
            context: "",
            status: "pending" as const,
          })),
        ],
      });
      const resolved = await resolveSelection(next);
      if (version !== run.current || currentScope.current !== targetScope)
        return;
      setState({ scope, selection: next, items: resolved });
      setBusy(false);
    },
    [scope, t],
  );

  useEffect(() => {
    localChange.current = false;
    savedSignature.current = undefined;
    run.current++;
    setState(null);
    setBusy(false);
    setSaving(false);
    setSaveError(undefined);
    setView(null);
    setCreatingSystem(false);
    resumeSystems.current = null;
    setPage(1);
    setCursors([undefined]);
  }, [scope]);

  useEffect(() => {
    if (!session && !deckId) {
      setState({ scope, selection: EMPTY_CONTEXT, items: [] });
      return;
    }
    if (!query.data || localChange.current) return;
    try {
      const data = query.data as {
        composerContext?: unknown;
        designSystemId?: string | null;
        designSystem?: { id: string } | null;
        referenceDeck?: { id: string; title?: string | null } | null;
      };
      const next = deckId
        ? data.composerContext == null
          ? { designSystemId: data.designSystemId ?? null, references: [] }
          : SlidesComposerContextSchema.parse(data.composerContext)
        : (drafts.current.get(scope) ??
          (localStorage.getItem(draftKey)
            ? SlidesComposerContextSchema.parse(
                JSON.parse(localStorage.getItem(draftKey)!),
              )
            : null) ?? {
            designSystemId: data.designSystem?.id ?? null,
            references: data.referenceDeck
              ? [
                  {
                    source: "slides" as const,
                    id: data.referenceDeck.id,
                    title: data.referenceDeck.title ?? data.referenceDeck.id,
                  },
                ]
              : [],
          });
      const signature = JSON.stringify(next);
      if (signature === savedSignature.current) return;
      savedSignature.current = signature;
      void hydrate(next);
    } catch (error) {
      setSaveError(actionErrorMessage(error) ?? t("promptContext.loadFailed"));
    }
  }, [deckId, query.data, hydrate, t, session, scope, draftKey]);

  const save = useCallback(
    async (next: SlidesComposerContext) => {
      localChange.current = true;
      setSaveError(undefined);
      void hydrate(next);
      if (!deckId) {
        localStorage.setItem(draftKey, JSON.stringify(next));
        drafts.current.set(scope, snapshotComposerContext(next));
        return true;
      }
      const version = ++writeVersion.current;
      setSaving(true);
      const write = writes.current.then(() =>
        persistComposerContext(deckId, next),
      );
      writes.current = write.catch(() => undefined);
      try {
        await write;
        if (version !== writeVersion.current || currentScope.current !== scope)
          return;
        savedSignature.current = JSON.stringify(next);
        await refetchDeck();
        localChange.current = false;
      } catch (error) {
        if (version === writeVersion.current && currentScope.current === scope)
          setSaveError(
            actionErrorMessage(error) ?? t("promptContext.saveFailed"),
          );
        return false;
      } finally {
        if (version === writeVersion.current && currentScope.current === scope)
          setSaving(false);
      }
      return true;
    },
    [deckId, refetchDeck, hydrate, scope, t, draftKey],
  );
  const openWorkspace = useDesignSystemWorkspaceOrigin(
    originId,
    async (system) => {
      const saved = await save({
        ...selection,
        designSystemId: system.ownerApp === "slides" ? system.id : null,
        designSystemRef: {
          id: system.id,
          ownerApp: system.ownerApp,
          consumedRevision: system.revision,
        },
      });
      if (saved === false) throw new Error(t("promptContext.saveFailed"));
    },
  );

  const open = useCallback((kind: SourceKind) => {
    setView(kind);
    setSearch("");
    setPage(1);
    setCursors([undefined]);
    setFigmaUrl("");
  }, []);

  const listQuery = useActionQuery(
    view === "system" || creatingSystem
      ? "list-design-systems"
      : "read-composer-source",
    view === "system" || creatingSystem
      ? {}
      : {
          source: view === "design" || view === "figma" ? view : "slides",
          operation: "list",
          search,
          page,
          ...(cursors[page - 1] ? { cursor: cursors[page - 1] } : {}),
          ...(view === "figma" ? { figmaUrl } : {}),
        },
    {
      enabled:
        view !== null &&
        view !== "inspect" &&
        (view !== "figma" || Boolean(figmaUrl)),
    },
  );
  const list =
    view === "system"
      ? (
          (listQuery.data as { designSystems?: SourceResult[] } | undefined)
            ?.designSystems ?? []
        ).filter((item) =>
          item.title.toLowerCase().includes(search.toLowerCase()),
        )
      : ((listQuery.data as SourceList | undefined)?.items ?? []);

  const attach = async (item: SourceResult) => {
    if (view === "system") {
      setView(null);
      await save({
        ...selection,
        designSystemId: item.id,
        designSystemRef: null,
      });
    } else if (view === "design" || view === "slides" || view === "figma") {
      const source: ComposerSource = {
        source: view,
        id: item.id,
        title: item.title,
        ...(item.url ? { url: item.url } : {}),
        ...(view === "figma"
          ? { figmaUrl: item.url ?? figmaUrl, nodeId: item.id }
          : {}),
      };
      setView(null);
      await save({
        ...selection,
        references: [
          ...selection.references.filter(
            (reference) =>
              composerSourceKey(reference) !== composerSourceKey(source),
          ),
          source,
        ],
      });
    }
  };
  const onRemoveContextItem = (key: string) => {
    if (key === "context-state") return;
    void save({
      ...selection,
      designSystemRef: key.startsWith("system:")
        ? null
        : selection.designSystemRef,
      designSystemId: key.startsWith("system:")
        ? null
        : selection.designSystemId,
      references: selection.references.filter(
        (source) => composerSourceKey(source) !== key,
      ),
    });
  };
  const onRetryContextItem = () => {
    if (state?.scope !== scope) {
      void query.refetch();
      setSaveError(undefined);
    } else void save(selection);
  };
  const contextError =
    saveError ??
    (query.error
      ? (actionErrorMessage(query.error) ?? t("promptContext.loadFailed"))
      : undefined);
  const contextItems: AgentChatContextItem[] = [
    ...items,
    ...(contextError || busy || saving || state?.scope !== scope
      ? [
          {
            key: "context-state",
            title: t("promptContext.context"),
            context: "",
            status: contextError ? ("error" as const) : ("pending" as const),
            ...(contextError ? { statusMessage: contextError } : {}),
          },
        ]
      : []),
  ];
  const inspected = items.find((item) => item.key === inspectedKey);
  const inspectSource = selection.references.find(
    (source) => composerSourceKey(source) === inspectedKey,
  );
  const renderPicker = (controls: ComposerContextPageControls) => {
    const enteringFigmaUrl =
      view === "figma" &&
      (!figmaUrl || !listQuery.data || Boolean(listQuery.error));
    const changeSearch = (value: string) => {
      setSearch(value);
      setPage(1);
      setCursors([undefined]);
    };
    const browseFrames = () => {
      if (!figmaInput.trim() || listQuery.isFetching) return;
      if (figmaUrl === figmaInput.trim()) void listQuery.refetch();
      setFigmaUrl(figmaInput.trim());
      changeSearch("");
    };
    const picker = (
      <Command
        shouldFilter={false}
        label={t(
          enteringFigmaUrl ? "promptContext.figmaUrl" : "promptContext.search",
        )}
      >
        <ComposerContextSearchInput
          ref={searchInput}
          autoFocus
          onBack={() => {
            if (view === "figma" && figmaUrl) {
              setFigmaUrl("");
              changeSearch("");
              searchInput.current?.focus();
            } else controls.onBack();
          }}
          value={enteringFigmaUrl ? figmaInput : search}
          onValueChange={enteringFigmaUrl ? setFigmaInput : changeSearch}
          placeholder={t(
            enteringFigmaUrl
              ? "promptContext.figmaUrl"
              : "promptContext.search",
          )}
          aria-label={t(
            enteringFigmaUrl
              ? "promptContext.figmaUrl"
              : "promptContext.search",
          )}
        />
        <CommandList>
          {enteringFigmaUrl ? (
            <>
              {figmaUrl && listQuery.error && (
                <p
                  role="alert"
                  className="px-3 py-2 text-sm text-muted-foreground"
                >
                  {actionErrorMessage(listQuery.error) ??
                    t("promptContext.loadFailed")}
                </p>
              )}
              {figmaUrl && listQuery.isFetching ? (
                <div className="p-2" aria-busy="true">
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : (
                <CommandGroup>
                  <CommandItem
                    value="browse-frames"
                    disabled={!figmaInput.trim()}
                    onSelect={browseFrames}
                  >
                    {t("promptContext.browse")}
                  </CommandItem>
                </CommandGroup>
              )}
            </>
          ) : listQuery.error ? (
            <>
              <p
                role="alert"
                className="px-3 py-2 text-sm text-muted-foreground"
              >
                {actionErrorMessage(listQuery.error) ??
                  t("promptContext.loadFailed")}
              </p>
              <CommandGroup>
                <CommandItem
                  value="retry"
                  onSelect={() => void listQuery.refetch()}
                >
                  {t("promptContext.retry")}
                </CommandItem>
              </CommandGroup>
            </>
          ) : listQuery.isFetching ? (
            <div className="flex flex-col gap-2 p-2" aria-busy="true">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <>
              <CommandEmpty>
                {t(
                  view === "slides" && !search
                    ? "home.emptyTitle"
                    : "promptContext.empty",
                )}
              </CommandEmpty>
              <CommandGroup>
                {view === "system" && (
                  <CommandItem
                    value="no-design-system"
                    data-checked={!selection.designSystemId}
                    onSelect={() => {
                      void save({ ...selection, designSystemId: null });
                      controls.onClose();
                    }}
                  >
                    {t("home.none")}
                    {!selection.designSystemId && (
                      <IconCheck
                        className="ms-auto size-4"
                        aria-hidden="true"
                      />
                    )}
                  </CommandItem>
                )}
                {list.map((item) => {
                  const selected =
                    view === "system"
                      ? selection.designSystemId === item.id
                      : selection.references.some(
                          (source) =>
                            source.source === view && source.id === item.id,
                        );
                  return (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      data-checked={selected}
                      onSelect={() => {
                        void attach(item);
                        controls.onClose();
                      }}
                    >
                      <span className="truncate">{item.title}</span>
                      {selected && (
                        <IconCheck
                          className="ms-auto size-4"
                          aria-hidden="true"
                        />
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          )}
          {!enteringFigmaUrl &&
            !listQuery.error &&
            !listQuery.isFetching &&
            view !== "system" &&
            (page > 1 ||
              (listQuery.data as SourceList | undefined)?.hasMore) && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  {page > 1 && (
                    <CommandItem
                      value="previous-page"
                      onSelect={() => setPage((value) => value - 1)}
                    >
                      {t("promptContext.previous")}
                    </CommandItem>
                  )}
                  {(listQuery.data as SourceList | undefined)?.hasMore && (
                    <CommandItem
                      value="next-page"
                      onSelect={() => {
                        setCursors((current) => [
                          ...current.slice(0, page),
                          (listQuery.data as SourceList | undefined)
                            ?.nextCursor,
                        ]);
                        setPage((value) => value + 1);
                      }}
                    >
                      {t("promptContext.next")}
                    </CommandItem>
                  )}
                </CommandGroup>
              </>
            )}
          {view === "system" && (
            <>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value="create-system"
                  onSelect={() => {
                    localChange.current = true;
                    resumeSystems.current = () => controls.onResume();
                    controls.onClose({ restoreFocus: false });
                    setCreatingSystem(true);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <IconPlus className="size-4" />
                    {t("promptContext.createNew")}
                  </span>
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    );
    return enteringFigmaUrl ? (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          browseFrames();
        }}
      >
        {picker}
      </form>
    ) : (
      picker
    );
  };
  const dismissPicker = () =>
    setView((current) => (current === "inspect" ? current : null));
  const contextMenuItems: ComposerContextMenuItem[] = [
    {
      id: "design",
      label: "Design",
      icon: <IconPalette />,
      disabled: busy,
      children: [
        {
          id: "system",
          label: t("promptContext.useSystem"),
          icon: <IconPalette />,
          onSelect: () => open("system"),
          render: renderPicker,
          onDismiss: dismissPicker,
        },
        {
          id: "figma",
          label: t("promptContext.attachFigma"),
          icon: <IconBrandFigma />,
          onSelect: () => open("figma"),
          render: renderPicker,
          onDismiss: dismissPicker,
        },
        {
          id: "design-reference",
          label: t("promptContext.referenceDesign"),
          icon: <IconLayout />,
          onSelect: () => open("design"),
          render: renderPicker,
          onDismiss: dismissPicker,
        },
      ],
    },
    {
      id: "slides",
      label: "Slides",
      icon: <IconPresentation />,
      disabled: busy,
      children: [
        {
          id: "deck-reference",
          label: t("promptContext.referenceDeck"),
          icon: <IconPresentation />,
          onSelect: () => open("slides"),
          render: renderPicker,
          onDismiss: dismissPicker,
        },
      ],
    },
  ];
  const props = {
    contextItems,
    contextMenuItems,
    onRemoveContextItem,
    onInspectContextItem: (key: string) => {
      setInspectedKey(key);
      setView("inspect");
    },
    onRetryContextItem,
  };
  const beforeSend = async (
    submission: {
      contextItems?: readonly AgentChatContextItem[];
    },
    persist = true,
  ) => {
    const submittedItems = submission.contextItems ?? [];
    const record = snapshots.current.get(snapshotKey(submittedItems));
    if (!record || record.scope !== scope)
      throw new Error(t("promptContext.loadFailed"));
    const snapshot = snapshotComposerContext(record.selection);
    formatComposerContext(snapshot, submittedItems);
    const current = await resolveSelection(snapshot);
    if (
      current.some((item) => item.status === "error") &&
      snapshotKey(current) === snapshotKey(items)
    )
      setState({ scope, selection: snapshot, items: current });
    formatComposerContext(snapshot, current);
    if (deckId && persist)
      await persistComposerSubmission(deckId, snapshot, submittedItems);
    return snapshot;
  };
  const dialogs = (
    <>
      <Dialog
        open={view === "inspect"}
        onOpenChange={(value) => {
          if (!value) setView(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {inspected?.title ?? t("promptContext.context")}
            </DialogTitle>
          </DialogHeader>
          {view === "inspect" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {inspectedKey?.startsWith("system:")
                  ? t("promptContext.governing")
                  : t("promptContext.supporting")}
              </p>
              {inspected?.statusMessage && (
                <p role="alert">{inspected.statusMessage}</p>
              )}
              {inspectSource?.url && (
                <a href={inspectSource.url} target="_blank" rel="noreferrer">
                  {t("promptContext.openSource")}
                </a>
              )}
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                {inspected?.context}
              </pre>
              {inspectedKey?.startsWith("system:") &&
              (selection.designSystemRef?.ownerApp ?? "slides") === "slides" ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setView(null);
                    openWorkspace(
                      selection.designSystemRef?.id ??
                        selection.designSystemId!,
                    );
                  }}
                >
                  {t("systemWorkspace.canvas")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (inspectedKey) onRemoveContextItem(inspectedKey);
                  setView(null);
                }}
                disabled={busy}
              >
                {t("promptContext.remove")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <DesignSystemSetup
        key={`${scope}:${creationAttempt}`}
        open={creatingSystem}
        preserveWorkspaceDefaults
        originDraft={{
          app: "slides",
          draftId: originId,
          returnPath: `${window.location.pathname}${window.location.search}`,
        }}
        onCreated={(systemId) => {
          setCreatingSystem(false);
          setCreationAttempt((attempt) => attempt + 1);
          setView(null);
          resumeSystems.current = null;
          openWorkspace(systemId);
        }}
        onStartChat={() => {
          setCreatingSystem(false);
          setView(null);
          resumeSystems.current = null;
        }}
        onClose={() => {
          setCreatingSystem(false);
          setView("system");
          resumeSystems.current?.();
        }}
        onComplete={() => {
          setCreatingSystem(false);
          setView("system");
          resumeSystems.current?.();
          void listQuery.refetch();
        }}
      />
    </>
  );
  return { props, dialogs, selection, beforeSend };
}

export function SlidesPromptComposer({
  deckId,
  deferContextPersistence,
  onSubmit,
  ...props
}: PromptComposerProps & {
  deckId?: string;
  deferContextPersistence?: boolean;
}) {
  const context = useSlidesComposerContext(deckId, undefined, props.draftScope);
  return (
    <SlidesComposerInput
      {...props}
      onSubmit={onSubmit}
      context={context}
      deferContextPersistence={deferContextPersistence}
    />
  );
}

export function SlidesComposerInput({
  context,
  deferContextPersistence = false,
  onSubmit,
  ...props
}: PromptComposerProps & {
  context: ReturnType<typeof useSlidesComposerContext>;
  deferContextPersistence?: boolean;
}) {
  return (
    <>
      <PromptComposer
        {...props}
        {...context.props}
        onSubmit={async (text, files, references, options) => {
          const contextItems = [
            ...(options.contextItems ?? []),
            ...references.map((reference) => ({
              key: `mention:${reference.source}:${reference.refId ?? reference.path}`,
              title: reference.name,
              context: `Mentioned ${reference.refType ?? reference.type}: ${reference.name} (${reference.source}; ${reference.refId ?? reference.path})`,
            })),
          ];
          const snapshot = await context.beforeSend(
            { contextItems },
            !deferContextPersistence,
          );
          const contextText = formatComposerContext(snapshot, contextItems);
          const submittedOptions: SlidesPromptSubmitOptions = {
            ...options,
            contextItems,
            slidesContext: snapshot,
            slidesContextText: contextText,
          };
          await onSubmit(text, files, references, submittedOptions);
        }}
      />
      {context.dialogs}
    </>
  );
}
