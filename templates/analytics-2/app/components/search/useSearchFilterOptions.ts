import { useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect, useMemo, useState } from "react";

import {
  toSearchFilterOptions,
  type FilterOptionSources,
} from "./searchFilterOptions";
import type { SearchFilterOption, SearchFilterOptions } from "./types";

export function useSearchFilterOptions(enabled: boolean): SearchFilterOptions {
  const [creatorText, setCreatorText] = useState("");
  const [creatorPage, setCreatorPage] = useState<{
    search: string;
    offset: number;
    previous: SearchFilterOption[];
  }>({ search: "", offset: 0, previous: [] });
  useEffect(() => {
    if (!enabled) {
      setCreatorText("");
      setCreatorPage({ search: "", offset: 0, previous: [] });
      return;
    }
    const timer = setTimeout(() => {
      setCreatorPage((page) =>
        page.search === creatorText.trim()
          ? page
          : { search: creatorText.trim(), offset: 0, previous: [] },
      );
    }, 200);
    return () => clearTimeout(timer);
  }, [creatorText, enabled]);
  const membersQuery = useActionQuery(
    "list-organization-members",
    { search: creatorPage.search, limit: 50, offset: creatorPage.offset },
    { enabled, retry: 0 },
  );
  const categoriesQuery = useActionQuery(
    "list-data-categories",
    {},
    { enabled, retry: 0 },
  );
  const statusesQuery = useActionQuery(
    "list-data-statuses",
    {},
    { enabled, retry: 0 },
  );

  const sources = useMemo<FilterOptionSources>(
    () => ({
      members: membersQuery.data?.members,
      categories: categoriesQuery.data?.categories,
      statuses: statusesQuery.data?.statuses,
    }),
    [membersQuery.data, categoriesQuery.data, statusesQuery.data],
  );

  const creatorLoading =
    creatorText.trim() !== creatorPage.search ||
    membersQuery.isPending ||
    membersQuery.isFetching;
  const creatorStatus = creatorLoading
    ? "loading"
    : membersQuery.isError
      ? "error"
      : "ready";
  const options = toSearchFilterOptions(sources);
  const creators = [
    ...new Map(
      [...creatorPage.previous, ...(options.creators ?? [])].map((creator) => [
        creator.id,
        creator,
      ]),
    ).values(),
  ];
  return {
    ...options,
    creators,
    creatorSearch: {
      text: creatorText,
      status: creatorStatus,
      hasMore: creatorStatus === "ready" && membersQuery.data?.hasMore === true,
      onSearch: setCreatorText,
      onMore: () => {
        const nextOffset = membersQuery.data?.nextOffset;
        if (
          creatorStatus === "ready" &&
          membersQuery.data?.hasMore &&
          nextOffset != null
        ) {
          setCreatorPage((page) => ({
            ...page,
            offset: nextOffset,
            previous: creators,
          }));
        }
      },
    },
  };
}
