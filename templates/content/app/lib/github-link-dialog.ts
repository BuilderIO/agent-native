/** What the GitHub folder dialog links: a collection, or a new one it makes. */
export type GitHubLinkTarget =
  | {
      kind: "collection";
      databaseId: string;
      documentId: string;
      /** Where a new collection beside this one would go, if it can't link. */
      spaceId?: string;
      parentId?: string | null;
    }
  | { kind: "new"; spaceId: string; parentId: string | null };

export interface GitHubLinkDialogRequest {
  target: GitHubLinkTarget;
  /** A folder link to start from, like one typed before connecting GitHub. */
  url?: string;
  returnFocusTo?: HTMLElement | null;
}

export const GITHUB_LINK_DIALOG_OPEN_EVENT = "content:open-github-link";

export function openGitHubLinkDialog(request: GitHubLinkDialogRequest) {
  window.dispatchEvent(
    new CustomEvent<GitHubLinkDialogRequest>(GITHUB_LINK_DIALOG_OPEN_EVENT, {
      detail: request,
    }),
  );
}

// The page's address carries the dialog through GitHub's sign-in, so the
// person comes back to it open rather than to where they started.
const KIND_PARAM = "githubLink";
const ID_PARAM = "githubId";
const PAGE_PARAM = "githubPage";
const URL_PARAM = "githubUrl";
const PARAMS = [KIND_PARAM, ID_PARAM, PAGE_PARAM, URL_PARAM];

/** This page's address with the dialog's target, for GitHub to return to. */
export function githubLinkReturnPath(
  location: { pathname: string; search: string },
  target: GitHubLinkTarget,
  url?: string,
): string {
  const params = new URLSearchParams(location.search);
  for (const name of PARAMS) params.delete(name);
  params.set(KIND_PARAM, target.kind);
  if (target.kind === "collection") {
    params.set(ID_PARAM, target.databaseId);
    params.set(PAGE_PARAM, target.documentId);
  } else {
    params.set(ID_PARAM, target.spaceId);
    if (target.parentId) params.set(PAGE_PARAM, target.parentId);
  }
  if (url?.trim()) params.set(URL_PARAM, url.trim());
  return `${location.pathname}?${params.toString()}`;
}

/** The dialog an address asks to reopen, if any. */
export function githubLinkRequestFromSearch(
  search: string,
): Omit<GitHubLinkDialogRequest, "returnFocusTo"> | null {
  const params = new URLSearchParams(search);
  const kind = params.get(KIND_PARAM);
  const id = params.get(ID_PARAM);
  const page = params.get(PAGE_PARAM);
  const url = params.get(URL_PARAM) ?? undefined;
  if (!id) return null;
  if (kind === "collection" && page) {
    return {
      target: { kind, databaseId: id, documentId: page },
      url,
    };
  }
  if (kind === "new") {
    return { target: { kind, spaceId: id, parentId: page || null }, url };
  }
  return null;
}

/** The query string without the dialog's params, or "" when none are left. */
export function searchWithoutGitHubLink(search: string): string {
  const params = new URLSearchParams(search);
  for (const name of PARAMS) params.delete(name);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
