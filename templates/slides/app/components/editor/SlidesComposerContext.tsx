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
} from "@agent-native/toolkit/composer";
import {
  IconComponents,
  IconLink,
  IconOmega,
  IconTextRecognition,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  composerSourceKey,
  formatSlidesComposerContext,
  readSlidesComposerContext,
  slidesComposerContextSchema,
  type ComposerSource,
  type SlidesComposerContext,
} from "@/lib/composer-context";

export function useSlidesComposerContext({
  defaultDesignSystemId,
  defaultReferenceDeck,
  systems,
  systemsError,
  systemsLoading,
  retrySystems,
  onCreateDesignSystem,
}: {
  defaultDesignSystemId: string | null;
  defaultReferenceDeck?: { id: string; title: string };
  systems: Array<{ id: string; title: string }>;
  systemsError?: unknown;
  systemsLoading?: boolean;
  retrySystems?: () => unknown;
  onCreateDesignSystem: () => void;
}) {
  const t = useT();
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
  const [selection, setSelection] = useState<SlidesComposerContext>({
    designSystemId: null,
    references: [],
  });
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
      return false;
    }
    edited.current = true;
    setSelection(next);
    setError(undefined);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setError(t("home.context.saveFailed"));
      return false;
    }
    return true;
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
    source: ComposerSource["source"],
  ): ComposerContextPickerConfig => ({
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
        source === "figma"
          ? `${encodeURIComponent(reference.figmaUrl ?? reference.url ?? "")}:${encodeURIComponent(reference.id)}`
          : reference.id,
      ),
    ...(source === "figma"
      ? {
          link: {
            placeholder: t("home.context.figmaUrl"),
            submitLabel: t("home.context.browse"),
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
            id:
              source === "figma"
                ? `${encodeURIComponent(item.url ?? url ?? "")}:${encodeURIComponent(item.id)}`
                : item.id,
          })),
        };
      } catch (error) {
        throw new Error(
          actionErrorMessage(error) ?? t("home.context.loadFailed"),
        );
      }
    },
    onSelect: (item, request) => {
      const reference: ComposerSource = {
        source,
        id:
          source === "figma"
            ? decodeURIComponent(item.id.slice(item.id.lastIndexOf(":") + 1))
            : item.id,
        title: item.title,
        ...(item.url ? { url: item.url } : {}),
        ...(source === "figma"
          ? {
              figmaUrl: item.url ?? request.url,
              nodeId: decodeURIComponent(
                item.id.slice(item.id.lastIndexOf(":") + 1),
              ),
            }
          : {}),
      };
      return save({
        ...selection,
        references: [
          ...selection.references.filter(
            (value) =>
              composerSourceKey(value) !== composerSourceKey(reference),
          ),
          reference,
        ],
      });
    },
  });
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
                  onSelect: () => save({ ...selection, designSystemId: null }),
                }
              : undefined,
            onSelect: (item) => save({ ...selection, designSystemId: item.id }),
          },
        },
        {
          id: "figma",
          label: t("home.context.menu.figma"),
          icon: <IconComponents size={16} />,
          picker: referencePicker("figma"),
        },
        {
          id: "design",
          label: t("home.context.menu.design"),
          icon: <IconLink size={16} />,
          picker: referencePicker("design"),
        },
        {
          id: "slides",
          label: t("home.context.menu.deck"),
          icon: <IconLink size={16} />,
          picker: referencePicker("slides"),
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
