const LOCAL_SOURCE_DIRECTORY_PREFIX = "local-source-directory:";

export interface LocalSourceDirectory {
  rootPath: string;
  path: string;
}

function relativeSegments(path: string) {
  const segments = path.split("/");
  return segments.every(
    (segment) => segment !== "" && segment !== "." && segment !== "..",
  )
    ? segments
    : null;
}

export function localSourceFileDirectory(
  sourcePath: string | null | undefined,
): string | null {
  const segments = sourcePath ? relativeSegments(sourcePath) : null;
  return segments ? segments.slice(0, -1).join("/") : null;
}

export function localSourceDirectoryId({
  rootPath,
  path,
}: LocalSourceDirectory) {
  return `${LOCAL_SOURCE_DIRECTORY_PREFIX}${encodeURIComponent(rootPath)}:${encodeURIComponent(path)}`;
}

export function isLocalSourceDirectoryId(id: string) {
  return id.startsWith(LOCAL_SOURCE_DIRECTORY_PREFIX);
}

export function parseLocalSourceDirectoryId(
  id: string,
): LocalSourceDirectory | null {
  if (!isLocalSourceDirectoryId(id)) return null;
  const encoded = id.slice(LOCAL_SOURCE_DIRECTORY_PREFIX.length);
  const separator = encoded.indexOf(":");
  if (separator === -1 || encoded.includes(":", separator + 1)) return null;
  const encodedRoot = encoded.slice(0, separator);
  const encodedPath = encoded.slice(separator + 1);
  let rootPath: string;
  let path: string;
  try {
    rootPath = decodeURIComponent(encodedRoot);
    path = decodeURIComponent(encodedPath);
  } catch {
    // coercion-ok: an ID that doesn't decode names no folder, and callers refuse it as a parent.
    return null;
  }
  if (!rootPath || !relativeSegments(path)) return null;
  if (localSourceDirectoryId({ rootPath, path }) !== id) return null;
  return { rootPath, path };
}

export function parentLocalSourceDirectory(
  directory: LocalSourceDirectory,
): LocalSourceDirectory | null {
  const separator = directory.path.lastIndexOf("/");
  return separator === -1
    ? null
    : {
        rootPath: directory.rootPath,
        path: directory.path.slice(0, separator),
      };
}

export function localSourceDirectoryTitle(path: string) {
  return path.split("/").pop()?.replace(/[-_]+/g, " ") || path;
}
