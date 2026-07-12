import type { Document } from "@shared/api";

const IMPORTED_LOCAL_SOURCE_FOLDER_ID_PREFIX = "local-source-folder:";

export function isDirectLocalDocument(
  document: Pick<Document, "id" | "source">,
) {
  return (
    document.source?.mode === "local-files" &&
    (document.id.startsWith("local-file:") ||
      document.id.startsWith("local-folder:"))
  );
}

export function isImportedLocalSourceDocument(
  document: Pick<Document, "id" | "source">,
) {
  return (
    document.source?.mode === "local-files" && !isDirectLocalDocument(document)
  );
}

function importedLocalSourceFolderId(rootPath: string) {
  return `${IMPORTED_LOCAL_SOURCE_FOLDER_ID_PREFIX}${encodeURIComponent(rootPath)}`;
}

function importedLocalSourceFolderTitle(rootPath: string) {
  return (
    rootPath
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/\.(mdx?|markdown)$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase()) || "Local folder"
  );
}

function importedLocalSourceRootPath(document: Document) {
  const sourcePath = document.source?.path;
  const rootPath = document.source?.rootPath;
  if (!sourcePath || !rootPath) return null;
  if (sourcePath === rootPath || !sourcePath.startsWith(`${rootPath}/`)) {
    return null;
  }
  return rootPath;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function dedupeImportedLocalSourceDocuments(documents: Document[]) {
  const seen = new Set<string>();
  const deduped: Document[] = [];

  for (const document of documents) {
    const key = document.source?.path ?? document.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(document);
  }

  return deduped;
}

function withImportedLocalSourceFolders(documents: Document[]) {
  const importedDocuments = dedupeImportedLocalSourceDocuments(documents);
  const documentIds = new Set(importedDocuments.map((document) => document.id));
  const rootPaths = [
    ...new Set(
      importedDocuments.map(importedLocalSourceRootPath).filter(isString),
    ),
  ];

  if (rootPaths.length === 0) return importedDocuments;

  const folderDocuments = rootPaths.map<Document>((rootPath, index) => ({
    id: importedLocalSourceFolderId(rootPath),
    parentId: null,
    title: importedLocalSourceFolderTitle(rootPath),
    content: "",
    icon: null,
    position: index,
    isFavorite: false,
    hideFromSearch: false,
    visibility: "private",
    accessRole: "viewer",
    canEdit: false,
    canManage: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    source: {
      mode: "local-files",
      kind: "folder",
      path: rootPath,
      rootPath,
    },
  }));

  const folderIdByRootPath = new Map(
    rootPaths.map((rootPath) => [
      rootPath,
      importedLocalSourceFolderId(rootPath),
    ]),
  );
  const groupedDocuments = importedDocuments.map((document) => {
    const rootPath = importedLocalSourceRootPath(document);
    const folderId = rootPath ? folderIdByRootPath.get(rootPath) : undefined;
    if (
      !folderId ||
      (document.parentId && documentIds.has(document.parentId))
    ) {
      return document;
    }
    return {
      ...document,
      parentId: folderId,
    };
  });

  return [...folderDocuments, ...groupedDocuments];
}

export function getDocumentSidebarSections(
  documents: Document[],
  treeDocuments: Document[] = documents,
) {
  const localFileMode = documents.some(isDirectLocalDocument);
  const localSourceDocuments = localFileMode
    ? treeDocuments.filter(isDirectLocalDocument)
    : withImportedLocalSourceFolders(
        treeDocuments.filter(isImportedLocalSourceDocument),
      );
  const databaseDocuments = localFileMode
    ? treeDocuments.filter((document) => !isDirectLocalDocument(document))
    : treeDocuments.filter(
        (document) => !isImportedLocalSourceDocument(document),
      );
  const favorites = documents.filter(
    (document) =>
      document.isFavorite &&
      (localFileMode || !isImportedLocalSourceDocument(document)),
  );

  return {
    localFileMode,
    localSourceDocuments,
    databaseDocuments,
    favorites,
    showFavorites: favorites.length > 0,
  };
}
