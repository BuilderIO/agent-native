import { formatDesignSystemReference } from "@agent-native/core/client/agent-chat";
import {
  actionErrorMessage,
  callAction,
  useActionQuery,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  designSystemReferenceSchema,
  type DesignSystemReference,
} from "@agent-native/core/shared/design-system-authoring";
import type {
  AgentChatContextItem,
  ComposerContextMenuItem,
  ComposerContextPageControls,
} from "@agent-native/toolkit/composer";
import {
  IconBrandFigma,
  IconLayout,
  IconPalette,
  IconPresentation,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  persistComposerContext,
  readSavedComposerReferences,
  referenceFromContextItem,
  sourceContextKey,
  SYSTEM_CONTEXT_KEY,
  type ComposerSourceReference,
} from "@/lib/composer-context";
import {
  isDesignSystemUsableForGeneration,
  parseDesignSystemData,
} from "@/lib/design-system-data";

import { DesignContextPage } from "./DesignContextPicker";

export type ContextPickerView =
  | "systems"
  | "design"
  | "slides"
  | "figma"
  | "create"
  | "inspect"
  | null;
export interface ComposerSourceResult {
  id: string;
  title: string;
  context: string;
  url?: string;
}

export interface DesignPromptContextController {
  contextItems: AgentChatContextItem[];
  contextMenuItems: ComposerContextMenuItem[];
  onRemoveContextItem: (key: string) => void;
  onInspectContextItem: (key: string) => void;
  onRetryContextItem: (key: string) => Promise<void>;
  view: ContextPickerView;
  setView: (view: ContextPickerView) => void;
  inspected: AgentChatContextItem | null;
  selectedSystemId?: string | null;
  attach: (
    source: ComposerSourceReference,
    result: ComposerSourceResult,
  ) => void;
  selectSource: (source: ComposerSourceReference) => void;
  changeSystem: (id: string | null, reference?: DesignSystemReference) => void;
  draftId: string;
  systemReference: DesignSystemReference | null;
  createSystem: (controls: ComposerContextPageControls) => void;
  resumePicker: () => void;
  flush: () => Promise<void>;
}

export function useDesignPromptContext({
  designId,
  localScopeKey = "",
  originScopeKey,
  selectedSystemId: selectedSystemProp,
  onSystemChange,
  enabled = true,
}: {
  designId?: string;
  localScopeKey?: string;
  originScopeKey?: string;
  selectedSystemId?: string | null;
  onSystemChange?: (id: string | null) => void | Promise<void>;
  enabled?: boolean;
}): DesignPromptContextController {
  const scopeKey = designId ? `design:${designId}` : `local:${localScopeKey}`;
  const { session } = useSession();
  const contextId = `${session?.email ?? "guest"}:${session?.orgId ?? "personal"}:${scopeKey}`;
  const draftId = originScopeKey ? `${contextId}:${originScopeKey}` : contextId;
  const referenceStorageKey = `design-system-composer:${contextId}`;
  const [systemReference, setSystemReference] =
    useState<DesignSystemReference | null>(null);
  const selectedSystemId = systemReference?.id ?? selectedSystemProp;
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const queryClient = useQueryClient();
  const [items, setItems] = useState<AgentChatContextItem[]>([]);
  const localReferences = useRef(new Map<string, ComposerSourceReference[]>());
  const localHydratedKey = useRef<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const itemsScope = useRef(scopeKey);
  const [systemItem, setSystemItem] = useState<AgentChatContextItem | null>(
    null,
  );
  const systemItemId = useRef<string | null>(null);
  const [view, setView] = useState<ContextPickerView>(null);
  const [inspected, setInspected] = useState<AgentChatContextItem | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [systemSaveError, setSystemSaveError] = useState<string | null>(null);
  const [systemSaving, setSystemSaving] = useState(false);
  const systemSaveRef = useRef<Promise<void>>(Promise.resolve());
  const systemChoiceRef = useRef(selectedSystemId);
  const systemReferenceChoiceRef = useRef<DesignSystemReference | undefined>(
    undefined,
  );
  const selectedSystemRef = useRef(selectedSystemId);
  selectedSystemRef.current = selectedSystemId;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const sourceRevision = useRef(0);
  const sourceSelections = useRef(new Map<string, symbol>());
  const resumeRef = useRef<(() => void) | null>(null);
  const pickerSearches = useRef<Record<string, string>>({});
  const controllerRef = useRef<DesignPromptContextController | null>(null);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const saveRef = useRef<Promise<void>>(Promise.resolve());
  const { data: design, error: designError } = useActionQuery<{
    data: string | null;
  }>("get-design", { id: designId }, { enabled: Boolean(designId) && enabled });
  useEffect(() => {
    try {
      const savedReference =
        designId && design?.data
          ? JSON.parse(design.data).composerDesignSystemRef
          : JSON.parse(localStorage.getItem(referenceStorageKey) ?? "null");
      setSystemReference(
        savedReference
          ? designSystemReferenceSchema.parse(savedReference)
          : null,
      );
    } catch (cause) {
      setSystemSaveError(actionErrorMessage(cause) ?? String(cause));
    }
  }, [referenceStorageKey, designId, design?.data]);
  const errorText = useCallback(
    (error: unknown) =>
      actionErrorMessage(error) ?? tRef.current("composerContext.unavailable"),
    [],
  );
  const projectSaved = useMemo(() => {
    try {
      return {
        signature: JSON.stringify(readSavedComposerReferences(design?.data)),
        error: null,
      };
    } catch (error) {
      return { signature: "[]", error: errorText(error) };
    }
  }, [design?.data, errorText]);
  const localSaved = useMemo(() => {
    if (designId) return { references: [], error: null };
    try {
      const raw = localStorage.getItem(`${referenceStorageKey}:sources`);
      if (raw && raw.length > 64_000)
        throw new Error("Draft context exceeds storage limit");
      return { references: readSavedComposerReferences(raw), error: null };
    } catch (cause) {
      return { references: [], error: errorText(cause) };
    }
  }, [designId, referenceStorageKey, errorText]);
  const saved = designId
    ? projectSaved
    : {
        signature: JSON.stringify(
          localReferences.current.get(draftId) ?? localSaved.references,
        ),
        error: localSaved.error,
      };
  const sourceKey = !designId
    ? `${scopeKey}:${saved.signature}`
    : enabled && design
      ? `${scopeKey}:${saved.signature}:${saved.error ?? ""}`
      : null;

  const resolveSource = useCallback(
    async (reference: ComposerSourceReference) => {
      const result = (await callAction(
        "read-composer-source",
        {
          source: reference.source,
          operation: "read",
          ...(reference.source === "figma"
            ? { figmaUrl: reference.url, nodeId: reference.id }
            : { id: reference.id }),
        },
        { method: "GET" },
      )) as ComposerSourceResult;
      if (!result.context?.trim())
        throw new Error("Source returned no context");
      return {
        key: sourceContextKey(reference),
        title: result.title,
        context: result.context,
        status: "ready" as const,
      };
    },
    [],
  );

  useEffect(() => {
    const revision = ++sourceRevision.current;
    if (!sourceKey || (!designId && localHydratedKey.current === sourceKey))
      return;
    localHydratedKey.current = designId ? null : sourceKey;
    try {
      const refs = JSON.parse(saved.signature) as ComposerSourceReference[];
      setHydratedKey(sourceKey);
      itemsScope.current = scopeKey;
      setItems(
        refs.map((ref) => ({
          key: sourceContextKey(ref),
          title: ref.title,
          context: "",
          status: "pending",
        })),
      );
      void Promise.all(
        refs.map(async (ref) => {
          try {
            return await resolveSource(ref);
          } catch (error) {
            return {
              key: sourceContextKey(ref),
              title: ref.title,
              context: "",
              status: "error" as const,
              statusMessage: errorText(error),
            };
          }
        }),
      ).then((resolved) => {
        if (revision === sourceRevision.current) setItems(resolved);
      });
    } catch (error) {
      setSaveError(errorText(error));
    }
    return () => {
      if (sourceRevision.current === revision)
        sourceRevision.current = revision + 1;
    };
  }, [
    designId,
    scopeKey,
    sourceKey,
    saved.signature,
    errorText,
    resolveSource,
  ]);

  useEffect(() => {
    setSaveError(null);
    setSystemSaveError(null);
    setSystemSaving(false);
    saveRef.current = Promise.resolve();
    systemSaveRef.current = Promise.resolve();
    const selections = sourceSelections.current;
    selections.clear();
    resumeRef.current = null;
    pickerSearches.current = {};
    setView(null);
    return () => {
      selections.clear();
      resumeRef.current = null;
    };
  }, [scopeKey]);

  const resolveSystem = useCallback(
    async (id: string) => {
      systemItemId.current = id;
      setSystemItem({
        key: SYSTEM_CONTEXT_KEY,
        title: tRef.current("promptDialog.designSystem"),
        context: "",
        status: "pending",
      });
      try {
        const result = (await callAction(
          "get-design-system",
          { id, ...(systemReference?.id === id ? systemReference : {}) },
          { method: "GET" },
        )) as {
          title: string;
          data: string;
          agentContext: string;
          builder?: {
            warning?: string;
            docCount: number;
            tokenValues: Record<string, string>;
          } | null;
        };
        const data = parseDesignSystemData(result.data);
        const hasLocalContent =
          data &&
          [
            data.colors,
            data.typography,
            data.spacing,
            data.borders,
            data.tokens,
            data.notes,
          ].some((value) =>
            typeof value === "string"
              ? Boolean(value.trim())
              : Boolean(
                  value &&
                  typeof value === "object" &&
                  Object.keys(value).length,
                ),
          );
        if (
          !result.agentContext?.trim() ||
          !isDesignSystemUsableForGeneration(result.data) ||
          (!result.builder && !hasLocalContent) ||
          (result.builder &&
            (result.builder.warning ||
              (!result.builder.docCount &&
                !Object.keys(result.builder.tokenValues).length)))
        ) {
          throw new Error("Design system is not ready");
        }
        return {
          key: SYSTEM_CONTEXT_KEY,
          title: result.title,
          context:
            systemReference?.id === id
              ? formatDesignSystemReference(
                  systemReference,
                  result.agentContext,
                )
              : result.agentContext,
          status: "ready" as const,
        };
      } catch (error) {
        return {
          key: SYSTEM_CONTEXT_KEY,
          title: tRef.current("promptDialog.designSystem"),
          context: "",
          status: "error" as const,
          statusMessage: errorText(error),
        };
      }
    },
    [errorText, systemReference],
  );

  useEffect(() => {
    if (!enabled || !selectedSystemId) {
      setSystemItem(null);
      return;
    }
    let cancelled = false;
    void resolveSystem(selectedSystemId).then((item) => {
      if (!cancelled) setSystemItem(item);
    });
    return () => {
      cancelled = true;
    };
  }, [scopeKey, enabled, selectedSystemId, resolveSystem]);

  const save = useCallback(
    (next: AgentChatContextItem[]) => {
      if (scopeRef.current !== scopeKey) return;
      sourceRevision.current++;
      itemsRef.current = next;
      setItems(next);
      if (!designId) {
        const refs = next
          .map(referenceFromContextItem)
          .filter((ref) => ref !== null);
        localReferences.current.set(draftId, refs);
        try {
          const serialized = JSON.stringify({ composerContext: refs });
          if (serialized.length > 64_000)
            throw new Error("Draft context exceeds storage limit");
          localStorage.setItem(`${referenceStorageKey}:sources`, serialized);
          setSaveError(null);
        } catch (cause) {
          setSaveError(errorText(cause));
        }
        const key = `${scopeKey}:${JSON.stringify(refs)}`;
        localHydratedKey.current = key;
        setHydratedKey(key);
        return;
      }
      const pending = saveRef.current
        .catch(() => {})
        .then(async () => {
          await persistComposerContext(designId, next);
          await queryClient.invalidateQueries({
            queryKey: ["action", "get-design", { id: designId }],
          });
        });
      saveRef.current = pending;
      void pending.then(
        () => {
          if (scopeRef.current === scopeKey) setSaveError(null);
        },
        (error) => {
          if (scopeRef.current === scopeKey) setSaveError(errorText(error));
        },
      );
    },
    [designId, scopeKey, draftId, referenceStorageKey, errorText, queryClient],
  );

  const attach = useCallback(
    (source: ComposerSourceReference, result: ComposerSourceResult) => {
      if (!result.context?.trim())
        throw new Error("Source returned no context");
      const key = sourceContextKey(source);
      save([
        ...itemsRef.current.filter((item) => {
          const existing = referenceFromContextItem(item);
          return (
            !existing ||
            existing.source !== source.source ||
            existing.id !== source.id ||
            (source.source === "figma" && existing.url !== source.url)
          );
        }),
        { key, title: result.title, context: result.context, status: "ready" },
      ]);
    },
    [save],
  );

  const selectSource = useCallback(
    (source: ComposerSourceReference) => {
      if (scopeRef.current !== scopeKey) return;
      const key = sourceContextKey(source);
      const selection = Symbol(key);
      sourceSelections.current.set(key, selection);
      save([
        ...itemsRef.current.filter((item) => {
          const existing = referenceFromContextItem(item);
          return (
            !existing ||
            existing.source !== source.source ||
            existing.id !== source.id ||
            (source.source === "figma" && existing.url !== source.url)
          );
        }),
        { key, title: source.title, context: "", status: "pending" },
      ]);
      void (async () => {
        let resolved: AgentChatContextItem;
        try {
          resolved = await resolveSource(source);
        } catch (error) {
          resolved = {
            key,
            title: source.title,
            context: "",
            status: "error",
            statusMessage: errorText(error),
          };
        }
        if (
          scopeRef.current !== scopeKey ||
          sourceSelections.current.get(key) !== selection
        )
          return;
        sourceSelections.current.delete(key);
        setItems((current) => {
          const next = current.map((item) =>
            item.key === key ? resolved : item,
          );
          itemsRef.current = next;
          return next;
        });
      })();
    },
    [errorText, resolveSource, save, scopeKey],
  );

  const changeSystem = useCallback(
    (id: string | null, reference?: DesignSystemReference) => {
      systemChoiceRef.current = id;
      systemReferenceChoiceRef.current = reference;
      setSystemSaveError(null);
      setSystemSaving(true);
      const pending = (async () => {
        const next = reference ?? null;
        if (designId) {
          await callAction("update-design", {
            id: designId,
            dataOperations: [
              { op: "set", path: ["composerDesignSystemRef"], value: next },
            ],
          });
        } else {
          localStorage.setItem(referenceStorageKey, JSON.stringify(next));
        }
        setSystemReference(next);
        await onSystemChange?.(
          reference && reference.ownerApp !== "design" ? null : id,
        );
      })();
      systemSaveRef.current = pending;
      void pending.then(
        () => {
          if (
            scopeRef.current === scopeKey &&
            systemSaveRef.current === pending
          )
            setSystemSaving(false);
        },
        (error) => {
          if (
            scopeRef.current === scopeKey &&
            systemSaveRef.current === pending
          ) {
            setSystemSaving(false);
            setSystemSaveError(errorText(error));
          }
        },
      );
    },
    [scopeKey, errorText, onSystemChange, designId, referenceStorageKey],
  );

  const remove = useCallback(
    (key: string) => {
      sourceSelections.current.delete(key);
      if (key === SYSTEM_CONTEXT_KEY) {
        changeSystem(null);
        setSystemItem(null);
      } else save(itemsRef.current.filter((item) => item.key !== key));
    },
    [changeSystem, save],
  );
  const retry = useCallback(
    async (key: string) => {
      if (key === "context-save") {
        save(itemsRef.current);
        return;
      }
      if (key === "context-read") {
        await queryClient.invalidateQueries({
          queryKey: ["action", "get-design", { id: designId }],
        });
        return;
      }
      if (key === "context-system-save") {
        changeSystem(
          systemChoiceRef.current ?? null,
          systemReferenceChoiceRef.current,
        );
        return;
      }
      if (key === SYSTEM_CONTEXT_KEY && selectedSystemId) {
        const resolved = await resolveSystem(selectedSystemId);
        if (
          scopeRef.current === scopeKey &&
          selectedSystemRef.current === selectedSystemId
        )
          setSystemItem(resolved);
        return;
      }
      const ref = referenceFromContextItem({ key });
      if (!ref) return;
      const selection = Symbol(key);
      sourceSelections.current.set(key, selection);
      setItems((current) =>
        current.map((item) =>
          item.key === key ? { ...item, status: "pending" } : item,
        ),
      );
      let resolved: AgentChatContextItem;
      try {
        resolved = await resolveSource(ref);
      } catch (error) {
        resolved = {
          key,
          title: ref.title,
          context: "",
          status: "error",
          statusMessage: errorText(error),
        };
      }
      if (
        scopeRef.current !== scopeKey ||
        sourceSelections.current.get(key) !== selection
      )
        return;
      sourceSelections.current.delete(key);
      setItems((current) =>
        current.map((item) => (item.key === key ? resolved : item)),
      );
    },
    [
      changeSystem,
      designId,
      scopeKey,
      errorText,
      queryClient,
      resolveSource,
      resolveSystem,
      save,
      selectedSystemId,
    ],
  );

  const effectiveSystemItem = selectedSystemId
    ? systemItem && systemItemId.current === selectedSystemId
      ? systemItem
      : {
          key: SYSTEM_CONTEXT_KEY,
          title: t("promptDialog.designSystem"),
          context: "",
          status: "pending" as const,
        }
    : null;
  const sourcePending = Boolean(
    designId &&
    enabled &&
    (!sourceKey || hydratedKey !== sourceKey) &&
    !designError &&
    !saved.error,
  );
  const contextItems = [
    ...(effectiveSystemItem ? [effectiveSystemItem] : []),
    ...(itemsScope.current === scopeKey &&
    (!designId || sourceKey === hydratedKey)
      ? items
      : []),
    ...(sourcePending
      ? [
          {
            key: "context-loading",
            title: t("composerContext.resolving"),
            context: "",
            status: "pending" as const,
          },
        ]
      : []),
    ...(saveError
      ? [
          {
            key: "context-save",
            title: t("composerContext.saveFailed"),
            context: "",
            status: "error" as const,
            statusMessage: saveError,
          },
        ]
      : []),
    ...(designError || saved.error
      ? [
          {
            key: "context-read",
            title: t("composerContext.unavailable"),
            context: "",
            status: "error" as const,
            statusMessage: saved.error ?? errorText(designError),
          },
        ]
      : []),
    ...(systemSaving || systemSaveError
      ? [
          {
            key: "context-system-save",
            title: t(
              systemSaveError
                ? "composerContext.saveFailed"
                : "composerContext.resolving",
            ),
            context: "",
            status: systemSaveError ? ("error" as const) : ("pending" as const),
            statusMessage: systemSaveError ?? undefined,
          },
        ]
      : []),
  ];
  const inspect = (key: string) => {
    setInspected(contextItems.find((item) => item.key === key) ?? null);
    setView("inspect");
  };
  const controller: DesignPromptContextController = {
    contextItems,
    contextMenuItems: [],
    onRemoveContextItem: remove,
    onInspectContextItem: inspect,
    onRetryContextItem: retry,
    view,
    setView,
    inspected,
    selectedSystemId,
    draftId,
    systemReference,
    attach,
    selectSource,
    changeSystem,
    createSystem: (controls) => {
      resumeRef.current = () => {
        setView("systems");
        controls.onResume();
      };
      controls.onClose();
      setView("create");
    },
    resumePicker: () => {
      setView(null);
      const resume = resumeRef.current;
      resumeRef.current = null;
      resume?.();
    },
    flush: async () => {
      await Promise.all([saveRef.current, systemSaveRef.current]);
    },
  };
  controllerRef.current = controller;
  const pickerPage = (page: "systems" | "design" | "slides" | "figma") => ({
    onSelect: () => setView(page),
    onDismiss: () => setView((current) => (current === page ? null : current)),
    render: (controls: ComposerContextPageControls) => (
      <DesignContextPage
        key={page}
        page={page}
        controls={controls}
        controller={controllerRef.current!}
        initialSearch={pickerSearches.current[page] ?? ""}
        onSearchChange={(value) => {
          pickerSearches.current[page] = value;
        }}
      />
    ),
  });
  controller.contextMenuItems = [
    {
      id: "design",
      label: t("composerContext.design"),
      icon: <IconPalette />,
      disabled: sourcePending || Boolean(saved.error || designError),
      children: [
        {
          id: "system",
          label: t("composerContext.useSystem"),
          icon: <IconPalette />,
          ...pickerPage("systems"),
        },
        {
          id: "figma",
          label: t("composerContext.attachFigma"),
          icon: <IconBrandFigma />,
          ...pickerPage("figma"),
        },
        {
          id: "design-reference",
          label: t("composerContext.referenceDesign"),
          icon: <IconLayout />,
          ...pickerPage("design"),
        },
      ],
    },
    {
      id: "slides",
      label: t("composerContext.slides"),
      icon: <IconPresentation />,
      disabled: sourcePending || Boolean(saved.error || designError),
      children: [
        {
          id: "slides-reference",
          label: t("composerContext.referenceDeck"),
          icon: <IconPresentation />,
          ...pickerPage("slides"),
        },
      ],
    },
  ];
  return controller;
}
