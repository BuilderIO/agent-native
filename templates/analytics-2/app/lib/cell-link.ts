/**
 * Links to one cell. The fragment names the cell; the path says whether the
 * link opens the notebook or the latest published app. Both live under the
 * app's own base path, which is read from the current address rather than
 * assumed.
 */

export type CellLinkTarget = "notebook" | "app";

const FRAGMENT = /^#cell-(.+)$/;

/** The cell a fragment names, or null when it names none or is malformed. */
export function parseCellLinkHash(hash: string): string | null {
  const match = FRAGMENT.exec(hash);
  if (match?.[1] === undefined) return null;
  try {
    const id = decodeURIComponent(match[1]);
    return id === "" ? null : id;
  } catch {
    // coercion-ok: a hand-edited fragment with a bad escape names no cell, and null says so
    return null;
  }
}

/** The path prefix the app is served under, taken from where the project route starts. */
function basePath(pathname: string): string {
  for (const marker of ["/project/", "/app/"]) {
    const at = pathname.indexOf(marker);
    if (at >= 0) return pathname.slice(0, at);
  }
  return "";
}

export function cellLinkHref(
  location: Pick<Location, "origin" | "pathname">,
  input: { projectId: string; cellId: string; target: CellLinkTarget },
): string {
  const project = encodeURIComponent(input.projectId);
  const path =
    input.target === "app"
      ? `/app/${project}/latest`
      : `/project/${project}/latest/logic`;
  return `${location.origin}${basePath(location.pathname)}${path}#cell-${encodeURIComponent(input.cellId)}`;
}

/** The cell a published-app address asks to show alone, or null when it asks for none. */
export function parseEmbeddedCell(search: string): string | null {
  const id = new URLSearchParams(search).get("embed");
  return id === null || id === "" ? null : id;
}

/** The published app address that shows one cell with none of the page around it. */
export function cellEmbedHref(
  location: Pick<Location, "origin" | "pathname">,
  input: { projectId: string; cellId: string },
): string {
  const project = encodeURIComponent(input.projectId);
  return `${location.origin}${basePath(location.pathname)}/app/${project}/latest?embed=${encodeURIComponent(input.cellId)}`;
}

export function parseEmbeddedApp(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.get("embedded") === "true" || parseEmbeddedCell(search) !== null;
}

export function parseEmbedToken(search: string): string | null {
  const token = new URLSearchParams(search).get("embedToken")?.trim();
  return token ? token : null;
}

export function appEmbedHref(
  location: Pick<Location, "origin" | "pathname">,
  input: {
    projectId: string;
    appHref?: string | null | undefined;
    embedToken?: string | null | undefined;
  },
): string {
  const project = encodeURIComponent(input.projectId);
  const path =
    input.appHref?.trim() || `${basePath(location.pathname)}/app/${project}/latest`;
  const params = new URLSearchParams({ embedded: "true" });
  const token = input.embedToken?.trim();
  if (token) params.set("embedToken", token);
  return `${location.origin}${path}?${params.toString()}`;
}

export function appEmbedIframeSnippet(url: string): string {
  return `<iframe width="100%" height="600" style="border:0" src="${url}"></iframe>`;
}
