import {
  callAction,
  useChangeVersions,
  useSession,
  actionErrorMessage,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { composerSourceListSchema } from "@agent-native/core/shared";
import {
  snapshotComposerContextItems,
  type AgentChatContextItem,
  type ComposerContextMenuItem,
  type ComposerContextPickerConfig,
  type ComposerContextPickerItem,
  type ComposerContextPickerRequest,
} from "@agent-native/toolkit/composer";
import {
  IconComponents,
  IconLink,
  IconOmega,
  IconTextRecognition,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDesignSystemWorkflows } from "@/hooks/use-design-system-workflows";
import {
  composerSourceErrorMessage,
  composerSourceKey,
  formatSlidesComposerContext,
  readSlidesComposerContext,
  slidesComposerContextSchema,
  type ComposerSource,
  type SlidesComposerContext,
} from "@/lib/composer-context";

function figmaPickerId(reference: ComposerSource) {
  return `${encodeURIComponent(composerSourceKey(reference))}:${encodeURIComponent(reference.id)}`;
}

export function useSlidesComposerContext({
  active = true,
  defaultDesignSystemId,
  defaultReferenceDeck,
  systems,
  systemsError,
  systemsLoading,
  retrySystems,
  onCreateDesignSystem,
}: {
  active?: boolean;
  defaultDesignSystemId: string | null;
  defaultReferenceDeck?: { id: string; title: string };
  systems: Array<{ id: string; title: string }>;
  systemsError?: unknown;
  systemsLoading?: boolean;
  retrySystems?: () => unknown;
  onCreateDesignSystem: () => void;
}) {
  const t = useT();
  const systemsEnabled = useDesignSystemWorkflows();
  const { session } = useSession();
  const identity = `${session?.email ?? "guest"}:${session?.orgId ?? "personal"}`;
  const refreshKey = useChangeVersions([
    "action",
    "decks",
    "slides",
    "designs",
  ]);
  const storageKey = `slides-home-context:${identity}`;
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
  const [inspectedKey, setInspectedKey] = useState<string>();
  const version = useRef(0);
  const edited = useRef(false);
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    edited.current = false;
    setError(undefined);
    version.current++;
  }, [identity]);
  useEffect(() => {
    if (!active) setInspectedKey(undefined);
  }, [active]);
  useEffect(() => {
    if (edited.current) return;
    try {
      const stored = localStorage.getItem(storageKey);
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
      setError(actionErrorMessage(cause) ?? t("home.context.loadFailed"));
    }
  }, [
    storageKey,
    defaultDesignSystemId,
    defaultDeckId,
    defaultDeckTitle,
    t,
    systemsEnabled,
  ]);

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
      t("home.context.figmaReadFailed"),
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
      return false;
    }
    edited.current = true;
    const persisted = systemsEnabled
      ? next
      : { ...next, designSystemId: storedSelection.designSystemId };
    selectionRef.current = next;
    setSelection(persisted);
    setError(undefined);
    try {
      localStorage.setItem(storageKey, JSON.stringify(persisted));
    } catch {
      setError(t("home.context.saveFailed"));
      return false;
    }
    return true;
  };
  const attachBatch = (references: readonly ComposerSource[]) => {
    if (activeIdentity.current !== identity)
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
    source: Exclude<ComposerSource["source"], "website">,
  ): ComposerContextPickerConfig => {
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
            presentation: {
              type: "dialog" as const,
              mode: "multiple" as const,
              onAttach: (
                items: readonly ComposerContextPickerItem[],
                request: ComposerContextPickerRequest,
              ) => attachBatch(items.map((item) => toReference(item, request))),
            },
          }
        : {
            onSelect: (
              item: ComposerContextPickerItem,
              request: ComposerContextPickerRequest,
            ) => attachBatch([toReference(item, request)]),
          }),
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
    : items;
  const contextMenuItems: ComposerContextMenuItem[] = [
    {
      id: "design-context",
      label: t("home.context.designCategory"),
      searchPlaceholder: t("home.context.menu.searchDesign"),
      icon: <IconTextRecognition size={16} />,
      children: [
        ...(systemsEnabled
          ? [
              {
                id: "system",
                label: t("home.context.menu.system"),
                icon: <IconOmega size={16} />,
                picker: {
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
                    icon: <IconOmega size={16} />,
                    onSelect: onCreateDesignSystem,
                  },
                  clearSelection: selection.designSystemId
                    ? {
                        label: t("home.none"),
                        onSelect: () =>
                          save({ ...selection, designSystemId: null }),
                      }
                    : undefined,
                  onSelect: (item) =>
                    save({ ...selection, designSystemId: item.id }),
                },
              } satisfies ComposerContextMenuItem,
            ]
          : []),
        {
          id: "figma",
          label: t("home.context.menu.figma"),
          icon: <IconComponents size={16} />,
          picker: referencePicker("figma"),
        },
        {
          id: "website",
          label: t("home.context.websiteReference"),
          icon: <IconLink size={16} />,
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
      ],
    },
  ];
  const inspected = contextItems.find((item) => item.key === inspectedKey);
  return {
    props: {
      contextItems,
      contextMenuItems,
      onRemoveContextItem: remove,
      onRetryContextItem: () => setSelection((current) => ({ ...current })),
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
        t("home.context.figmaReadFailed"),
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
