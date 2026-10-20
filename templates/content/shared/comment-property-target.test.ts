import { describe, expect, it } from "vitest";

import type { DocumentProperty } from "./api";
import {
  COMMENT_PROPERTY_VALUE_MAX_LENGTH,
  commentPropertyTarget,
  commentPropertyValueText,
} from "./comment-property-target";

function property(
  type: string,
  value: unknown,
  extra: Partial<DocumentProperty> & { options?: object } = {},
): DocumentProperty {
  const { options, ...rest } = extra;
  return {
    definition: {
      id: "prop-1",
      name: "Status",
      type,
      options: options ?? {},
    },
    value,
    editable: true,
    ...rest,
  } as DocumentProperty;
}

const statusOptions = {
  options: [
    { id: "opt-blocked", name: "Blocked", color: "red" },
    { id: "opt-done", name: "Done", color: "green" },
  ],
};

describe("commentPropertyValueText", () => {
  it("names select and status options instead of their IDs", () => {
    expect(
      commentPropertyValueText(
        property("status", "opt-blocked", { options: statusOptions }),
      ),
    ).toBe("Blocked");
    expect(
      commentPropertyValueText(
        property("multi_select", ["opt-done", "opt-blocked"], {
          options: statusOptions,
        }),
      ),
    ).toBe("Done, Blocked");
  });

  it("shows the linked rows this viewer can see, and file names", () => {
    expect(
      commentPropertyValueText(
        property("relation", ["doc-a", "doc-hidden", "doc-b"], {
          relationTargets: [
            { documentId: "doc-a", title: "Launch" },
            { documentId: "doc-b", title: "" },
          ] as DocumentProperty["relationTargets"],
        }),
      ),
    ).toBe("Launch, Untitled");
    expect(
      commentPropertyValueText(
        property("files_media", [
          "https://cdn.example.test/uploads/Q3%20plan.pdf?v=2",
        ]),
      ),
    ).toBe("Q3 plan.pdf");
  });

  it("reads checkboxes, numbers, and empty values plainly", () => {
    expect(commentPropertyValueText(property("checkbox", true))).toBe(
      "Checked",
    );
    expect(commentPropertyValueText(property("checkbox", false))).toBe(
      "Unchecked",
    );
    expect(commentPropertyValueText(property("number", 5))).toBe("5");
    expect(commentPropertyValueText(property("text", ""))).toBe("");
    expect(commentPropertyValueText(property("text", null))).toBe("");
  });

  it("keeps a long value short", () => {
    const text = commentPropertyValueText(property("text", "a".repeat(500)));
    expect(text).toHaveLength(COMMENT_PROPERTY_VALUE_MAX_LENGTH);
    expect(text.endsWith("…")).toBe(true);
  });

  it("records the Property's ID, name, and value", () => {
    expect(
      commentPropertyTarget(
        property("status", "opt-done", { options: statusOptions }),
      ),
    ).toEqual({
      propertyId: "prop-1",
      propertyName: "Status",
      propertyValue: "Done",
    });
  });

  it("records no value for Properties that read differently for each reader", () => {
    for (const type of ["relation", "rollup", "formula"]) {
      expect(
        commentPropertyTarget(
          property(type, ["doc-a"], {
            relationTargets: [
              { documentId: "doc-a", title: "Launch" },
            ] as DocumentProperty["relationTargets"],
          }),
        ).propertyValue,
      ).toBeNull();
    }
  });
});
