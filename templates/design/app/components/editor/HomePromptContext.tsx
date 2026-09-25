import {
  ComposerContextSearchInput,
  snapshotComposerContextItems,
  type ComposerContextSnapshot,
  type AgentChatContextItem,
  type ComposerContextMenuItem,
  type ComposerContextPageControls,
} from "@agent-native/core/client/composer";
import {
  actionErrorMessage,
  callAction,
  useActionQuery,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type {
  ComposerSourceRequest,
  ComposerSourceResult,
} from "@agent-native/core/shared";
import {
  IconBrandFigma,
  IconCheck,
  IconLayout,
  IconPalette,
  IconPresentation,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  PromptDesignSystemOption,
  PromptTemplateOption,
} from "@/components/editor/PromptDialog";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SYSTEM_CONTEXT_KEY,
  TEMPLATE_CONTEXT_KEY,
} from "@/lib/composer-context";

type SourceItem = { id: string; title: string; url?: string };
type Source = "design" | "slides" | "figma";
type Reference = SourceItem & { source: Source; figmaUrl?: string };

function ReferencePage({
  source,
  controls,
  onSelect,
}: {
  source: Source;
  controls: ComposerContextPageControls;
  onSelect: (reference: Reference) => void;
}) {
  const t = useT();
  const [paging, setPaging] = useState<{
    source: Source;
    search: string;
    cursors: Array<string | undefined>;
  }>({ source, search: "", cursors: [undefined] });
  const { search, cursors } =
    paging.source === source ? paging : { search: "", cursors: [undefined] };
  const [figmaUrl, setFigmaUrl] = useState("");
  const [submittedUrl, setSubmittedUrl] = useState("");
  const params = {
    source,
    operation: "list" as const,
    search,
    page: cursors.length,
    cursor: cursors[cursors.length - 1],
    ...(submittedUrl ? { figmaUrl: submittedUrl } : {}),
  };
  const query = useActionQuery("read-composer-source", params, {
    enabled: source !== "figma" || Boolean(submittedUrl),
  });
  const data = query.data && "items" in query.data ? query.data : undefined;
  const searchLabel = t(
    source === "figma"
      ? "homeContext.searchFrames"
      : source === "slides"
        ? "homeContext.searchPresentations"
        : "homeContext.searchDesigns",
  );
  return (
    <Command shouldFilter={false}>
      <ComposerContextSearchInput
        value={search}
        onValueChange={(value) =>
          setPaging({ source, search: value, cursors: [undefined] })
        }
        placeholder={searchLabel}
        aria-label={searchLabel}
        onBack={() => controls.onBack()}
      />
      {source === "figma" ? (
        <form
          className="flex gap-2 p-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedUrl(figmaUrl.trim());
            setPaging({ source, search, cursors: [undefined] });
          }}
        >
          <Input
            aria-label={t("designEditor.import.figmaUrlLabel")}
            placeholder={t("designEditor.import.figmaUrlPlaceholder")}
            value={figmaUrl}
            onChange={(event) => setFigmaUrl(event.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!figmaUrl.trim()}
          >
            {t("homeContext.browse")}
          </Button>
        </form>
      ) : null}
      <CommandList>
        {query.isLoading && (source !== "figma" || submittedUrl) ? (
          <div className="grid gap-2 p-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : null}
        {query.isError ? (
          <div className="grid gap-2 p-2">
            <p role="alert" className="text-sm text-destructive">
              {actionErrorMessage(query.error) ?? t("homeContext.loadFailed")}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
            >
              {t("homeContext.retry")}
            </Button>
          </div>
        ) : null}
        <CommandGroup>
          {(data?.items ?? []).map((item) => (
            <CommandItem
              key={item.id}
              value={item.id}
              onSelect={() => {
                onSelect({
                  ...item,
                  source,
                  ...(source === "figma" ? { figmaUrl: submittedUrl } : {}),
                });
                controls.onClose();
              }}
            >
              {item.title}
            </CommandItem>
          ))}
        </CommandGroup>
        {query.isSuccess && data && !data.items.length ? (
          <p className="p-3 text-sm text-muted-foreground">
            {t("homeContext.empty")}
          </p>
        ) : null}
        <div className="flex justify-between gap-2 p-2">
          {cursors.length > 1 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setPaging({ source, search, cursors: cursors.slice(0, -1) })
              }
            >
              {t("home.paginationPrevious")}
            </Button>
          ) : (
            <span />
          )}
          {data?.hasMore ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={
                query.isFetching || (source === "slides" && !data.nextCursor)
              }
              onClick={() =>
                setPaging({
                  source,
                  search,
                  cursors: [...cursors, data.nextCursor],
                })
              }
            >
              {t("home.paginationNext")}
            </Button>
          ) : null}
        </div>
      </CommandList>
    </Command>
  );
}

function SelectionPage({
  controls,
  options,
  onSelect,
  selectedId,
  loading,
  error,
  onRetry,
}: {
  controls: ComposerContextPageControls;
  options: Array<{ id: string; title: string; disabled?: boolean }>;
  onSelect: (id: string | null) => void;
  selectedId?: string | null;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  const t = useT();
  return (
    <Command>
      <ComposerContextSearchInput
        placeholder={t("homeContext.searchSystems")}
        aria-label={t("homeContext.searchSystems")}
        onBack={() => controls.onBack()}
      />
      <CommandList>
        {loading ? (
          <div className="grid gap-2 p-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : null}
        {error ? (
          <div className="grid gap-2 p-2">
            <p role="alert" className="text-sm text-destructive">
              {actionErrorMessage(error) ?? t("homeContext.loadFailed")}
            </p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t("homeContext.retry")}
            </Button>
          </div>
        ) : null}
        {!loading && !error ? (
          <CommandEmpty>{t("homeContext.empty")}</CommandEmpty>
        ) : null}
        <CommandGroup>
          <CommandItem
            onSelect={() => {
              onSelect(null);
              controls.onClose();
            }}
          >
            {!selectedId ? <IconCheck /> : null}
            {t("homeContext.none")}
          </CommandItem>
          {options.map((option) => (
            <CommandItem
              key={option.id}
              value={`${option.id} ${option.title}`}
              disabled={option.disabled}
              onSelect={() => {
                onSelect(option.id);
                controls.onClose();
              }}
            >
              {selectedId === option.id ? <IconCheck /> : null}
              {option.title}
            </CommandItem>
          ))}
        </CommandGroup>
        {!loading && !error && !options.length ? (
          <p className="p-3 text-sm text-muted-foreground">
            {t("homeContext.empty")}
          </p>
        ) : null}
      </CommandList>
    </Command>
  );
}

export function useHomePromptContext({
  systems,
  systemId,
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
  const [items, setItems] = useState<AgentChatContextItem[]>([]);
  const { session } = useSession();
  const identity = `${session?.email ?? "anonymous"}:${session?.orgId ?? "none"}`;
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
      const key = `design-home-reference:${reference.source}:${reference.figmaUrl ?? ""}:${reference.id}`;
      const revision = ++requestRevision.current;
      requests.current.set(key, { reference, revision });
      setItems((current) => [
        ...current.filter((item) => item.key !== key),
        { key, title: reference.title, context: "", status: "pending" },
      ]);
      const params: ComposerSourceRequest = {
        source: reference.source,
        operation: "read",
        id: reference.id,
        page: 1,
        ...(reference.figmaUrl
          ? { figmaUrl: reference.figmaUrl, nodeId: reference.id }
          : {}),
      };
      void callAction("read-composer-source", params, { method: "GET" })
        .then((data) => {
          const result = data as ComposerSourceResult;
          if (!("context" in result) || !result.context.trim())
            throw new Error(loadFailed);
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
  const menuItems: ComposerContextMenuItem[] = [
    {
      id: "design",
      label: t("homeContext.design"),
      icon: <IconLayout />,
      searchPlaceholder: t("homeContext.searchDesign"),
      children: [
        {
          id: "system",
          label: t("homeContext.useDesignSystem"),
          icon: <IconPalette />,
          onSelect() {},
          render: (controls) => (
            <SelectionPage
              controls={controls}
              options={systems.map((system) => ({
                ...system,
                disabled: !system.ready,
              }))}
              selectedId={systemId}
              loading={systemsLoading}
              error={systemsError}
              onRetry={retrySystems}
              onSelect={onSystemChange}
            />
          ),
        },
        {
          id: "figma-reference",
          label: t("homeContext.figmaReference"),
          icon: <IconBrandFigma />,
          onSelect() {},
          render: (controls) => (
            <ReferencePage
              source="figma"
              controls={controls}
              onSelect={attach}
            />
          ),
        },
        {
          id: "design-reference",
          label: t("homeContext.referenceDesign"),
          icon: <IconLayout />,
          onSelect() {},
          render: (controls) => (
            <ReferencePage
              source="design"
              controls={controls}
              onSelect={attach}
            />
          ),
        },
        {
          id: "slides-reference",
          label: t("homeContext.referenceDeck"),
          icon: <IconPresentation />,
          onSelect() {},
          render: (controls) => (
            <ReferencePage
              source="slides"
              controls={controls}
              onSelect={attach}
            />
          ),
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
                id: reference.id,
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
