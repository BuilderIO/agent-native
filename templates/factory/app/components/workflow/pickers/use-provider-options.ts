import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  OptionFailureCode,
  ProviderOption,
} from "../../../../server/workflow-host/option-listers/types.js";
import { readActionFailure } from "../workflow-errors";
import type { PickerKind, PickerResource } from "./picker-kinds";

interface OptionsPage {
  options: ProviderOption[];
  nextCursor?: string;
}

/** Why a list did not load: the typed code the action raised, and what it said about a credential. */
export interface ListFailure {
  code: OptionFailureCode;
  reason?: string;
  scope?: string;
}

/** A list is read again after this long; the providers' own limits are the reason not to read on every open. */
const LIST_STALE_MS = 5 * 60_000;

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** A failure that carries no typed code (the network, an action this build lacks) is still "could not read", never an empty list. */
function listFailure(error: unknown): ListFailure {
  const { errorCode, details } = readActionFailure(error, "");
  if (errorCode === "credential_missing") {
    const reason = textOf(details.reason);
    const scope = textOf(details.scope);
    return {
      code: errorCode,
      ...(reason ? { reason } : {}),
      ...(scope ? { scope } : {}),
    };
  }
  return {
    code: errorCode === "rate_limited" ? errorCode : "provider_unreadable",
  };
}

/** The `list-provider-options` parameters for one read; the first page and every later one differ only by `cursor`. */
export function providerOptionsRequest({
  factoryId,
  provider,
  resource,
  parent,
  search,
  cursor,
}: {
  factoryId: string;
  provider: string;
  resource: string;
  parent?: string;
  search?: string;
  cursor?: string;
}): Record<string, string> {
  return {
    factoryId,
    provider,
    resource,
    ...(parent ? { parent } : {}),
    ...(search ? { search } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

export interface ProviderOptionsState {
  /** Every page read so far; undefined until the first lands. */
  options: readonly ProviderOption[] | undefined;
  loading: boolean;
  failure: ListFailure | null;
  retry: () => void;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
}

/**
 * One provider list, read through `list-provider-options` once `enabled`.
 * The first page is a cached action query; later pages are read on request and
 * dropped when the list changes. With `search` the server reads on until it has
 * matches, so a resource on a later page is found without paging to it.
 */
export function useProviderOptions({
  factoryId,
  kind,
  resource,
  parent,
  search,
  enabled,
}: {
  factoryId: string;
  kind: PickerKind;
  resource: PickerResource;
  parent?: string;
  search?: string;
  enabled: boolean;
}): ProviderOptionsState {
  const { provider } = kind;
  const listKey = `${factoryId}/${provider}/${resource}/${parent ?? ""}/${search ?? ""}`;
  const first = useActionQuery<OptionsPage>(
    "list-provider-options",
    providerOptionsRequest({ factoryId, provider, resource, parent, search }),
    { enabled, retry: false, staleTime: LIST_STALE_MS },
  );

  const [more, setMore] = useState<{
    listKey: string;
    pages: OptionsPage[];
    loading: boolean;
    failure: ListFailure | null;
  }>({ listKey, pages: [], loading: false, failure: null });
  useEffect(() => {
    setMore((current) =>
      current.listKey === listKey
        ? current
        : { listKey, pages: [], loading: false, failure: null },
    );
  }, [listKey]);
  const current = more.listKey === listKey ? more : null;

  const loaded = useMemo(() => {
    if (!first.data) return undefined;
    const byValue = new Map<string, ProviderOption>();
    for (const page of [first.data, ...(current?.pages ?? [])]) {
      for (const option of page.options) byValue.set(option.value, option);
    }
    return [...byValue.values()];
  }, [first.data, current?.pages]);
  const lastPage = current?.pages[current.pages.length - 1] ?? first.data;
  const nextCursor = lastPage?.nextCursor;

  const loadMore = useCallback(() => {
    if (!nextCursor) return;
    setMore((previous) => ({ ...previous, loading: true, failure: null }));
    callAction<OptionsPage>(
      "list-provider-options",
      providerOptionsRequest({
        factoryId,
        provider,
        resource,
        parent,
        search,
        cursor: nextCursor,
      }),
      { method: "GET" },
    ).then(
      (page) =>
        setMore((previous) =>
          previous.listKey === listKey
            ? { ...previous, pages: [...previous.pages, page], loading: false }
            : previous,
        ),
      (error: unknown) =>
        setMore((previous) =>
          previous.listKey === listKey
            ? { ...previous, loading: false, failure: listFailure(error) }
            : previous,
        ),
    );
  }, [nextCursor, factoryId, provider, resource, parent, search, listKey]);

  const { refetch } = first;
  const pageFailed = current?.failure != null;
  const retry = useCallback(() => {
    if (pageFailed) loadMore();
    else void refetch();
  }, [pageFailed, loadMore, refetch]);

  // A retry keeps the failed state until the new read answers, so it reads as loading, not as still failed.
  const retrying = first.isError && first.isFetching;
  return {
    options: loaded,
    loading: first.isLoading || retrying,
    failure:
      first.isError && !retrying
        ? listFailure(first.error)
        : (current?.failure ?? null),
    retry,
    hasMore: nextCursor !== undefined,
    loadMore,
    loadingMore: current?.loading ?? false,
  };
}
