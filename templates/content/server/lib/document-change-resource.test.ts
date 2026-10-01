import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { documentChangeResource } from "./document-change-resource";

const ACTIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../actions",
);

// Actions whose change events must reach collaborators who have the document
// open: their body, comments, and properties refresh without a reload.
const COLLABORATOR_VISIBLE_ACTIONS = [
  "add-comment",
  "delete-comment",
  "edit-document",
  "react-to-comment",
  "restore-document-version",
  "set-document-property",
  "update-comment",
  "update-document",
];

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
    "%s declares the document it changes",
    (name) => {
      const source = readFileSync(join(ACTIONS_DIR, `${name}.ts`), "utf8");
      expect(source).toMatch(
        /changeResource:\s*\(input\) =>\s*documentChangeResource\(/,
      );
    },
  );
});
