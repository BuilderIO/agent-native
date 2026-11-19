import { describe, expect, it } from "vitest";

import { saveRevisionOf } from "../save-conflict/index.js";
import {
  RESOURCE_CONTENT_RECORD,
  resourceContentRevision,
} from "./revision.js";

describe("resourceContentRevision", () => {
  it("is the revision a browser computes from the same content", () => {
    expect(resourceContentRevision({ content: "# Todo" })).toBe(
      saveRevisionOf({ content: "# Todo" }),
    );
  });

  it("changes when the content does", () => {
    expect(resourceContentRevision({ content: "# Todo" })).not.toBe(
      resourceContentRevision({ content: "# Done" }),
    );
  });

  it("depends on the content alone, not where the file is", () => {
    const personal = {
      content: "same",
      path: "notes/a.md",
      owner: "alice@example.com",
    };
    const shared = { content: "same", path: "notes/b.md", owner: "__shared__" };

    expect(resourceContentRevision(personal)).toBe(
      resourceContentRevision(shared),
    );
  });

  it("counts its saves under the resource content record", () => {
    expect(RESOURCE_CONTENT_RECORD).toBe("resource_content");
  });
});
