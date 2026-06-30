import type { Document } from "@shared/api";

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

export function getDocumentSidebarSections(
  documents: Document[],
  treeDocuments: Document[] = documents,
) {
  const localFileMode = documents.some(isDirectLocalDocument);
  const localSourceDocuments = localFileMode
    ? treeDocuments.filter(isDirectLocalDocument)
    : treeDocuments.filter(isImportedLocalSourceDocument);
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
