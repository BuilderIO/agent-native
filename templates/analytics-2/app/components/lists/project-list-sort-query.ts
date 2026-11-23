/** Accept shared links and the list's existing sort URLs. */
export function readProjectListSortQuery(
  sort: string | null,
  direction: string | null,
): { sort: string | null; direction: string | undefined } {
  const parts = sort?.split(":");
  const key = parts?.[0]?.toLowerCase();
  return {
    sort:
      key === "name" || key === "project_name" || key === "title"
        ? "title"
        : key === "recently_viewed"
          ? "lastViewedByMe"
          : (sort ?? null),
    direction:
      (parts && parts.length > 1 ? parts[1] : direction)?.toLowerCase() ??
      (key === "project_name" ? "desc" : undefined),
  };
}
