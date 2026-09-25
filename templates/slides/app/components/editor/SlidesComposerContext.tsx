import {
  useActionQuery,
  useSession,
  actionErrorMessage,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { composerSourceListSchema } from "@agent-native/core/shared";
import {
  ComposerContextSearchInput,
  snapshotComposerContextItems,
  type AgentChatContextItem,
  type ComposerContextMenuItem,
  type ComposerContextPageControls,
} from "@agent-native/toolkit/composer";
import {
  IconBrandFigma,
  IconLayout,
  IconPalette,
  IconPresentation,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  composerSourceKey,
  formatSlidesComposerContext,
  readSlidesComposerContext,
  slidesComposerContextSchema,
  type ComposerSource,
  type SlidesComposerContext,
} from "@/lib/composer-context";

type SourceKind = ComposerSource["source"] | "system";

export function useSlidesComposerContext({
  defaultDesignSystemId,
  defaultReferenceDeck,
  systems,
  systemsError,
  systemsLoading,
  retrySystems,
}: {
  defaultDesignSystemId: string | null;
  defaultReferenceDeck?: { id: string; title: string };
  systems: Array<{ id: string; title: string }>;
  systemsError?: unknown;
  systemsLoading?: boolean;
  retrySystems?: () => unknown;
}) {
  const t = useT();
  const { session } = useSession();
  const identity = `${session?.email ?? "guest"}:${session?.orgId ?? "personal"}`;
  const storageKey = `slides-home-context:${identity}`;
  const defaultDeckId = defaultReferenceDeck?.id;
  const defaultDeckTitle = defaultReferenceDeck?.title;
  const [selection, setSelection] = useState<SlidesComposerContext>({
    designSystemId: null,
    references: [],
  });
  const [items, setItems] = useState<AgentChatContextItem[]>([]);
  const [error, setError] = useState<string>();
  const [view, setView] = useState<SourceKind | null>(null);
  const [search, setSearch] = useState("");
  const [figmaInput, setFigmaInput] = useState("");
  const [figmaUrl, setFigmaUrl] = useState("");
  const [cursors, setCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [page, setPage] = useState(1);
  const [inspectedKey, setInspectedKey] = useState<string>();
  const version = useRef(0);
  const edited = useRef(false);
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    edited.current = false;
    setView(null);
    setError(undefined);
    version.current++;
  }, [identity]);
  useEffect(() => {
    if (edited.current) return;
    try {
      const stored = localStorage.getItem(storageKey);
      setSelection(
        stored
          ? slidesComposerContextSchema.parse(JSON.parse(stored))
          : {
              designSystemId: defaultDesignSystemId,
              references:
                defaultDeckId && defaultDeckTitle !== undefined
                  ? [
                      {
                        source: "slides",
                        id: defaultDeckId,
                        title: defaultDeckTitle,
                      },
                    ]
                  : [],
            },
      );
    } catch (cause) {
      setSelection({ designSystemId: null, references: [] });
      setError(actionErrorMessage(cause) ?? t("home.context.loadFailed"));
    }
  }, [storageKey, defaultDesignSystemId, defaultDeckId, defaultDeckTitle, t]);

  useEffect(() => {
    const currentVersion = ++version.current;
    let active = true;
    setItems([
      ...(selection.designSystemId
        ? [
            {
              key: `system:${selection.designSystemId}`,
              title: t("home.context.system"),
              context: "",
              status: "pending" as const,
            },
          ]
        : []),
      ...selection.references.map((source) => ({
        key: composerSourceKey(source),
        title: source.title,
        context: "",
        status: "pending" as const,
      })),
    ]);
    void readSlidesComposerContext(
      selection,
      t("home.context.emptySource"),
    ).then((resolved) => {
      if (active && currentVersion === version.current) setItems(resolved);
    });
    return () => {
      active = false;
    };
  }, [selection, identity, t]);

  const save = (next: SlidesComposerContext) => {
    if (!slidesComposerContextSchema.safeParse(next).success) {
      setError(t("home.context.tooMany"));
      return;
    }
    edited.current = true;
    setSelection(next);
    setError(undefined);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setError(t("home.context.saveFailed"));
    }
  };
  const remove = (key: string) => {
    if (key === "context-state") {
      save({ designSystemId: null, references: [] });
      return;
    }
    save({
      designSystemId: key.startsWith("system:")
        ? null
        : selection.designSystemId,
      references: selection.references.filter(
        (source) => composerSourceKey(source) !== key,
      ),
    });
  };
  const listQuery = useActionQuery(
    "read-composer-source",
    {
      source: view === "design" || view === "figma" ? view : "slides",
      operation: "list",
      search,
      page,
      ...(cursors[page - 1] ? { cursor: cursors[page - 1] } : {}),
      ...(view === "figma" ? { figmaUrl } : {}),
    },
    {
      enabled: Boolean(
        session && view && view !== "system" && (view !== "figma" || figmaUrl),
      ),
    },
  );
  const open = (kind: SourceKind) => {
    setView(kind);
    setSearch("");
    setPage(1);
    setCursors([undefined]);
    setFigmaInput("");
    setFigmaUrl("");
  };
  const renderPicker = (controls: ComposerContextPageControls) => {
    const enteringFigma = view === "figma" && !figmaUrl;
    const parsed =
      listQuery.data === undefined
        ? undefined
        : composerSourceListSchema.safeParse(listQuery.data);
    const result = parsed?.success ? parsed.data : undefined;
    const queryError = view === "system" ? systemsError : listQuery.error;
    const listError = queryError
      ? (actionErrorMessage(queryError) ?? t("home.context.loadFailed"))
      : view !== "system" && parsed?.success === false
        ? t("home.context.loadFailed")
        : undefined;
    const list: Array<{ id: string; title: string; url?: string }> =
      view === "system"
        ? systems.filter((item) =>
            item.title.toLowerCase().includes(search.toLowerCase()),
          )
        : (result?.items ?? []);
    return (
      <Command shouldFilter={false}>
        <ComposerContextSearchInput
          onBack={() => controls.onBack()}
          autoFocus
          value={enteringFigma ? figmaInput : search}
          onValueChange={(value) => {
            if (enteringFigma) setFigmaInput(value);
            else {
              setSearch(value);
              setPage(1);
              setCursors([undefined]);
            }
          }}
          placeholder={t(
            enteringFigma ? "home.context.figmaUrl" : "home.context.search",
          )}
          aria-label={t(
            enteringFigma ? "home.context.figmaUrl" : "home.context.search",
          )}
        />
        <CommandList>
          {enteringFigma ? (
            <CommandGroup>
              <CommandItem
                disabled={!figmaInput.trim()}
                onSelect={() => setFigmaUrl(figmaInput.trim())}
              >
                {t("home.context.browse")}
              </CommandItem>
            </CommandGroup>
          ) : listError ? (
            <CommandGroup>
              <p role="alert" className="p-3 text-sm text-destructive">
                {listError}
              </p>
              <CommandItem
                onSelect={() =>
                  void (view === "system"
                    ? retrySystems?.()
                    : listQuery.refetch())
                }
              >
                {t("home.retry")}
              </CommandItem>
            </CommandGroup>
          ) : (view === "system" ? systemsLoading : listQuery.isFetching) ? (
            <div className="p-2" aria-busy="true">
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <>
              <CommandEmpty>{t("home.context.empty")}</CommandEmpty>
              <CommandGroup>
                {view === "system" && (
                  <CommandItem
                    onSelect={() => {
                      save({ ...selection, designSystemId: null });
                      controls.onClose();
                    }}
                  >
                    {t("home.none")}
                  </CommandItem>
                )}
                {list.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => {
                      if (view === "system")
                        save({ ...selection, designSystemId: item.id });
                      else if (view) {
                        const source: ComposerSource = {
                          source: view,
                          ...item,
                          ...(view === "figma"
                            ? {
                                figmaUrl: item.url ?? figmaUrl,
                                nodeId: item.id,
                              }
                            : {}),
                        };
                        save({
                          ...selection,
                          references: [
                            ...selection.references.filter(
                              (value) =>
                                composerSourceKey(value) !==
                                composerSourceKey(source),
                            ),
                            source,
                          ],
                        });
                      }
                      controls.onClose();
                    }}
                  >
                    {item.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          {!enteringFigma && view !== "system" && !listError && (
            <CommandGroup>
              {page > 1 && (
                <CommandItem onSelect={() => setPage(page - 1)}>
                  {t("home.context.previous")}
                </CommandItem>
              )}
              {result?.hasMore && (
                <CommandItem
                  onSelect={() => {
                    setCursors([...cursors.slice(0, page), result.nextCursor]);
                    setPage(page + 1);
                  }}
                >
                  {t("home.context.next")}
                </CommandItem>
              )}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    );
  };
  const contextItems = error
    ? [
        ...items,
        {
          key: "context-state",
          title: t("home.context.title"),
          context: "",
          status: "error" as const,
          statusMessage: error,
        },
      ]
    : items;
  const contextMenuItems: ComposerContextMenuItem[] = [
    {
      id: "design-context",
      label: t("home.context.designCategory"),
      searchPlaceholder: t("home.context.menu.searchDesign"),
      icon: <IconLayout />,
      children: [
        {
          id: "system",
          label: t("home.context.menu.system"),
          icon: <IconPalette />,
          onSelect: () => open("system"),
          render: renderPicker,
          onDismiss: () => setView(null),
        },
        {
          id: "figma",
          label: t("home.context.menu.figma"),
          icon: <IconBrandFigma />,
          onSelect: () => open("figma"),
          render: renderPicker,
          onDismiss: () => setView(null),
        },
        {
          id: "design",
          label: t("home.context.menu.design"),
          icon: <IconLayout />,
          onSelect: () => open("design"),
          render: renderPicker,
          onDismiss: () => setView(null),
        },
        {
          id: "slides",
          label: t("home.context.menu.deck"),
          icon: <IconPresentation />,
          onSelect: () => open("slides"),
          render: renderPicker,
          onDismiss: () => setView(null),
        },
      ],
    },
  ];
  const inspected = contextItems.find((item) => item.key === inspectedKey);
  return {
    props: {
      contextItems,
      contextMenuItems,
      onRemoveContextItem: remove,
      onRetryContextItem: () => setSelection({ ...selection }),
      onInspectContextItem: setInspectedKey,
    },
    beforeSend: async (submitted?: readonly AgentChatContextItem[]) => {
      const capturedIdentity = identity;
      const snapshot = structuredClone(selectionRef.current);
      formatSlidesComposerContext(
        snapshot,
        submitted ?? contextItems,
        t("home.context.notReady"),
      );
      const resolved = await readSlidesComposerContext(
        snapshot,
        t("home.context.emptySource"),
      );
      if (capturedIdentity !== activeIdentity.current)
        throw new Error(t("home.context.loadFailed"));
      if (JSON.stringify(snapshot) === JSON.stringify(selectionRef.current))
        setItems(resolved);
      formatSlidesComposerContext(
        snapshot,
        resolved,
        t("home.context.notReady"),
      );
      const frozen = snapshotComposerContextItems(resolved);
      return {
        selection: snapshot,
        items: frozen,
        text: formatSlidesComposerContext(
          snapshot,
          frozen,
          t("home.context.notReady"),
        ),
      };
    },
    dialogs: (
      <Dialog
        open={Boolean(inspectedKey)}
        onOpenChange={(open) => !open && setInspectedKey(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {inspected?.title ?? t("home.context.title")}
            </DialogTitle>
          </DialogHeader>
          {inspected?.statusMessage && (
            <p role="alert">{inspected.statusMessage}</p>
          )}
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
            {inspected?.context}
          </pre>
          <Button
            variant="outline"
            onClick={() => {
              if (inspectedKey) remove(inspectedKey);
              setInspectedKey(undefined);
            }}
          >
            {t("home.context.remove")}
          </Button>
        </DialogContent>
      </Dialog>
    ),
  };
}
