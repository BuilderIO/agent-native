import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
} from "react";

import { formatAttachmentError } from "./attachment-accept.js";
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
  link?: {
    label?: string;
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
) &
  (
    | {
        presentation?: "submenu" | { type: "dialog"; mode: "url" };
        onSelect: (
          item: ComposerContextPickerItem,
          request: ComposerContextPickerRequest,
        ) => ComposerContextPickerSelection;
      }
    | {
        presentation: {
          type: "dialog";
          mode: "multiple";
          onAttach: (
            items: readonly ComposerContextPickerItem[],
            request: ComposerContextPickerRequest,
          ) => ComposerContextPickerSelection;
        };
        onSelect?: never;
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

export function useComposerContextPicker({
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
  const presentation =
    typeof config.presentation === "object" ? config.presentation : undefined;
  const [chosen, setChosen] = useState<
    ReadonlyMap<string, ComposerContextPickerItem>
  >(() => new Map());
  const [stage, setStage] = useState<"link" | "results">(
    config.link || presentation ? "link" : "results",
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
    if (stage === "results" && (config.link || presentation)) {
      setStage("link");
      setChosen(new Map());
      setLocation({ search: "", page: 1 });
      cursors.current = [undefined];
    }
  };
  const select = async (
    item?: ComposerContextPickerItem | "footer" | "batch" | "url",
  ) => {
    if (pendingSelection.current) return;
    const abort = new AbortController();
    const generation = ++epoch.current;
    pendingSelection.current = abort;
    setSelecting(true);
    setActionError(undefined);
    try {
      const active = configRef.current;
      const request = Object.freeze({
        ...location,
        ...(item === "url" ? { url: link.trim() } : {}),
        signal: abort.signal,
      });
      const dialog =
        typeof active.presentation === "object"
          ? active.presentation
          : undefined;
      const batch = Object.freeze(
        [...chosen.values()]
          .filter((value) => !active.selectedIds?.includes(value.id))
          .map((value) => Object.freeze({ ...value })),
      );
      const result =
        item === "batch" && dialog?.mode === "multiple"
          ? await dialog.onAttach(batch, request)
          : item === "url"
            ? await active.onSelect!(
                { id: link.trim(), title: link.trim(), url: link.trim() },
                request,
              )
            : item === "footer"
              ? await configRef.current.footerAction?.onSelect?.()
              : item && typeof item === "object"
                ? await active.onSelect!(item, request)
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
  const validateLink = (value: string): string | undefined => {
    try {
      if (!value)
        return t("agentChat.composer.contextLinkRequired", {
          defaultValue: "Enter a link.",
        });
      if (presentation) {
        let parsed: URL;
        try {
          parsed = new URL(value);
        } catch {
          return t("agentChat.composer.contextInvalidUrl", {
            defaultValue: "Enter a valid HTTP or HTTPS URL.",
          });
        }
        if (
          !["http:", "https:"].includes(parsed.protocol) ||
          !parsed.hostname ||
          parsed.username ||
          parsed.password
        ) {
          return t("agentChat.composer.contextInvalidUrl", {
            defaultValue: "Enter a valid HTTP or HTTPS URL.",
          });
        }
      }
      return config.link?.validate?.(value);
    } catch (cause) {
      return formatAttachmentError(
        cause,
        t("agentChat.composer.contextLoadFailed", {
          defaultValue: "Could not load context.",
        }),
      );
    }
  };
  const linkError = validateLink(link.trim());
  const submitLink = () => {
    const value = link.trim();
    const message = validateLink(value);
    if (presentation && message) return;
    if (message) {
      setActionError({ message });
      return;
    }
    if (presentation?.mode === "url") {
      void select("url");
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
  const selectedItems = [...chosen.values()].filter(
    (item) => !config.selectedIds?.includes(item.id),
  );
  const toggleItem = (item: ComposerContextPickerItem, checked: boolean) => {
    if (selecting || item.disabled || config.selectedIds?.includes(item.id))
      return;
    setActionError(undefined);
    setChosen((previous) => {
      const next = new Map(previous);
      if (checked) next.set(item.id, item);
      else next.delete(item.id);
      return next;
    });
  };
  return {
    t,
    config,
    stage,
    link,
    setLink,
    location,
    cursors,
    move,
    back,
    select,
    submitLink,
    loading,
    error,
    items,
    hasMore,
    retry,
    selecting,
    actionError,
    setActionError,
    result,
    linkError,
    selectedItems,
    toggleItem,
  };
}
