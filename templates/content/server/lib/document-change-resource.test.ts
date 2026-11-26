import { describe, expect, it } from "vitest";

import { documentChangeResource } from "./document-change-resource";

// Actions whose change events must reach collaborators who have the document
// open: their body, comments, and properties refresh without a reload.
const COLLABORATOR_VISIBLE_ACTIONS = [
  { name: "add-comment", documentKey: "documentId" },
  { name: "delete-comment", documentKey: "documentId" },
  { name: "edit-document", documentKey: "id" },
  { name: "react-to-comment", documentKey: "documentId" },
  { name: "restore-document-version", documentKey: "documentId" },
  { name: "set-document-property", documentKey: "documentId" },
  { name: "update-comment", documentKey: "documentId" },
  { name: "update-document", documentKey: "id" },
];

async function loadAction(name: string) {
  return (await import(`../../actions/${name}.ts`)).default;
}

describe("documentChangeResource", () => {
  it("scopes a change event to the document", () => {
    expect(documentChangeResource("doc-1")).toEqual({
      resourceType: "document",
      resourceId: "doc-1",
    });
  });

  it("scopes nothing when the call names no document", () => {
    expect(documentChangeResource(undefined)).toBeNull();
    expect(documentChangeResource("")).toBeNull();
  });

  it.each(COLLABORATOR_VISIBLE_ACTIONS)(
    "$name declares the document it changes",
    async ({ name, documentKey }) => {
      const action = await loadAction(name);
      expect(action.changeResource({ [documentKey]: "doc-1" }, {})).toEqual({
        resourceType: "document",
        resourceId: "doc-1",
      });
    },
  );

  it.each(["delete-comment", "update-comment"])(
    "%s falls back to the document its result names",
    async (name) => {
      const action = await loadAction(name);
      expect(action.changeResource({}, { documentId: "doc-2" })).toEqual({
        resourceType: "document",
        resourceId: "doc-2",
      });
    },
  );
});
