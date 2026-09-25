import { IconArrowLeft, IconCheck } from "@tabler/icons-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
} from "react";

import { Button } from "../ui/button.js";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu.js";
import { Skeleton } from "../ui/skeleton.js";
import { formatAttachmentError } from "./attachment-accept.js";
import { ComposerContextMenuSearch } from "./ComposerContextMenuSearch.js";
import { useComposerRuntimeAdapters } from "./runtime-adapters.js";

export interface ComposerContextPickerItem {
  id: string;
  title: string;
  disabled?: boolean;
  url?: string;
}
export interface ComposerContextPickerRequest {
  search: string;
  page: number;
  cursor?: string;
  url?: string;
  signal: AbortSignal;
}
export interface ComposerContextPickerResult {
  items: readonly ComposerContextPickerItem[];
  hasMore?: boolean;
  nextCursor?: string;
}
export type ComposerContextPickerSelection =
  | void
  | boolean
  | Promise<void | boolean>;
export type ComposerContextPickerFooterAction = {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
} & (
  | { onSelect: () => ComposerContextPickerSelection; renderLink?: never }
  | { renderLink: (children: ReactNode) => ReactElement; onSelect?: never }
);
export type ComposerContextPickerConfig = {
  footerAction?: ComposerContextPickerFooterAction;
  searchPlaceholder: string;
  selectedIds?: readonly string[];
  scopeKey?: string;
  refreshKey?: string | number;
  onSelect: (
    item: ComposerContextPickerItem,
    request: ComposerContextPickerRequest,
  ) => ComposerContextPickerSelection;
  link?: {
    placeholder: string;
    submitLabel: string;
    validate?: (url: string) => string | undefined;
  };
  clearSelection?: {
    label: string;
    onSelect: () => ComposerContextPickerSelection;
  };
  emptyMessage?: string;
} & (
  | {
      items?: readonly ComposerContextPickerItem[];
      loading?: boolean;
      error?: string;
      onRetry?: () => unknown;
      load?: never;
    }
  | {
      load: (
        request: ComposerContextPickerRequest,
      ) => Promise<ComposerContextPickerResult>;
      items?: never;
      loading?: never;
      error?: never;
      onRetry?: never;
    }
);

type PickerLocation = Omit<ComposerContextPickerRequest, "signal">;
type LoadState = {
  key: string;
  status: "loading" | "ready" | "error";
  result?: ComposerContextPickerResult;
  error?: string;
};

function validResult(result: ComposerContextPickerResult): boolean {
  return Boolean(
    result &&
    Array.isArray(result.items) &&
    result.items.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        (item.disabled === undefined || typeof item.disabled === "boolean") &&
        (item.url === undefined || typeof item.url === "string"),
    ) &&
    (result.hasMore === undefined || typeof result.hasMore === "boolean") &&
    (result.nextCursor === undefined || typeof result.nextCursor === "string"),
  );
}

export function ComposerContextPicker({
  config,
  onClose,
}: {
  config: ComposerContextPickerConfig;
  onClose: () => void;
}) {
  const t = useComposerRuntimeAdapters().translate!;
  const configRef = useRef(config);
  configRef.current = config;
  const translateRef = useRef(t);
  translateRef.current = t;
  const [stage, setStage] = useState<"link" | "results">(
    config.link ? "link" : "results",
  );
  const [link, setLink] = useState("");
  const [location, setLocation] = useState<PickerLocation>({
    search: "",
    page: 1,
  });
  const cursors = useRef<Array<string | undefined>>([undefined]);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<LoadState>({
    key: "",
    status: "loading",
  });
  const [actionError, setActionError] = useState<{
    message: string;
    retry?: () => void;
  }>();
  const [selecting, setSelecting] = useState(false);
  const epoch = useRef(0);
  const pendingSelection = useRef<AbortController | null>(null);
  const remote = Boolean(config.load);
  const key = JSON.stringify([location, config.refreshKey]);
  const keyRef = useRef(key);
  keyRef.current = key;

  const invalidateSelection = () => {
    epoch.current++;
    pendingSelection.current?.abort();
    pendingSelection.current = null;
    setSelecting(false);
    setActionError(undefined);
  };
  useEffect(
    () => () => {
      epoch.current++;
      pendingSelection.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!remote || stage !== "results") return;
    const abort = new AbortController();
    const loader = configRef.current.load!;
    const request = { ...location, signal: abort.signal };
    setLoaded((previous) => ({
      key,
      status: "loading",
      result: previous.result,
    }));
    void Promise.resolve()
      .then(() => {
        if (abort.signal.aborted) return;
        return loader(request);
      })
      .then((result) => {
        if (abort.signal.aborted || keyRef.current !== key) return;
        if (!result || !validResult(result))
          throw new Error(
            translateRef.current("agentChat.composer.contextLoadFailed", {
              defaultValue: "Could not load context.",
            }),
          );
        setLoaded({ key, status: "ready", result });
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted || keyRef.current !== key) return;
        setLoaded({
          key,
          status: "error",
          error: formatAttachmentError(
            cause,
            translateRef.current("agentChat.composer.contextLoadFailed", {
              defaultValue: "Could not load context.",
            }),
          ),
        });
      });
    return () => abort.abort();
  }, [key, location, remote, stage, revision]);

  const move = (next: PickerLocation) => {
    invalidateSelection();
    setLocation(next);
  };
  const back = () => {
    invalidateSelection();
    if (stage === "results" && config.link) {
      setStage("link");
      setLocation({ search: "", page: 1 });
      cursors.current = [undefined];
    }
  };
  const select = async (item?: ComposerContextPickerItem | "footer") => {
    if (pendingSelection.current) return;
    const abort = new AbortController();
    const generation = ++epoch.current;
    pendingSelection.current = abort;
    setSelecting(true);
    setActionError(undefined);
    try {
      const result =
        item === "footer"
          ? await configRef.current.footerAction?.onSelect?.()
          : item
            ? await configRef.current.onSelect(item, {
                ...location,
                signal: abort.signal,
              })
            : await configRef.current.clearSelection?.onSelect();
      if (abort.signal.aborted || epoch.current !== generation) return;
      if (result !== false) onClose();
    } catch (cause) {
      if (abort.signal.aborted || epoch.current !== generation) return;
      setActionError({
        message: formatAttachmentError(
          cause,
          t("agentChat.composer.contextActionFailed", {
            defaultValue: "Could not add context.",
          }),
        ),
        retry: () => {
          void select(item);
        },
      });
    } finally {
      if (epoch.current === generation) {
        pendingSelection.current = null;
        setSelecting(false);
      }
    }
  };
  const retryLoad = async () => {
    setActionError(undefined);
    if (remote) {
      setRevision((value) => value + 1);
      return;
    }
    const generation = epoch.current;
    try {
      await configRef.current.onRetry?.();
    } catch (cause) {
      if (epoch.current !== generation) return;
      setActionError({
        message: formatAttachmentError(
          cause,
          t("agentChat.composer.contextLoadFailed", {
            defaultValue: "Could not load context.",
          }),
        ),
        retry: () => {
          void retryLoad();
        },
      });
    }
  };
  const submitLink = () => {
    const value = link.trim();
    let message: string | undefined;
    try {
      message = value
        ? config.link?.validate?.(value)
        : t("agentChat.composer.contextLinkRequired", {
            defaultValue: "Enter a link.",
          });
    } catch (cause) {
      message = formatAttachmentError(
        cause,
        t("agentChat.composer.contextLoadFailed", {
          defaultValue: "Could not load context.",
        }),
      );
    }
    if (message) {
      setActionError({ message });
      return;
    }
    move({ search: "", page: 1, url: value });
    cursors.current = [undefined];
    setStage("results");
  };

  const loading = remote
    ? loaded.key !== key || loaded.status === "loading"
    : config.loading === true;
  const error =
    actionError?.message ??
    (remote
      ? loaded.key === key && loaded.status === "error"
        ? loaded.error
        : undefined
      : config.error);
  const result = remote ? loaded.result : undefined;
  const terms = location.search
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const items = remote
    ? (result?.items ?? [])
    : (config.items ?? []).filter((item) =>
        terms.every((term) => item.title.toLocaleLowerCase().includes(term)),
      );
  const hasMore = result?.hasMore ?? Boolean(result?.nextCursor);
  const retry =
    actionError?.retry ??
    (remote || config.onRetry
      ? () => {
          void retryLoad();
        }
      : undefined);
  const check = (selected: boolean) => (
    <span className="ms-auto size-4 shrink-0" aria-hidden="true">
      {selected ? <IconCheck className="size-4" /> : null}
    </span>
  );

  const footer = config.footerAction;
  const footerContent = footer ? (
    <>
      {footer.icon}
      {footer.label}
    </>
  ) : null;
  return (
    <>
      <ComposerContextMenuSearch
        leading={
          stage === "results" && config.link ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("agentChat.composer.contextBack", {
                defaultValue: "Back",
              })}
              onClick={back}
            >
              <IconArrowLeft size={16} />
            </Button>
          ) : undefined
        }
        placeholder={
          stage === "link" ? config.link!.placeholder : config.searchPlaceholder
        }
        invalid={stage === "link" && Boolean(actionError)}
        value={stage === "link" ? link : location.search}
        onValueChange={(value) => {
          if (stage === "link") {
            setLink(value);
            setActionError(undefined);
          } else {
            cursors.current = [undefined];
            move({ search: value, page: 1, url: location.url });
          }
        }}
        onSubmit={stage === "link" ? submitLink : undefined}
      />
      <DropdownMenuGroup
        className="max-h-64 overflow-y-auto"
        aria-busy={stage === "results" && (loading || selecting)}
      >
        {stage === "link" ? (
          <>
            {actionError && (
              <>
                <div role="alert" className="p-3 text-sm text-destructive">
                  {actionError.message}
                </div>
                {actionError.retry && (
                  <DropdownMenuItem
                    disabled={selecting}
                    onSelect={(event) => {
                      event.preventDefault();
                      actionError.retry?.();
                    }}
                  >
                    {t("agentChat.common.retry", { defaultValue: "Retry" })}
                  </DropdownMenuItem>
                )}
              </>
            )}
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                submitLink();
              }}
            >
              {config.link!.submitLabel}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            {error ? (
              <>
                <div role="alert" className="p-3 text-sm text-destructive">
                  {error}
                </div>
                {retry && (
                  <DropdownMenuItem
                    disabled={loading || selecting}
                    onSelect={(event) => {
                      event.preventDefault();
                      retry();
                    }}
                  >
                    {t("agentChat.common.retry", { defaultValue: "Retry" })}
                  </DropdownMenuItem>
                )}
              </>
            ) : loading ? (
              <div
                role="status"
                aria-label={t("agentChat.common.loading", {
                  defaultValue: "Loading...",
                })}
                className="grid gap-1 p-1"
              >
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <>
                {!items.length && (
                  <div
                    role="status"
                    className="p-3 text-xs text-muted-foreground"
                  >
                    {config.emptyMessage ??
                      t("agentChat.composer.noContextResults", {
                        defaultValue: "No matching context.",
                      })}
                  </div>
                )}
                {config.clearSelection && (
                  <DropdownMenuItem
                    role="menuitemcheckbox"
                    aria-checked={!config.selectedIds?.length}
                    disabled={selecting}
                    onSelect={(event) => {
                      event.preventDefault();
                      void select();
                    }}
                  >
                    {config.clearSelection.label}
                    {check(!config.selectedIds?.length)}
                  </DropdownMenuItem>
                )}
                {items.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    role="menuitemcheckbox"
                    aria-checked={
                      config.selectedIds?.includes(item.id) === true
                    }
                    disabled={item.disabled || selecting}
                    onSelect={(event) => {
                      event.preventDefault();
                      void select(item);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {item.title}
                    </span>
                    {check(config.selectedIds?.includes(item.id) === true)}
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {(location.page > 1 || hasMore) && (
              <>
                {location.page > 1 && (
                  <DropdownMenuItem
                    disabled={loading || selecting}
                    onSelect={(event) => {
                      event.preventDefault();
                      move({
                        ...location,
                        page: location.page - 1,
                        cursor: cursors.current[location.page - 2],
                      });
                    }}
                  >
                    {t("agentChat.composer.contextPrevious", {
                      defaultValue: "Previous",
                    })}
                  </DropdownMenuItem>
                )}
                {hasMore && (
                  <DropdownMenuItem
                    disabled={loading || selecting || Boolean(error)}
                    onSelect={(event) => {
                      event.preventDefault();
                      cursors.current = [
                        ...cursors.current.slice(0, location.page),
                        result?.nextCursor,
                      ];
                      move({
                        ...location,
                        page: location.page + 1,
                        cursor: result?.nextCursor,
                      });
                    }}
                  >
                    {t("agentChat.composer.contextNext", {
                      defaultValue: "Next",
                    })}
                  </DropdownMenuItem>
                )}
              </>
            )}
          </>
        )}
      </DropdownMenuGroup>
      {footer && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {footer.renderLink && !footer.disabled && !selecting ? (
              <DropdownMenuItem asChild onSelect={onClose}>
                {footer.renderLink(footerContent)}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={footer.disabled || selecting}
                onSelect={(event) => {
                  event.preventDefault();
                  void select("footer");
                }}
              >
                {footerContent}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </>
      )}
    </>
  );
}
