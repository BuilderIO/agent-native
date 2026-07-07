import { describe, expect, it } from "vitest";

import { propertyTypeForSourceField } from "./add-content-database-source-field-property.js";

describe("propertyTypeForSourceField", () => {
  it("maps constrained Builder tag lists to multi-select", () => {
    expect(
      propertyTypeForSourceField("list", {
        name: "topics",
        label: 'Topics (new, will override any "Topic")',
        type: "list",
        inputType: "tags",
        required: false,
        options: ["Headless CMS", "Governance &amp; Security"],
      }),
    ).toBe("multi_select");
  });

  it("keeps unknown Builder lists conservative", () => {
    expect(
      propertyTypeForSourceField("list", {
        name: "relatedLinks",
        type: "list",
        required: false,
      }),
    ).toBe("text");
  });
});
