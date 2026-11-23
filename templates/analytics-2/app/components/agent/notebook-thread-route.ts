import type { Location } from "react-router";

export const NOTEBOOK_THREAD_PARAM = "notebookThread";
const OLD_NOTEBOOK_THREAD_PARAM = "threadId";

export function withNotebookAgentView(location: Location): Location {
  const query = new URLSearchParams(location.search);
  if (query.get("notebookView") === "agent") return location;
  query.set("notebookView", "agent");
  return { ...location, search: `?${query}` };
}

export function notebookThreadId(search: string) {
  const query = new URLSearchParams(search);
  return (
    query.get(NOTEBOOK_THREAD_PARAM) ?? query.get(OLD_NOTEBOOK_THREAD_PARAM)
  );
}

export function notebookThreadPath(
  location: Pick<Location, "pathname" | "search" | "hash">,
  threadId: string | null,
) {
  const query = new URLSearchParams(location.search);
  query.delete(OLD_NOTEBOOK_THREAD_PARAM);
  if (threadId) query.set(NOTEBOOK_THREAD_PARAM, threadId);
  else query.delete(NOTEBOOK_THREAD_PARAM);
  const search = query.toString();
  return `${location.pathname}${search ? `?${search}` : ""}${location.hash}`;
}
