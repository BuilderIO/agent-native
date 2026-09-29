import {
  actionErrorMessage,
  callAction,
  useChangeVersions,
  useSession,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import {
  composerSourceListSchema,
  composerSourceReferenceSchema,
  type ComposerSourceRequest,
} from "@agent-native/core/shared";
import {
  snapshotComposerContextItems,
  readAssistantChatComposerContextDraft,
  writeAssistantChatComposerContextDraft,
  useAgentKitCapabilities,
  useAgentKitIntegrationMenu,
  type ComposerContextSnapshot,
  type AgentChatContextItem,
  type ComposerContextMenuItem,
  type ComposerContextPickerConfig,
  type ComposerContextPickerItem,
  type ComposerContextPickerRequest,
} from "@agent-native/toolkit/app/chat/composer/index";
import { parseFigmaFileKey } from "@shared/figma-url";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { DesignThumbnail } from "@/components/design/DesignThumbnail";
import type {
  PromptDesignSystemOption,
  PromptTemplateOption,
} from "@/components/editor/PromptDialog";
import { useDesignSystemWorkflows } from "@/hooks/use-design-system-workflows";
import {
  SYSTEM_CONTEXT_KEY,
  TEMPLATE_CONTEXT_KEY,
} from "@/lib/composer-context";

type SourceItem = { id: string; title: string; url?: string };
type Source = "design" | "slides" | "figma" | "website" | "integration";
type BrowseSource = Exclude<Source, "website" | "integration">;
type Reference = SourceItem & { source: Source; figmaUrl?: string };

function referenceKey(reference: Reference) {
  const scope =
    reference.source === "figma"
      ? (parseFigmaFileKey(reference.figmaUrl) ?? reference.figmaUrl)
      : reference.source === "website"
        ? reference.url
        : "";
  return `design-home-reference:${reference.source}:${scope ?? ""}:${reference.id}`;
}

export function useHomePromptContext({
  systems,
  systemId: selectedSystemId,
  onSystemChange,
  templates,
  templateId,
  onTemplateChange,
  systemsLoading,
  systemsError,
  retrySystems,
  active = true,
  scopeKey,
  draftScope,
}: {
  systems: PromptDesignSystemOption[];
  systemId: string | null | undefined;
  onSystemChange: (id: string | null) => void;
  templates: PromptTemplateOption[];
  templateId: string | null;
  onTemplateChange: (id: string | null) => void;
  systemsLoading?: boolean;
  systemsError?: unknown;
  retrySystems?: () => void;
  active?: boolean;
  scopeKey?: string;
  draftScope?: string;
}) {
  const t = useT();
  const formatters = useFormatters();
  const capabilities = useAgentKitCapabilities();
  const systemsEnabled = useDesignSystemWorkflows();
  const systemId = systemsEnabled ? selectedSystemId : null;
  const [items, setItems] = useState<AgentChatContextItem[]>([]);
  const { session } = useSession();
  const identity = JSON.stringify([
    session?.authUserId,
    session?.email ?? "anonymous",
    session?.orgId ?? "none",
    scopeKey ?? "home",
  ]);
  const activeRef = useRef(active);
  activeRef.current = active;
  const refreshKey = useChangeVersions(["action", "designs", "files", "decks"]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const previousIdentity = useRef(identity);
  const loadFailed = t("homeContext.loadFailed");
  const [systemState, setSystemState] = useState<{
    id: string;
    item: AgentChatContextItem;
  }>();
  const [systemRevision, setSystemRevision] = useState(0);
  const [draftHydrated, setDraftHydrated] = useState(!draftScope);
  const [draftError, setDraftError] = useState<"read" | "write">();
  const [draftRetry, setDraftRetry] = useState(0);
  const currentSystem = useRef(systemState);
  currentSystem.current = systemState;
  const submissionReceipts = useRef(
    new WeakMap<
      ComposerContextSnapshot,
      {
        identity: string;
        references: Map<string, number>;
        systemItem?: AgentChatContextItem;
      }
    >(),
  );
  const requests = useRef(
    new Map<string, { reference: Reference; revision: number }>(),
  );
  const requestRevision = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    if (previousIdentity.current === identity) return;
    previousIdentity.current = identity;
    requests.current.clear();
    ++requestRevision.current;
    setItems([]);
    setSystemState(undefined);
    onSystemChange(null);
    onTemplateChange(null);
  }, [identity, onSystemChange, onTemplateChange]);
  useEffect(() => {
    const pendingRequests = requests.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingRequests.clear();
    };
  }, []);
  const attach = useCallback(
    (reference: Reference) => {
      const requestIdentity = identity;
      const key = referenceKey(reference);
      const revision = ++requestRevision.current;
      requests.current.set(key, { reference, revision });
      setItems((current) => [
        ...current.filter((item) => item.key !== key),
        { key, title: reference.title, context: "", status: "pending" },
      ]);
      const params: ComposerSourceRequest = {
        source: reference.source,
        operation: "read",
        ...(reference.source === "website"
          ? { url: reference.url }
          : { id: reference.id }),
        page: 1,
        ...(reference.figmaUrl
          ? { figmaUrl: reference.figmaUrl, nodeId: reference.id }
          : {}),
      };
      void callAction("read-composer-source", params, { method: "GET" })
        .then((data) => {
          const result = composerSourceReferenceSchema.parse(data);
          if (!result.context.trim()) throw new Error(loadFailed);
          if (
            !mounted.current ||
            identityRef.current !== requestIdentity ||
            requests.current.get(key)?.revision !== revision
          )
            return;
          setItems((current) =>
            current.map((item) =>
              item.key === key
                ? {
                    key,
                    title: result.title,
                    context: result.context,
                    status: "ready",
                  }
                : item,
            ),
          );
        })
        .catch((error: unknown) => {
          if (
            !mounted.current ||
            identityRef.current !== requestIdentity ||
            requests.current.get(key)?.revision !== revision
          )
            return;
          setItems((current) =>
            current.map((item) =>
              item.key === key
                ? {
                    ...item,
                    status: "error",
                    statusMessage: actionErrorMessage(error) ?? loadFailed,
                  }
                : item,
            ),
          );
        });
    },
    [loadFailed, identity],
  );
  const attachBatch = (references: readonly Reference[]) => {
    if (!activeRef.current || identityRef.current !== identity)
      throw new Error(loadFailed);
    if (
      references.some(
        (reference) =>
          reference.source === "figma" &&
          !parseFigmaFileKey(reference.figmaUrl),
      )
    )
      throw new Error(t("homeContext.invalidFigmaUrl"));
    const batch = new Map(
      references.map((reference) => [referenceKey(reference), reference]),
    );
    if (new Set([...requests.current.keys(), ...batch.keys()]).size > 20)
      throw new Error(t("homeContext.tooMany"));
    for (const reference of batch.values()) attach(reference);
  };
  useEffect(() => {
    if (!draftScope) return;
    setDraftHydrated(false);
    try {
      const draft = readAssistantChatComposerContextDraft(draftScope);
      requests.current.clear();
      setItems([]);
      onSystemChange(draft?.designSystemId ?? null);
      for (const reference of draft?.references ?? []) attach(reference);
      setDraftError(undefined);
      setDraftHydrated(true);
    } catch {
      setDraftError("read");
    }
  }, [draftScope, draftRetry, attach, onSystemChange]);
  const saveDraft = useCallback(() => {
    if (!draftScope) return;
    try {
      writeAssistantChatComposerContextDraft(draftScope, {
        designSystemId: systemId ?? null,
        references: [...requests.current.values()].map(
          ({ reference }) => reference,
        ),
      });
      setDraftError(undefined);
    } catch {
      setDraftError("write");
    }
  }, [draftScope, systemId]);
  useEffect(() => {
    if (draftHydrated) saveDraft();
  }, [draftHydrated, items, saveDraft]);
  const systemTitle =
    systems.find((system) => system.id === systemId)?.title ??
    t("promptDialog.designSystem");
  useEffect(() => {
    if (!systemId) {
      setSystemState(undefined);
      return;
    }
    let cancelled = false;
    const setSystemItem = (item: AgentChatContextItem) =>
      setSystemState({ id: systemId, item });
    setSystemItem({
      key: SYSTEM_CONTEXT_KEY,
      title: systemTitle,
      context: "",
      status: "pending",
    });
    void callAction("get-design-system", { id: systemId }, { method: "GET" })
      .then((data) => {
        const result = data as { agentContext?: string };
        if (!result.agentContext?.trim()) throw new Error(loadFailed);
        if (!cancelled && identityRef.current === identity)
          setSystemItem({
            key: SYSTEM_CONTEXT_KEY,
            title: systemTitle,
            context: result.agentContext,
            status: "ready",
          });
      })
      .catch((error: unknown) => {
        if (!cancelled && identityRef.current === identity)
          setSystemItem({
            key: SYSTEM_CONTEXT_KEY,
            title: systemTitle,
            context: "",
            status: "error",
            statusMessage: actionErrorMessage(error) ?? loadFailed,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [systemId, systemTitle, systemRevision, loadFailed, identity]);
  const template = templates.find((item) => item.id === templateId);
  const contextItems = useMemo(
    () =>
      previousIdentity.current !== identity
        ? []
        : [
            ...(draftScope && (!draftHydrated || draftError)
              ? [
                  {
                    key: "design-context-draft",
                    title: t("homeContext.design"),
                    context: "",
                    status: draftError
                      ? ("error" as const)
                      : ("pending" as const),
                    ...(draftError ? { statusMessage: loadFailed } : {}),
                  },
                ]
              : []),
            ...(systemId
              ? [
                  systemState?.id === systemId
                    ? systemState.item
                    : {
                        key: SYSTEM_CONTEXT_KEY,
                        title: systemTitle,
                        context: "",
                        status: "pending" as const,
                      },
                ]
              : []),
            ...(template
              ? [
                  {
                    key: TEMPLATE_CONTEXT_KEY,
                    title: template.title,
                    context: "",
                    status: "ready" as const,
                  },
                ]
              : []),
            ...items,
          ],
    [
      items,
      systemId,
      systemState,
      systemTitle,
      template,
      identity,
      draftScope,
      draftHydrated,
      draftError,
      loadFailed,
      t,
    ],
  );
  const referencePicker = (
    source: BrowseSource,
  ): Extract<ComposerContextPickerConfig, { load: unknown }> => {
    const toReference = (
      item: ComposerContextPickerItem,
      request: ComposerContextPickerRequest,
    ): Reference => ({
      title: item.title,
      ...(item.url ? { url: item.url } : {}),
      id:
        source === "figma"
          ? decodeURIComponent(item.id.slice(item.id.lastIndexOf(":") + 1))
          : item.id,
      source,
      ...(source === "figma" ? { figmaUrl: item.url ?? request.url } : {}),
    });
    return {
      scopeKey: identity,
      refreshKey,
      presentation: {
        type: "dialog",
        mode: "multiple",
        ...(source === "design" ? { layout: "gallery" as const } : {}),
        onAttach: (
          items: readonly ComposerContextPickerItem[],
          request: ComposerContextPickerRequest,
        ) => attachBatch(items.map((item) => toReference(item, request))),
      },
      searchPlaceholder: t(
        source === "figma"
          ? "homeContext.searchFrames"
          : source === "slides"
            ? "homeContext.searchPresentations"
            : "homeContext.searchDesigns",
      ),
      emptyMessage: t("homeContext.empty"),
      selectedIds: [...requests.current.values()]
        .filter(({ reference }) => reference.source === source)
        .map(({ reference }) =>
          source === "figma"
            ? `${encodeURIComponent(parseFigmaFileKey(reference.figmaUrl) ?? reference.figmaUrl ?? "")}:${encodeURIComponent(reference.id)}`
            : reference.id,
        ),
      ...(source === "figma"
        ? {
            link: {
              label: t("homeContext.figmaUrlLabel"),
              placeholder: t("homeContext.figmaUrl"),
              submitLabel: t("homeContext.browse"),
              validate: (url: string) =>
                url.trim().length <= 2048 && parseFigmaFileKey(url)
                  ? undefined
                  : t("homeContext.invalidFigmaUrl"),
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
            throw new Error(loadFailed);
          return {
            ...result.data,
            items: result.data.items.map((item) => ({
              ...item,
              ...(source === "figma" ? { url: item.url ?? url } : {}),
              id:
                source === "figma"
                  ? `${encodeURIComponent(parseFigmaFileKey(item.url ?? url) ?? item.url ?? url ?? "")}:${encodeURIComponent(item.id)}`
                  : item.id,
            })),
          };
        } catch (error) {
          throw new Error(actionErrorMessage(error) ?? loadFailed);
        }
      },
    };
  };
  const integrationMenu = useAgentKitIntegrationMenu({
    capabilities,
    scopeKey: identity,
    onSelect: (integration) => {
      attachBatch([
        {
          id: integration.id,
          title: integration.label,
          source: "integration",
        },
      ]);
    },
  });
  const menuItems: ComposerContextMenuItem[] = [
    {
      id: "design",
      label: t("homeContext.design"),
      searchPlaceholder: t("homeContext.searchDesign"),
      children: [
        {
          id: "design-reference",
          label: t("homeContext.referenceDesign"),
          intent: "add-context",
          picker: {
            ...referencePicker("design"),
            load: async ({ search, page, signal }) => {
              const result = await callAction<{
                designs: Array<{
                  id: string;
                  title: string;
                  description?: string | null;
                  previewHtml?: string | null;
                  updatedAt: string;
                }>;
                hasMore: boolean;
              }>(
                "list-designs",
                { includePreview: "true", pageSize: 12, search, page },
                { method: "GET", signal },
              );
              return {
                hasMore: result.hasMore,
                items: result.designs.map((design) => ({
                  id: design.id,
                  title: design.title,
                  description: design.description,
                  preview: (
                    <DesignThumbnail
                      html={design.previewHtml ?? null}
                      className="h-full w-full"
                    />
                  ),
                  metadata: (
                    <time dateTime={design.updatedAt}>
                      {formatters.formatDate(design.updatedAt, {
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
                label: t("homeContext.useDesignSystem"),
                picker: {
                  presentation: { type: "dialog", mode: "single" },
                  scopeKey: identity,
                  searchPlaceholder: t("homeContext.searchSystems"),
                  selectedIds: systemId ? [systemId] : [],
                  items: systems.map((system) => ({
                    id: system.id,
                    title: system.title,
                    disabled: !system.ready,
                  })),
                  loading: systemsLoading,
                  error: systemsError
                    ? (actionErrorMessage(systemsError) ?? loadFailed)
                    : undefined,
                  onRetry: retrySystems,
                  emptyMessage: systems.length
                    ? t("homeContext.empty")
                    : t("homeContext.noSystems"),
                  footerAction: {
                    label: t("homeContext.createSystem"),
                    renderLink: (children) => (
                      <Link to="/design-systems/setup">{children}</Link>
                    ),
                  },
                  clearSelection: systemId
                    ? {
                        label: t("homeContext.none"),
                        onSelect: () => onSystemChange(null),
                      }
                    : undefined,
                  onSelect: (item) => {
                    if (!activeRef.current || identityRef.current !== identity)
                      throw new Error(loadFailed);
                    onSystemChange(item.id);
                  },
                },
              } satisfies ComposerContextMenuItem,
            ]
          : []),
        ...(capabilities.data?.sources.figma.available
          ? [
              {
                id: "figma-reference",
                label: t("homeContext.figmaReference"),
                intent: "add-context" as const,
                picker: referencePicker("figma"),
              } satisfies ComposerContextMenuItem,
            ]
          : []),
        {
          id: "website-reference",
          label: t("homeContext.websiteReference"),
          intent: "add-context",
          picker: {
            scopeKey: identity,
            presentation: { type: "dialog", mode: "url" },
            searchPlaceholder: t("homeContext.websiteUrl"),
            link: {
              label: t("homeContext.websiteUrlLabel"),
              placeholder: t("homeContext.websiteUrl"),
              submitLabel: t("homeContext.websiteReference"),
              validate: (url) =>
                url.trim().length <= 2048 &&
                !new URL(url).username &&
                !new URL(url).password
                  ? undefined
                  : t("homeContext.invalidWebsiteUrl"),
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
  const remove = (key: string) => {
    if (key === "design-context-draft") {
      saveDraft();
      setDraftHydrated(true);
      return;
    }
    if (key === SYSTEM_CONTEXT_KEY) {
      onSystemChange(null);
      return;
    }
    if (key === TEMPLATE_CONTEXT_KEY) {
      onTemplateChange(null);
      return;
    }
    requests.current.delete(key);
    setItems((current) => current.filter((item) => item.key !== key));
  };
  const retry = (key: string) => {
    if (key === "design-context-draft") {
      if (draftError === "read") setDraftRetry((value) => value + 1);
      else saveDraft();
      return;
    }
    if (key === SYSTEM_CONTEXT_KEY) {
      setSystemRevision((value) => value + 1);
      return;
    }
    const request = requests.current.get(key);
    if (request) attach(request.reference);
  };
  const referencesForSubmission = new Map(requests.current);
  const prepareSubmission = async (
    snapshot: ComposerContextSnapshot | undefined,
  ) => {
    const submittedIdentity = identity;
    const submittedSystemId = systemId;
    const submittedSystemItem =
      systemState && systemState.id === submittedSystemId
        ? systemState.item
        : undefined;
    const references = referencesForSubmission;
    const submitted = snapshotComposerContextItems(snapshot);
    if (!submitted) return undefined;
    const refreshed = await Promise.all(
      submitted.map(async (item) => {
        try {
          let context = item.context;
          if (item.key === SYSTEM_CONTEXT_KEY && submittedSystemId) {
            const result = await callAction(
              "get-design-system",
              { id: submittedSystemId },
              { method: "GET" },
            );
            if (!result.agentContext?.trim()) throw new Error(loadFailed);
            context = result.agentContext;
          } else if (item.key !== TEMPLATE_CONTEXT_KEY) {
            const reference = references.get(item.key)?.reference;
            if (!reference) throw new Error(loadFailed);
            const result = await callAction(
              "read-composer-source",
              {
                source: reference.source,
                operation: "read",
                ...(reference.source === "website"
                  ? { url: reference.url }
                  : { id: reference.id }),
                page: 1,
                ...(reference.figmaUrl
                  ? { figmaUrl: reference.figmaUrl, nodeId: reference.id }
                  : {}),
              },
              { method: "GET" },
            );
            if (!("context" in result) || !result.context.trim())
              throw new Error(loadFailed);
            context = result.context;
          }
          if (identityRef.current !== submittedIdentity)
            throw new Error(loadFailed);
          return { ...item, context, status: "ready" as const };
        } catch (error) {
          const message = actionErrorMessage(error) ?? loadFailed;
          if (identityRef.current === submittedIdentity) {
            if (item.key === SYSTEM_CONTEXT_KEY && submittedSystemId)
              setSystemState((state) =>
                state?.id === submittedSystemId &&
                state.item === submittedSystemItem
                  ? {
                      ...state,
                      item: {
                        ...item,
                        context: "",
                        status: "error",
                        statusMessage: message,
                      },
                    }
                  : state,
              );
            else
              setItems((current) =>
                current.map((currentItem) =>
                  currentItem.key === item.key &&
                  requests.current.get(item.key)?.revision ===
                    references.get(item.key)?.revision
                    ? {
                        ...currentItem,
                        context: "",
                        status: "error",
                        statusMessage: message,
                      }
                    : currentItem,
                ),
              );
          }
          throw new Error(message);
        }
      }),
    );
    if (!mounted.current || identityRef.current !== submittedIdentity)
      throw new Error(loadFailed);
    const prepared = snapshotComposerContextItems(refreshed);
    submissionReceipts.current.set(prepared, {
      identity: submittedIdentity,
      references: new Map(
        submitted.flatMap((item) => {
          const request = references.get(item.key);
          return request ? [[item.key, request.revision]] : [];
        }),
      ),
      systemItem: submitted.some((item) => item.key === SYSTEM_CONTEXT_KEY)
        ? submittedSystemItem
        : undefined,
    });
    return prepared;
  };
  const submissionAccepted = (snapshot: ComposerContextSnapshot) => {
    const receipt = submissionReceipts.current.get(snapshot);
    submissionReceipts.current.delete(snapshot);
    if (!mounted.current || receipt?.identity !== identityRef.current) return;
    const removed = new Set<string>();
    for (const [key, revision] of receipt.references) {
      if (requests.current.get(key)?.revision !== revision) continue;
      requests.current.delete(key);
      removed.add(key);
    }
    setItems((current) => current.filter((item) => !removed.has(item.key)));
    if (
      receipt.systemItem &&
      currentSystem.current?.item === receipt.systemItem
    )
      onSystemChange(null);
  };
  return {
    contextItems,
    menuItems: active ? menuItems : [],
    remove,
    retry,
    prepareSubmission,
    submissionAccepted,
    identity,
  };
}
