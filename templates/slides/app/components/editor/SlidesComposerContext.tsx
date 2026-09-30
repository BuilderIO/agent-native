import {
  callAction,
  useChangeVersions,
  useSession,
  actionErrorMessage,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { composerSourceListSchema } from "@agent-native/core/shared";
import {
  useAgentKitCapabilities,
  useAgentKitIntegrationMenu,
  readAssistantChatComposerContextDraft,
  writeAssistantChatComposerContextDraft,
} from "@agent-native/toolkit/app/chat/composer/index";
import {
  snapshotComposerContextItems,
  type AgentChatContextItem,
  type ComposerContextMenuItem,
  type ComposerContextSnapshot,
  type ComposerContextPickerConfig,
  type ComposerContextPickerItem,
  type ComposerContextPickerRequest,
} from "@agent-native/toolkit/composer";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import SlideRenderer from "@/components/deck/SlideRenderer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Slide } from "@/context/DeckContext";
import { useDesignSystemWorkflows } from "@/hooks/use-design-system-workflows";
import type { AspectRatio } from "@/lib/aspect-ratios";
import {
  composerSourceErrorMessage,
  composerSourceKey,
  formatSlidesComposerContext,
  readSlidesComposerContext,
  slidesComposerContextSchema,
  type ComposerSource,
  type SlidesComposerContext,
} from "@/lib/composer-context";
import { getDeckListingPreviewFrameStyle } from "@/lib/deck-preview-frame";

function figmaPickerId(reference: ComposerSource) {
  return `${encodeURIComponent(composerSourceKey(reference))}:${encodeURIComponent(reference.id)}`;
}

export function useSlidesComposerContext({
  active = true,
  initialSelection,
  defaultDesignSystemId,
  defaultReferenceDeck,
  systems,
  systemsError,
  systemsLoading,
  retrySystems,
  onCreateDesignSystem,
  scopeKey,
  persistSelection = true,
  draftScope,
}: {
  active?: boolean;
  initialSelection?: SlidesComposerContext;
  defaultDesignSystemId: string | null;
  defaultReferenceDeck?: { id: string; title: string };
  systems: Array<{ id: string; title: string }>;
  systemsError?: unknown;
  systemsLoading?: boolean;
  retrySystems?: () => unknown;
  onCreateDesignSystem: () => void;
  scopeKey?: string;
  persistSelection?: boolean;
  draftScope?: string;
}) {
  const t = useT();
  const formatters = useFormatters();
  const capabilities = useAgentKitCapabilities();
  const systemsEnabled = useDesignSystemWorkflows();
  const { session } = useSession();
  const accountIdentity = `${session?.email ?? "guest"}:${session?.orgId ?? "personal"}`;
  const identity = JSON.stringify([
    session?.authUserId,
    accountIdentity,
    scopeKey ?? "home",
  ]);
  const refreshKey = useChangeVersions([
    "action",
    "decks",
    "slides",
    "designs",
  ]);
  const storageKey = `slides-home-context:${session?.authUserId ? `${session.authUserId}:` : ""}${accountIdentity}`;
  const defaultDeckId = defaultReferenceDeck?.id;
  const defaultDeckTitle = defaultReferenceDeck?.title;
  const [storedSelection, setSelection] = useState<SlidesComposerContext>({
    designSystemId: null,
    references: [],
  });
  const selection = useMemo(
    () =>
      systemsEnabled
        ? storedSelection
        : { ...storedSelection, designSystemId: null },
    [systemsEnabled, storedSelection],
  );
  const [items, setItems] = useState<AgentChatContextItem[]>([]);
  const [error, setError] = useState<string>();
  const [draftHydrated, setDraftHydrated] = useState(!draftScope);
  const [inspectedKey, setInspectedKey] = useState<string>();
  const version = useRef(0);
  const edited = useRef(false);
  const initialSelectionKey = useRef<string | undefined>(undefined);
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const storedSelectionRef = useRef(storedSelection);
  storedSelectionRef.current = storedSelection;
  const activeRef = useRef(active);
  activeRef.current = active;
  const mounted = useRef(true);
  const systemVersion = useRef(0);
  const submissionReceipts = useRef(
    new WeakMap<
      ComposerContextSnapshot,
      {
        identity: string;
        references: Map<string, ComposerSource>;
        systemId: string | null;
        systemVersion: number;
      }
    >(),
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    edited.current = false;
    initialSelectionKey.current = undefined;
    setError(undefined);
    version.current++;
    systemVersion.current++;
  }, [identity]);
  useEffect(() => {
    if (!active) setInspectedKey(undefined);
  }, [active]);
  useEffect(() => {
    if (edited.current) return;
    try {
      if (draftScope) {
        const draft = readAssistantChatComposerContextDraft(draftScope);
        setSelection(
          draft
            ? slidesComposerContextSchema.parse(draft)
            : { designSystemId: null, references: [] },
        );
        setDraftHydrated(true);
        return;
      }
      const stored = persistSelection
        ? window.localStorage.getItem(storageKey)
        : null;
      setSelection(
        stored
          ? slidesComposerContextSchema.parse(JSON.parse(stored))
          : {
              designSystemId: systemsEnabled ? defaultDesignSystemId : null,
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
      setError(
        draftScope
          ? t("home.context.loadFailed")
          : (actionErrorMessage(cause) ?? t("home.context.loadFailed")),
      );
    }
  }, [
    storageKey,
    draftScope,
    identity,
    persistSelection,
    defaultDesignSystemId,
    defaultDeckId,
    defaultDeckTitle,
    t,
    systemsEnabled,
  ]);
  useEffect(() => {
    if (!initialSelection) {
      initialSelectionKey.current = undefined;
      return;
    }
    const key = JSON.stringify(initialSelection);
    if (initialSelectionKey.current === key) return;
    initialSelectionKey.current = key;
    const next = systemsEnabled
      ? initialSelection
      : { ...initialSelection, designSystemId: storedSelection.designSystemId };
    edited.current = true;
    selectionRef.current = next;
    setSelection(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setError(t("home.context.saveFailed"));
    }
  }, [
    initialSelection,
    storageKey,
    storedSelection.designSystemId,
    systemsEnabled,
    t,
  ]);

  useEffect(() => {
    if (!active) return;
    const currentVersion = ++version.current;
    let isActive = true;
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
      t("home.context.figmaReadFailed"),
      t("home.context.websiteReadFailed"),
    ).then((resolved) => {
      if (isActive && currentVersion === version.current) setItems(resolved);
    });
    return () => {
      isActive = false;
    };
  }, [active, selection, identity, t]);

  const save = (next: SlidesComposerContext) => {
    if (!slidesComposerContextSchema.safeParse(next).success) {
      setError(t("home.context.tooMany"));
      return false;
    }
    edited.current = true;
    const persisted = systemsEnabled
      ? next
      : { ...next, designSystemId: storedSelectionRef.current.designSystemId };
    if (next.designSystemId !== selectionRef.current.designSystemId)
      systemVersion.current++;
    selectionRef.current = next;
    storedSelectionRef.current = persisted;
    setSelection(persisted);
    setError(undefined);
    setDraftHydrated(true);
    if (!persistSelection && !draftScope) return true;
    try {
      if (draftScope)
        writeAssistantChatComposerContextDraft(draftScope, persisted);
      else window.localStorage.setItem(storageKey, JSON.stringify(persisted));
    } catch {
      setError(t("home.context.saveFailed"));
      return false;
    }
    return true;
  };
  const attachBatch = (references: readonly ComposerSource[]) => {
    if (!activeRef.current || activeIdentity.current !== identity)
      throw new Error(t("home.context.loadFailed"));
    const current = selectionRef.current;
    const combined = new Map(
      current.references.map((reference) => [
        composerSourceKey(reference),
        reference,
      ]),
    );
    for (const reference of references)
      combined.set(composerSourceKey(reference), reference);
    if (combined.size > 20) throw new Error(t("home.context.tooMany"));
    return save({ ...current, references: [...combined.values()] });
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
  const referencePicker = (
    source: Exclude<ComposerSource["source"], "website" | "integration">,
  ): Extract<ComposerContextPickerConfig, { load: unknown }> => {
    const toReference = (
      item: ComposerContextPickerItem,
      request: ComposerContextPickerRequest,
    ): ComposerSource => {
      const id =
        source === "figma"
          ? decodeURIComponent(item.id.slice(item.id.lastIndexOf(":") + 1))
          : item.id;
      return {
        source,
        id,
        title: item.title,
        ...(item.url ? { url: item.url } : {}),
        ...(source === "figma"
          ? { figmaUrl: item.url ?? request.url, nodeId: id }
          : {}),
      };
    };
    return {
      scopeKey: identity,
      refreshKey,
      presentation: {
        type: "dialog",
        mode: "multiple",
        ...(source === "slides" ? { layout: "gallery" as const } : {}),
        onAttach: (
          items: readonly ComposerContextPickerItem[],
          request: ComposerContextPickerRequest,
        ) => attachBatch(items.map((item) => toReference(item, request))),
      },
      searchPlaceholder: t(
        source === "figma"
          ? "home.context.searchFrames"
          : source === "slides"
            ? "home.context.searchPresentations"
            : "home.context.searchDesigns",
      ),
      emptyMessage: t("home.context.empty"),
      selectedIds: selection.references
        .filter((reference) => reference.source === source)
        .map((reference) =>
          source === "figma" ? figmaPickerId(reference) : reference.id,
        ),
      ...(source === "figma"
        ? {
            link: {
              label: t("home.context.figmaUrlLabel"),
              placeholder: t("home.context.figmaUrl"),
              submitLabel: t("home.context.browse"),
              validate: (url: string) => {
                const parsed = new URL(url);
                return url.trim().length <= 2048 &&
                  /(^|\.)figma\.com$/i.test(parsed.hostname) &&
                  /\/(design|file|proto)\/[A-Za-z0-9_-]{8,}/.test(
                    parsed.pathname,
                  )
                  ? undefined
                  : t("home.context.invalidFigmaUrl");
              },
            },
          }
        : {}),
      load: async ({ search, page, cursor, url, signal }) => {
        try {
          const result = composerSourceListSchema.safeParse(
            await callAction(
              "read-composer-source",
              {
                source,
                operation: "list",
                search,
                page,
                cursor,
                ...(source === "figma" ? { figmaUrl: url } : {}),
              },
              { method: "GET", signal },
            ),
          );
          if (
            !result.success ||
            (source === "slides" &&
              result.data.hasMore &&
              !result.data.nextCursor)
          )
            throw new Error(t("home.context.loadFailed"));
          return {
            ...result.data,
            items: result.data.items.map((item) => ({
              ...item,
              ...(source === "figma" ? { url: item.url ?? url } : {}),
              id:
                source === "figma"
                  ? figmaPickerId({
                      ...item,
                      source: "figma",
                      figmaUrl: item.url ?? url,
                    })
                  : item.id,
            })),
          };
        } catch (error) {
          throw new Error(
            composerSourceErrorMessage(
              error,
              t("home.context.loadFailed"),
              t("home.context.figmaReadFailed"),
            ),
          );
        }
      },
    };
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
    : !draftHydrated
      ? [
          {
            key: "context-state",
            title: t("home.context.title"),
            context: "",
            status: "pending" as const,
          },
        ]
      : items;
  const integrationMenu = useAgentKitIntegrationMenu({
    capabilities,
    scopeKey: identity,
    onSelect: (integration) => {
      attachBatch([
        { id: integration.id, title: integration.label, source: "integration" },
      ]);
    },
  });
  const contextMenuItems: ComposerContextMenuItem[] = [
    {
      id: "design-context",
      label: t("home.context.designCategory"),
      searchPlaceholder: t("home.context.menu.searchDesign"),
      children: [
        {
          id: "deck",
          label: t("home.context.menu.deck"),
          intent: "add-context",
          picker: {
            ...referencePicker("slides"),
            load: async ({ search, cursor, signal }) => {
              const result = await callAction<{
                decks: Array<{
                  id: string;
                  title: string;
                  previewSlide?: Slide;
                  aspectRatio?: AspectRatio;
                  updatedAt: string;
                }>;
                nextCursor?: string;
              }>(
                "list-decks",
                { includePreview: "true", limit: 12, search, cursor },
                { method: "GET", signal },
              );
              return {
                hasMore: Boolean(result.nextCursor),
                nextCursor: result.nextCursor,
                items: result.decks.map((deck) => ({
                  id: deck.id,
                  title: deck.title,
                  preview: deck.previewSlide ? (
                    <div className="flex h-full items-center justify-center overflow-hidden">
                      <div
                        className="slide-reference-preview-frame relative h-full overflow-hidden"
                        style={
                          {
                            "--reference-ratio":
                              getDeckListingPreviewFrameStyle(deck.aspectRatio)
                                .aspectRatio,
                            "--reference-width":
                              getDeckListingPreviewFrameStyle(deck.aspectRatio)
                                .width,
                          } as CSSProperties
                        }
                      >
                        <SlideRenderer
                          slide={deck.previewSlide}
                          thumbnail
                          aspectRatio={deck.aspectRatio}
                        />
                      </div>
                    </div>
                  ) : null,
                  metadata: (
                    <time dateTime={deck.updatedAt}>
                      {formatters.formatDate(deck.updatedAt, {
                        dateStyle: "medium",
                      })}
                    </time>
                  ),
                })),
              };
            },
          },
        },
        ...(systemsEnabled
          ? [
              {
                id: "system",
                label: t("home.context.menu.system"),
                picker: {
                  presentation: { type: "dialog", mode: "single" },
                  scopeKey: identity,
                  searchPlaceholder: t("home.context.searchSystems"),
                  selectedIds: selection.designSystemId
                    ? [selection.designSystemId]
                    : [],
                  items: systems,
                  loading: systemsLoading,
                  error: systemsError
                    ? (actionErrorMessage(systemsError) ??
                      t("home.context.loadFailed"))
                    : undefined,
                  onRetry: retrySystems,
                  emptyMessage: systems.length
                    ? t("home.context.empty")
                    : t("home.context.noSystems"),
                  footerAction: {
                    label: t("home.context.createSystem"),
                    onSelect: onCreateDesignSystem,
                  },
                  clearSelection: selection.designSystemId
                    ? {
                        label: t("home.none"),
                        onSelect: () =>
                          save({ ...selection, designSystemId: null }),
                      }
                    : undefined,
                  onSelect: (item) => {
                    if (
                      !activeRef.current ||
                      activeIdentity.current !== identity
                    )
                      throw new Error(t("home.context.loadFailed"));
                    return save({
                      ...selectionRef.current,
                      designSystemId: item.id,
                    });
                  },
                },
              } satisfies ComposerContextMenuItem,
            ]
          : []),
        ...(capabilities.data?.sources.figma.available
          ? [
              {
                id: "figma",
                label: t("home.context.menu.figma"),
                intent: "add-context" as const,
                picker: referencePicker("figma"),
              } satisfies ComposerContextMenuItem,
            ]
          : []),
        {
          id: "website",
          label: t("home.context.websiteReference"),
          intent: "add-context",
          picker: {
            scopeKey: identity,
            searchPlaceholder: t("home.context.websiteUrl"),
            presentation: { type: "dialog", mode: "url" },
            link: {
              label: t("home.context.websiteUrlLabel"),
              placeholder: t("home.context.websiteUrl"),
              submitLabel: t("home.context.websiteReference"),
              validate: (url) =>
                url.trim().length <= 2048 &&
                !new URL(url).username &&
                !new URL(url).password
                  ? undefined
                  : t("home.quickStart.invalidUrl"),
            },
            onSelect: (item) =>
              attachBatch([
                { ...item, source: "website", url: item.url ?? item.id },
              ]),
          },
        },
        integrationMenu,
      ],
    },
  ];
  const inspected = contextItems.find((item) => item.key === inspectedKey);
  const renderedSystemVersion = systemVersion.current;
  const beforeSend = async (submitted?: readonly AgentChatContextItem[]) => {
    const capturedIdentity = identity;
    const capturedSystemVersion = renderedSystemVersion;
    const capturedItems = submitted ?? contextItems;
    const keys = new Set(capturedItems.map((item) => item.key));
    const current = selection;
    const capturedReferences = current.references.filter((source) =>
      keys.has(composerSourceKey(source)),
    );
    const snapshot = structuredClone({
      designSystemId:
        current.designSystemId && keys.has(`system:${current.designSystemId}`)
          ? current.designSystemId
          : null,
      references: capturedReferences,
    });
    formatSlidesComposerContext(
      snapshot,
      capturedItems,
      t("home.context.notReady"),
    );
    const resolved = await readSlidesComposerContext(
      snapshot,
      t("home.context.emptySource"),
      t("home.context.figmaReadFailed"),
    );
    if (!mounted.current || capturedIdentity !== activeIdentity.current)
      throw new Error(t("home.context.loadFailed"));
    if (
      snapshot.designSystemId === selectionRef.current.designSystemId &&
      capturedSystemVersion === systemVersion.current &&
      capturedReferences.length === selectionRef.current.references.length &&
      capturedReferences.every(
        (source, index) => source === selectionRef.current.references[index],
      )
    )
      setItems(resolved);
    formatSlidesComposerContext(snapshot, resolved, t("home.context.notReady"));
    const frozen = snapshotComposerContextItems(resolved);
    submissionReceipts.current.set(frozen, {
      identity: capturedIdentity,
      references: new Map(
        capturedReferences.map((source) => [composerSourceKey(source), source]),
      ),
      systemId: snapshot.designSystemId,
      systemVersion: capturedSystemVersion,
    });
    return {
      selection: snapshot,
      items: frozen,
      text: formatSlidesComposerContext(
        snapshot,
        frozen,
        t("home.context.notReady"),
      ),
    };
  };
  const submissionAccepted = (snapshot: ComposerContextSnapshot) => {
    const receipt = submissionReceipts.current.get(snapshot);
    submissionReceipts.current.delete(snapshot);
    if (!mounted.current || receipt?.identity !== activeIdentity.current)
      return;
    const current = selectionRef.current;
    save({
      designSystemId:
        receipt.systemId === current.designSystemId &&
        receipt.systemVersion === systemVersion.current
          ? null
          : current.designSystemId,
      references: current.references.filter(
        (source) =>
          receipt.references.get(composerSourceKey(source)) !== source,
      ),
    });
  };
  return {
    selection,
    props: {
      contextItems,
      contextMenuItems: active ? contextMenuItems : [],
      onRemoveContextItem: remove,
      onRetryContextItem: () => setSelection((current) => ({ ...current })),
      onInspectContextItem: setInspectedKey,
    },
    beforeSend,
    submissionAccepted,
    dialogs: (
      <Dialog
        open={active && Boolean(inspectedKey)}
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
