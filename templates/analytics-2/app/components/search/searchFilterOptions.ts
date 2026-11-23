/**
 * Search filter options from the workspace's own catalogues.
 *
 * The search panel renders whatever it is given and shows a real empty state
 * for a list it was not given, so this mapper never invents an option: a list
 * with nothing in it is omitted instead of rendered.
 *
 * Ids are the values the search action filters on:
 * - a creator is a project owner, addressed by the member's email and shown
 *   by full name when the member has one;
 * - a category and a status are the ids of the workspace catalogues.
 */

import type { SearchFilterOption, SearchFilterOptions } from "./types";

export type FilterOptionSources = {
  members?:
    | readonly { email?: string | null; name?: string | null }[]
    | undefined;
  categories?:
    | readonly { id?: string | null; name?: string | null }[]
    | undefined;
  statuses?:
    | readonly { id?: string | null; name?: string | null }[]
    | undefined;
};

function namedOptions(
  rows: readonly { id?: string | null; name?: string | null }[] | undefined,
): SearchFilterOption[] {
  const options: SearchFilterOption[] = [];
  for (const row of rows ?? []) {
    const id = (row.id ?? "").trim();
    const name = (row.name ?? "").trim();
    if (id === "" || name === "") continue;
    options.push({ id, label: name });
  }
  return options;
}

export function toSearchFilterOptions(
  sources: FilterOptionSources,
): SearchFilterOptions {
  const creators: SearchFilterOption[] = [];
  for (const member of sources.members ?? []) {
    const email = (member.email ?? "").trim();
    if (email === "") continue;
    creators.push({ id: email, label: (member.name ?? "").trim() || email });
  }

  const categories = namedOptions(sources.categories);
  const statuses = namedOptions(sources.statuses);

  return {
    ...(creators.length > 0 ? { creators } : {}),
    ...(categories.length > 0 ? { categories } : {}),
    ...(statuses.length > 0 ? { statuses } : {}),
  };
}
