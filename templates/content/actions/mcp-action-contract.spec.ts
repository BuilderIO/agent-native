import { describe, expect, it } from "vitest";

import addComment from "./add-comment.js";
import addContentDatabaseSourceFieldProperty from "./add-content-database-source-field-property.js";
import addDatabaseItem from "./add-database-item.js";
import connectNotionStatus from "./connect-notion-status.js";
import createDocument from "./create-document.js";
import deleteContentDatabase from "./delete-content-database.js";
import describeContentDatabase from "./describe-content-database.js";
import editDocument from "./edit-document.js";
import getContentDatabase from "./get-content-database.js";
import getDocument from "./get-document.js";
import listComments from "./list-comments.js";
import listContentDatabases from "./list-content-databases.js";
import listDocuments from "./list-documents.js";
import migrateContentDatabaseRows from "./migrate-content-database-rows.js";
import navigate from "./navigate.js";
import refreshList from "./refresh-list.js";
import searchDocuments from "./search-documents.js";
import updateComment from "./update-comment.js";
import updateDatabaseItem from "./update-database-item.js";
import updateDocument from "./update-document.js";
import upsertDatabaseItemByKey from "./upsert-database-item-by-key.js";
import viewScreen from "./view-screen.js";

describe("Content action-owned agent catalogs", () => {
  const directMcpActions = {
    "list-documents": listDocuments,
    "search-documents": searchDocuments,
    "get-document": getDocument,
    "create-document": createDocument,
    "edit-document": editDocument,
    "list-comments": listComments,
    "add-comment": addComment,
    "update-comment": updateComment,
    "list-content-databases": listContentDatabases,
    "describe-content-database": describeContentDatabase,
    "get-content-database": getContentDatabase,
    "add-database-item": addDatabaseItem,
    "update-database-item": updateDatabaseItem,
    "upsert-database-item-by-key": upsertDatabaseItemByKey,
  };

  const deferredDatabaseActions = {
    "add-content-database-source-field-property":
      addContentDatabaseSourceFieldProperty,
    "delete-content-database": deleteContentDatabase,
    "migrate-content-database-rows": migrateContentDatabaseRows,
  };

  it("owns compact MCP membership beside each directly callable action", () => {
    for (const action of Object.values(directMcpActions)) {
      expect(action.mcpTool).toBe(true);
      expect(action.tool.description.length).toBeGreaterThan(80);
    }
  });

  it("keeps schema, destructive, and migration actions out of compact MCP discovery", () => {
    for (const action of Object.values(deferredDatabaseActions)) {
      expect(action.mcpTool).not.toBe(true);
    }
  });

  it("classifies direct comment reads and writes for MCP authorization", () => {
    expect(listComments.readOnly).toBe(true);
    expect(addComment.readOnly).not.toBe(true);
    expect(updateComment.readOnly).not.toBe(true);
  });

  it("describes the identifiers required for safe comment-thread mutations", () => {
    expect(addComment.tool.description).toContain("threadId");
    expect(addComment.tool.description).toContain("both threadId and parentId");
    expect(updateComment.tool.description).toContain("exact");
    expect(updateComment.tool.description).toContain("mismatched pair");

    const addProperties = addComment.tool.parameters?.properties;
    const updateProperties = updateComment.tool.parameters?.properties;
    expect(listComments.tool.parameters?.required).toContain("documentId");
    expect(addComment.tool.parameters?.required).toEqual(
      expect.arrayContaining(["documentId", "content"]),
    );
    expect(addProperties?.documentId?.description).toBe("Document ID");
    expect(addProperties?.authorName).toBeUndefined();
    expect(addProperties?.threadId?.description).toContain("parentId");
    expect(updateProperties?.id?.description).toBe("Comment ID");
    expect(updateProperties?.documentId?.description).toBe("Document ID");
    expect(updateComment.tool.description).toContain(
      "calls without a mutation fail",
    );
  });

  it("describes a fresh, identifier-safe database read-to-write handoff", () => {
    expect(getContentDatabase.tool.description).toContain("mutation target");
    expect(getContentDatabase.tool.description).toContain(
      "membership id as itemId",
    );
    expect(getContentDatabase.tool.description).toContain(
      "document.id as documentId",
    );
    expect(getContentDatabase.tool.description).toContain(
      "rowRevision as expectedRowRevision",
    );

    const updateProperties = updateDatabaseItem.tool.parameters?.properties;
    expect(updateProperties?.itemId?.description).toContain(
      "never use the row page document ID",
    );
    expect(updateProperties?.documentId?.description).toContain(
      "distinct from itemId",
    );
    expect(updateDatabaseItem.tool.description).toContain("fresh schema");
    expect(updateDatabaseItem.tool.description).toContain(
      "preserves omitted properties",
    );
    expect(addDatabaseItem.tool.description).toContain("fresh idempotency key");
    expect(upsertDatabaseItemByKey.tool.description).toContain(
      "expectedRowRevision null only to assert the key is absent",
    );
  });

  it("keeps the existing Content starter surface action-owned", () => {
    const eagerActions = [
      viewScreen,
      listDocuments,
      searchDocuments,
      getDocument,
      createDocument,
      editDocument,
      updateDocument,
      addComment,
      listComments,
      refreshList,
      navigate,
      connectNotionStatus,
    ];

    for (const action of eagerActions) {
      expect(action.deferLoading).toBe(false);
    }
  });

  it("gives direct document writes agent-readable selection and input guidance", () => {
    expect(createDocument.tool.description).toContain("Create and persist");
    expect(createDocument.tool.description).toContain("edit-document");
    expect(editDocument.tool.description).toContain("Prefer this over");
    expect(editDocument.tool.description).toContain("match exactly");

    const createProperties = createDocument.tool.parameters?.properties;
    const editProperties = editDocument.tool.parameters?.properties;
    expect(createProperties?.content?.description).toContain("Markdown");
    expect(createProperties?.parentId?.description).toContain("root page");
    expect(editProperties?.find?.description).toContain("Exact");
    expect(editProperties?.edits?.description).toContain("ordered batch");
  });
});
