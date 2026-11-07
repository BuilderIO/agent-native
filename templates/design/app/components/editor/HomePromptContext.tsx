import {
  actionErrorMessage,
  callAction,
  useChangeVersions,
  useSession,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { mcpIntegrationLogo } from "@agent-native/core/client/resources/mcp-integration-logos";
import {
  composerSourceReferenceSchema,
  type ComposerSourceRequest,
} from "@agent-native/core/shared";
import {
  snapshotComposerContextItems,
  readAssistantChatComposerContextDraft,
  writeAssistantChatComposerContextDraft,
  useAgentKitCapabilities,
  type ComposerContextSnapshot,
  type AgentChatContextItem,
  type ComposerContextMenuItem,
  type ComposerContextPickerConfig,
  type ComposerContextPickerItem,
} from "@agent-native/toolkit/app/chat/composer/index";
import { parseFigmaFileKey, parseFigmaNodeId } from "@shared/figma-url";
import { IconLayoutGrid, IconPalette, IconWorld } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { z } from "zod";

import { DesignThumbnail } from "@/components/design/DesignThumbnail";
import {
  FigmaAttachDialog,
  type FigmaLinkTree,
  type FigmaPageOption,
} from "@/components/editor/FigmaAttachDialog";
import type {
  PromptDesignSystemOption,
  PromptTemplateOption,
} from "@/components/editor/PromptDialog";
import { useDesignSystemWorkflows } from "@/hooks/use-design-system-workflows";
import {
  SYSTEM_CONTEXT_KEY,
  TEMPLATE_CONTEXT_KEY,
} from "@/lib/composer-context";
import {
  figFileReferenceKey,
  figmaReferenceContext,
  isFigmaReferenceKey,
  readFigmaClipboardSource,
  readFigmaReference,
  type FigmaReference,
  type FigmaReferenceSource,
} from "@/lib/figma-attachment";

type SourceItem = { id: string; title: string; url?: string | undefined };
const sourceSchema = z.enum([
  "design",
  "slides",
  "figma",
  "website",
  "integration",
]);
type Source = z.infer<typeof sourceSchema>;
type Reference = SourceItem & { source: Source; figmaUrl?: string | undefined };

function referenceKey(reference: Reference) {
  const scope =
    reference.source === "figma"
      ? (parseFigmaFileKey(reference.figmaUrl) ?? reference.figmaUrl)
      : reference.source === "website"
        ? reference.url
        : "";
  return `design-home-reference:${reference.source}:${scope ?? ""}:${reference.id}`;
}

/** The frame kinds `read-composer-source` reads as a single reference. */
const FIGMA_ATTACHABLE_FRAME_TYPES = new Set([
  "FRAME",
  "COMPONENT",
  "COMPONENT_SET",
]);

const figmaLinkSchema = z.union([
  z.object({
    mode: z.literal("overview"),
    fileKey: z.string(),
    pages: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        // Null when a large file listed its pages without their frames.
        frames: z
          .array(
            z.object({
              id: z.string(),
              name: z.string().nullish(),
              type: z.string().nullish(),
            }),
          )
          .nullable(),
      }),
    ),
  }),
  z.object({
    mode: z.literal("node"),
    fileKey: z.string(),
    nodeId: z.string(),
    summary: z.object({ name: z.string(), type: z.string() }),
  }),
]);
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
        figmaKeys: string[];
        systemItem?: AgentChatContextItem;
      }
    >(),
  );
  const requests = useRef(
    new Map<string, { reference: Reference; revision: number }>(),
  );
  const requestRevision = useRef(0);
  const figmaSources = useRef(
    new Map<string, { source: FigmaReferenceSource; revision: number }>(),
  );
  const [figmaDialogOpen, setFigmaDialogOpen] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    if (previousIdentity.current === identity) return;
    previousIdentity.current = identity;
    requests.current.clear();
    figmaSources.current.clear();
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
  const figmaTitle = (
    source: FigmaReferenceSource,
    reference?: FigmaReference,
  ) => {
    if (source.kind === "file") return source.file.name;
    const first = reference?.frames[0]?.name;
    if (!reference || !first) return t("homeContext.figmaSelection");
    const more = reference.frames.length - 1;
    return more > 0
      ? t("homeContext.figmaReferenceMore", { name: first, count: more })
      : first;
  };
  /** Decodes the source into reference context; nothing is saved. */
  const resolveFigma = (key: string, source: FigmaReferenceSource) => {
    const requestIdentity = identity;
    const revision = ++requestRevision.current;
    figmaSources.current.set(key, { source, revision });
    const current = () =>
      mounted.current &&
      identityRef.current === requestIdentity &&
      figmaSources.current.get(key)?.revision === revision;
    setItems((items) => [
      ...items.filter((item) => item.key !== key),
      { key, title: figmaTitle(source), context: "", status: "pending" },
    ]);
    readFigmaReference(source, t("homeContext.figmaReferenceEmpty"))
      .then((reference) => {
        if (!current()) return;
        const title = figmaTitle(source, reference);
        setItems((items) =>
          items.map((item) =>
            item.key === key
              ? {
                  key,
                  title,
                  context: figmaReferenceContext(reference, `"${title}"`),
                  status: "ready",
                }
              : item,
          ),
        );
      })
      .catch((error: unknown) => {
        if (!current()) return;
        setItems((items) =>
          items.map((item) =>
            item.key === key
              ? {
                  ...item,
                  status: "error",
                  statusMessage:
                    actionErrorMessage(error) ??
                    (error instanceof Error ? error.message : loadFailed),
                }
              : item,
          ),
        );
      });
  };
  const attachFigma = (key: string, source: FigmaReferenceSource) => {
    if (!activeRef.current || identityRef.current !== identity)
      throw new Error(loadFailed);
    if (
      !figmaSources.current.has(key) &&
      requests.current.size + figmaSources.current.size >= 20
    )
      throw new Error(t("homeContext.tooMany"));
    resolveFigma(key, source);
  };
  const reportAttachError = (error: unknown) =>
    toast.error(actionErrorMessage(error) ?? loadFailed);
  const onPasteContext = (clipboard: DataTransfer) => {
    if (!activeRef.current) return false;
    const pasted = readFigmaClipboardSource(clipboard);
    if (!pasted) return false;
    try {
      attachFigma(pasted.key, pasted.source);
    } catch (error) {
      reportAttachError(error);
    }
    return true;
  };
  useEffect(() => {
    if (!draftScope) return;
    setDraftHydrated(false);
    try {
      const draft = readAssistantChatComposerContextDraft(draftScope);
      const references =
        draft?.references.map((reference) => ({
          ...reference,
          source: sourceSchema.parse(reference.source),
        })) ?? [];
      requests.current.clear();
      setItems([]);
      onSystemChange(draft?.designSystemId ?? null);
      for (const reference of references) attach(reference);
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
  const designListSchema = z.object({
    designs: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().nullable().optional(),
        previewHtml: z.string().nullable().optional(),
        updatedAt: z.string(),
      }),
    ),
    hasMore: z.boolean(),
  });
  const designPicker: ComposerContextPickerConfig = {
    scopeKey: identity,
    refreshKey,
    presentation: {
      type: "dialog",
      mode: "multiple",
      layout: "gallery",
      onAttach: (items: readonly ComposerContextPickerItem[]) =>
        attachBatch(
          items.map((item) => ({
            title: item.title,
            ...(item.url ? { url: item.url } : {}),
            id: item.id,
            source: "design" as const,
          })),
        ),
    },
    searchPlaceholder: t("homeContext.searchDesigns"),
    emptyMessage: t("homeContext.empty"),
    selectedIds: [...requests.current.values()]
      .filter(({ reference }) => reference.source === "design")
      .map(({ reference }) => reference.id),
    load: async ({ search, page, signal }) => {
      let result: z.infer<typeof designListSchema>;
      try {
        const parsed = designListSchema.safeParse(
          await callAction(
            "list-designs",
            { includePreview: "true", pageSize: 12, search, page },
            { method: "GET", signal },
          ),
        );
        if (!parsed.success) throw new Error(loadFailed);
        result = parsed.data;
      } catch (error) {
        throw new Error(actionErrorMessage(error) ?? loadFailed);
      }
      return {
        hasMore: result.hasMore,
        items: result.designs.map((design) => ({
          id: design.id,
          title: design.title,
          ...(design.description !== undefined
            ? { description: design.description }
            : {}),
          preview: (
            <DesignThumbnail
              html={design.previewHtml ?? null}
              designId={design.id}
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
  };
  const menuItems: ComposerContextMenuItem[] = [
    {
      id: "figma-reference",
      order: 10,
      referenceType: "figma",
      icon: (
        <img
          src={mcpIntegrationLogo("figma")}
          className="size-4 object-contain"
          alt=""
        />
      ),
      label: t("homeContext.figmaReference"),
      intent: "add-context",
      opensDialog: true,
      onSelect: () => setFigmaDialogOpen(true),
    },
    {
      id: "design-reference",
      referenceType: "design",
      order: 20,
      icon: <IconPalette />,
      label: t("homeContext.referenceDesign"),
      intent: "add-context",
      picker: designPicker,
    },
  ];
  if (systemsEnabled)
    menuItems.push({
      id: "system",
      order: 30,
      icon: <IconLayoutGrid />,
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
        ...(systemsLoading !== undefined ? { loading: systemsLoading } : {}),
        ...(systemsError
          ? { error: actionErrorMessage(systemsError) ?? loadFailed }
          : {}),
        ...(retrySystems ? { onRetry: retrySystems } : {}),
        emptyMessage: systems.length
          ? t("homeContext.empty")
          : t("homeContext.noSystems"),
        footerAction: {
          label: t("homeContext.createSystem"),
          renderLink: (children) => (
            <Link to="/design-systems/setup">{children}</Link>
          ),
        },
        ...(systemId
          ? {
              clearSelection: {
                label: t("homeContext.none"),
                onSelect: () => onSystemChange(null),
              },
            }
          : {}),
        onSelect: (item) => {
          if (!activeRef.current || identityRef.current !== identity)
            throw new Error(loadFailed);
          onSystemChange(item.id);
        },
      },
    } satisfies ComposerContextMenuItem);
  menuItems.push({
    id: "website-reference",
    order: 30,
    icon: <IconWorld />,
    label: t("homeContext.websiteReferenceMenu"),
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
        attachBatch([{ ...item, source: "website", url: item.url ?? item.id }]),
    },
  });
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
    figmaSources.current.delete(key);
    setItems((current) => current.filter((item) => item.key !== key));
  };
  const retry = (key: string) => {
    const figma = figmaSources.current.get(key);
    if (figma) {
      resolveFigma(key, figma.source);
      return;
    }
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
          // Decoded when attached; a Figma reference has nothing to refresh.
          if (isFigmaReferenceKey(item.key)) return item;
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
          if (
            identityRef.current === submittedIdentity &&
            !isFigmaReferenceKey(item.key)
          ) {
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
      figmaKeys: submitted.map((item) => item.key).filter(isFigmaReferenceKey),
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
    for (const key of receipt.figmaKeys) {
      figmaSources.current.delete(key);
      removed.add(key);
    }
    setItems((current) => current.filter((item) => !removed.has(item.key)));
    if (
      receipt.systemItem &&
      currentSystem.current?.item === receipt.systemItem
    )
      onSystemChange(null);
  };
  const readFigmaLink = async (url: string) => {
    const result = figmaLinkSchema.parse(
      await callAction(
        "get-figma-design-context",
        { figmaUrl: url, depth: 1, maxNodes: 10, includeScreenshot: false },
        { method: "GET" },
      ),
    );
    const nodeUrl = (id: string) =>
      `https://www.figma.com/design/${result.fileKey}?node-id=${encodeURIComponent(id)}`;
    if (result.mode !== "overview") return { result, nodeUrl, pages: [] };
    const pages: FigmaPageOption[] = result.pages.map((page) => ({
      id: page.id,
      name: page.name,
      url: nodeUrl(page.id),
      frames:
        page.frames?.flatMap((frame) =>
          frame.name &&
          frame.type &&
          FIGMA_ATTACHABLE_FRAME_TYPES.has(frame.type)
            ? [
                {
                  id: frame.id,
                  title: `${page.name} / ${frame.name}`,
                  url: nodeUrl(frame.id),
                },
              ]
            : [],
        ) ?? null,
    }));
    return { result, nodeUrl, pages };
  };
  const loadFigmaLink = async (url: string): Promise<FigmaLinkTree> => {
    const { result, nodeUrl, pages } = await readFigmaLink(url);
    if (result.mode !== "overview") {
      if (!FIGMA_ATTACHABLE_FRAME_TYPES.has(result.summary.type))
        throw new Error(t("homeContext.figmaLinkNotFrame"));
      const frame = {
        id: result.nodeId,
        title: result.summary.name,
        url: nodeUrl(result.nodeId),
      };
      return {
        pages: [{ id: frame.id, name: "", url: frame.url, frames: [frame] }],
        preselected: [frame.id],
        preselectedPages: [],
        expandedPages: [],
      };
    }
    const linkedId = parseFigmaNodeId(url);
    const linked = pages.find((page) => page.id === linkedId);
    if (!linked) {
      return {
        pages,
        preselected: [],
        preselectedPages: [],
        expandedPages: [],
      };
    }
    // Figma's "Copy link" names the page in view, so a page link still lists
    // the whole file, with that page open and checked.
    const file = await readFigmaLink(
      `https://www.figma.com/design/${result.fileKey}`,
    );
    const filePages = file.pages.some((page) => page.id === linked.id)
      ? file.pages.map((page) => (page.id === linked.id ? linked : page))
      : [linked, ...file.pages];
    return {
      pages: filePages,
      preselected: linked.frames?.map((frame) => frame.id) ?? [],
      preselectedPages: linked.frames?.length ? [] : [linked.id],
      expandedPages: [linked.id],
    };
  };
  const loadFigmaPage = async (page: FigmaPageOption) => {
    const loaded = (await readFigmaLink(page.url)).pages.find(
      (candidate) => candidate.id === page.id,
    );
    if (!loaded?.frames) throw new Error(loadFailed);
    return loaded.frames;
  };
  const dialogs = (
    <FigmaAttachDialog
      open={figmaDialogOpen}
      onOpenChange={setFigmaDialogOpen}
      figmaConnected={capabilities.data?.sources.figma.available}
      loadLink={loadFigmaLink}
      loadPage={loadFigmaPage}
      onAttachLinks={(references) =>
        attachBatch(
          references.map((reference) => ({
            ...reference,
            source: "figma",
            figmaUrl: reference.url,
          })),
        )
      }
      onAttachFile={(file) => {
        try {
          attachFigma(figFileReferenceKey(file), { kind: "file", file });
        } catch (error) {
          reportAttachError(error);
        }
      }}
    />
  );
  return {
    contextItems,
    menuItems: active ? menuItems : [],
    onPasteContext,
    dialogs,
    remove,
    retry,
    prepareSubmission,
    submissionAccepted,
    identity,
  };
}
