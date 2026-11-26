// @vitest-environment happy-dom

import type { DocumentProperty } from "@shared/api";
import { describe, expect, it } from "vitest";

import { queryByLabel, renderUi } from "@/test-utils/render-ui";

import { databaseTableCellDisplayValue } from "./DatabaseView";

function property(
  type: DocumentProperty["definition"]["type"],
  value: DocumentProperty["value"],
): DocumentProperty {
  return {
    definition: {
      id: "done",
      databaseId: "database",
      name: "Done",
      type,
      visibility: "always_show",
      options: {},
      position: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    value,
    editable: true,
  };
}

describe("table checkbox cells", () => {
  it("draws an empty box on a row whose checkbox was never set", () => {
    const { container } = renderUi(
      <>{databaseTableCellDisplayValue(property("checkbox", null))}</>,
    );

    expect(queryByLabel("Unchecked", container)).not.toBeNull();
  });

  it("draws an unset box the same as an unticked one", () => {
    const unset = renderUi(
      <>{databaseTableCellDisplayValue(property("checkbox", null))}</>,
    ).container.innerHTML;
    const unticked = renderUi(
      <>{databaseTableCellDisplayValue(property("checkbox", false))}</>,
    ).container.innerHTML;

    expect(unset).toBe(unticked);
  });

  it("draws a ticked box for a checked row", () => {
    const { container } = renderUi(
      <>{databaseTableCellDisplayValue(property("checkbox", true))}</>,
    );

    expect(queryByLabel("Checked", container)).not.toBeNull();
  });

  it("still leaves other empty cells blank", () => {
    const { container } = renderUi(
      <>{databaseTableCellDisplayValue(property("text", null))}</>,
    );

    expect(container.querySelector("[aria-label]")).toBeNull();
  });
});
