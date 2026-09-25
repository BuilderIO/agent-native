import {
  snapshotComposerContextItems,
  type ComposerContextSnapshot,
  type AgentChatContextItem,
  type ComposerContextMenuItem,
  type ComposerContextPickerConfig,
  type ComposerContextPickerItem,
  type ComposerContextPickerRequest,
} from "@agent-native/core/client/composer";
import {
  actionErrorMessage,
  callAction,
  useChangeVersions,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  composerSourceListSchema,
  composerSourceReferenceSchema,
  type ComposerSourceRequest,
} from "@agent-native/core/shared";
import { parseFigmaFileKey } from "@shared/figma-url";
import {
  IconComponents,
  IconLink,
  IconOmega,
  IconTextRecognition,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

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
type Source = "design" | "slides" | "figma" | "website";
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
}) {
  const t = useT();
  const systemsEnabled = useDesignSystemWorkflows();
  const systemId = systemsEnabled ? selectedSystemId : null;
  const [items, setItems] = useState<AgentChatContextItem[]>([]);
  const { session } = useSession();
  const identity = `${session?.email ?? "anonymous"}:${session?.orgId ?? "none"}`;
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
    if (identityRef.current !== identity) throw new Error(loadFailed);
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
    [items, systemId, systemState, systemTitle, template, identity],
  );
  const referencePicker = (
    source: Exclude<Source, "website">,
  ): ComposerContextPickerConfig => {
    const toReference = (
      item: ComposerContextPickerItem,
      request: ComposerContextPickerRequest,
    ): Reference => ({
      ...item,
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
  const menuItems: ComposerContextMenuItem[] = [
    {
      id: "design",
      label: t("homeContext.design"),
      icon: <IconTextRecognition size={16} />,
      searchPlaceholder: t("homeContext.searchDesign"),
      children: [
        ...(systemsEnabled
          ? [
              {
                id: "system",
                label: t("homeContext.useDesignSystem"),
                icon: <IconOmega size={16} />,
                picker: {
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
                    icon: <IconOmega size={16} />,
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
                  onSelect: (item) => onSystemChange(item.id),
                },
              } satisfies ComposerContextMenuItem,
            ]
          : []),
        {
          id: "figma-reference",
          label: t("homeContext.figmaReference"),
          icon: <IconComponents size={16} />,
          picker: referencePicker("figma"),
        },
        {
          id: "website-reference",
          label: t("homeContext.websiteReference"),
          icon: <IconLink size={16} />,
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
      ],
    },
  ];
  const remove = (key: string) => {
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
    if (key === SYSTEM_CONTEXT_KEY) {
      setSystemRevision((value) => value + 1);
      return;
    }
    const request = requests.current.get(key);
    if (request) attach(request.reference);
  };
  const prepareSubmission = async (
    snapshot: ComposerContextSnapshot | undefined,
  ) => {
    const submittedIdentity = identity;
    const submittedSystemId = systemId;
    const references = new Map(requests.current);
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
                state?.id === submittedSystemId
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
                  currentItem.key === item.key
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
    if (identityRef.current !== submittedIdentity) throw new Error(loadFailed);
    return snapshotComposerContextItems(refreshed);
  };
  return {
    contextItems,
    menuItems,
    remove,
    retry,
    prepareSubmission,
    identity,
  };
}
