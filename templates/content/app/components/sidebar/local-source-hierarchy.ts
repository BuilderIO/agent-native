import type { ContentDatabaseItem, DocumentProperty } from "@shared/api";

const LOCAL_SOURCE_DIRECTORY_PREFIX = "local-source-directory:";

function normalizedSourcePath(path: string | undefined) {
  const normalized = (path ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return normalized;
}

function parentPath(path: string) {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator);
}

function sourceIds(item: ContentDatabaseItem) {
  const value = item.properties.find(
    (property) => property.definition.systemRole === "files_source",
  )?.value;
  return Array.isArray(value)
    ? value.filter(
        (candidate): candidate is string =>
          typeof candidate === "string" && candidate !== "local",
      )
    : [];
}

export function localSourceItemIdentity(item: ContentDatabaseItem) {
  return sourceIds(item)[0] ?? item.document.source?.rootPath ?? null;
}

function directoryId(sourceIdentity: string, path: string) {
  return `${LOCAL_SOURCE_DIRECTORY_PREFIX}${encodeURIComponent(sourceIdentity)}:${encodeURIComponent(path)}`;
}

function systemProperties(
  item: ContentDatabaseItem,
  sourceIdentity: string,
  parentId: string | null,
): DocumentProperty[] {
  return item.properties
    .filter((property) => property.definition.systemRole)
    .map((property) => {
      if (property.definition.systemRole === "files_parent") {
        return { ...property, value: parentId, editable: false };
      }
      if (property.definition.systemRole === "files_source") {
        return { ...property, value: [sourceIdentity], editable: false };
      }
      return { ...property, editable: false };
    });
}

function directoryItem(
  template: ContentDatabaseItem,
  sourceIdentity: string,
  path: string,
  position: number,
): ContentDatabaseItem {
  const parent = parentPath(path);
  const parentId = parent ? directoryId(sourceIdentity, parent) : null;
  const id = directoryId(sourceIdentity, path);
  return {
    id,
    databaseId: template.databaseId,
    document: {
      ...template.document,
      id,
      parentId,
      title: path.split("/").pop()?.replace(/[-_]+/g, " ") || path,
      content: "",
      description: "",
      icon: null,
      position,
      isFavorite: false,
      hideFromSearch: true,
      accessRole: "viewer",
      canView: true,
      canComment: false,
      canEdit: false,
      canManage: false,
      databaseMembership: undefined,
      source: {
        mode: "local-files",
        kind: "folder",
        path,
        rootPath: template.document.source?.rootPath,
      },
    },
    position,
    properties: systemProperties(template, sourceIdentity, parentId),
  };
}

export interface LocalSourceHierarchySelection {
  sourceId?: string | null;
  rootPath?: string | null;
}

export function firstLocalSourceDocumentId(items: ContentDatabaseItem[]) {
  return items.find(
    (item) =>
      item.document.source?.mode === "local-files" &&
      item.document.source.kind !== "folder",
  )?.document.id;
}

export function projectLocalSourceHierarchy(
  items: ContentDatabaseItem[],
  selection: LocalSourceHierarchySelection = {},
) {
  const localFiles = items.filter((item) => {
    if (
      item.document.source?.mode !== "local-files" ||
      item.document.source.kind === "folder"
    ) {
      return false;
    }
    if (selection.sourceId) {
      return sourceIds(item).includes(selection.sourceId);
    }
    if (selection.rootPath) {
      return item.document.source.rootPath === selection.rootPath;
    }
    return true;
  });
  const retained = items.filter(
    (item) => item.document.source?.mode !== "local-files",
  );
  const directories = new Map<
    string,
    { template: ContentDatabaseItem; sourceIdentity: string; path: string }
  >();
  const projectedFiles: ContentDatabaseItem[] = [];

  for (const item of localFiles) {
    const path = normalizedSourcePath(item.document.source?.path);
    const sourceIdentity =
      selection.sourceId && sourceIds(item).includes(selection.sourceId)
        ? selection.sourceId
        : localSourceItemIdentity(item);
    if (!path || !sourceIdentity) continue;
    const folder = parentPath(path);
    if (folder) {
      const parts = folder.split("/");
      for (let index = 1; index <= parts.length; index += 1) {
        const directoryPath = parts.slice(0, index).join("/");
        directories.set(`${sourceIdentity}\0${directoryPath}`, {
          template: item,
          sourceIdentity,
          path: directoryPath,
        });
      }
    }
    const parentId = folder ? directoryId(sourceIdentity, folder) : null;
    projectedFiles.push({
      ...item,
      document: { ...item.document, parentId },
      properties: item.properties.map((property) =>
        property.definition.systemRole === "files_parent"
          ? { ...property, value: parentId }
          : property,
      ),
    });
  }

  const projectedDirectories = [...directories.values()]
    .sort((left, right) =>
      left.sourceIdentity === right.sourceIdentity
        ? left.path.localeCompare(right.path)
        : left.sourceIdentity.localeCompare(right.sourceIdentity),
    )
    .map((directory, index) =>
      directoryItem(
        directory.template,
        directory.sourceIdentity,
        directory.path,
        index,
      ),
    );

  return [...retained, ...projectedDirectories, ...projectedFiles];
}
