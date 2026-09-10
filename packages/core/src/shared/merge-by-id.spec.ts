import { describe, expect, it } from "vitest";

import { mergeDefinitionsById } from "./merge-by-id.js";

describe("mergeDefinitionsById", () => {
  it("replaces matching defaults without dropping the rest", () => {
    expect(
      mergeDefinitionsById(
        [
          { id: "slack", label: "Slack" },
          { id: "email", label: "Email" },
        ],
        [{ id: "slack", label: "Acme Slack" }],
      ),
    ).toEqual([
      { id: "slack", label: "Acme Slack" },
      { id: "email", label: "Email" },
    ]);
  });

  it("appends new definitions in override order", () => {
    expect(
      mergeDefinitionsById(
        [{ id: "slack" }],
        [{ id: "custom" }, { id: "another" }],
      ).map((definition) => definition.id),
    ).toEqual(["slack", "custom", "another"]);
  });
});
