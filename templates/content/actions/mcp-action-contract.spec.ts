import { describe, expect, it } from "vitest";

import addComment from "./add-comment.js";
import connectNotionStatus from "./connect-notion-status.js";
import createDocument from "./create-document.js";
import describeContentDatabase from "./describe-content-database.js";
import editDocument from "./edit-document.js";
import getDocument from "./get-document.js";
import listComments from "./list-comments.js";
import listContentDatabases from "./list-content-databases.js";
import listDocuments from "./list-documents.js";
import navigate from "./navigate.js";
import refreshList from "./refresh-list.js";
import searchDocuments from "./search-documents.js";
import updateDocument from "./update-document.js";
import viewScreen from "./view-screen.js";

describe("Content action-owned agent catalogs", () => {
  const directMcpActions = {
    "list-documents": listDocuments,
    "search-documents": searchDocuments,
    "get-document": getDocument,
    "create-document": createDocument,
    "edit-document": editDocument,
    "list-content-databases": listContentDatabases,
    "describe-content-database": describeContentDatabase,
  };

  it("owns compact MCP membership beside each directly callable action", () => {
    for (const action of Object.values(directMcpActions)) {
      expect(action.mcpTool).toBe(true);
      expect(action.tool.description.length).toBeGreaterThan(80);
    }
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
