import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import addProjectCell from "./add-project-cell.js";

async function normalizeOptionalToolPlaceholders() {
  const actionEntry = createRequire(import.meta.url).resolve(
    "@agent-native/core/action",
  );
  const module = (await import(
    /* @vite-ignore */ pathToFileURL(
      join(dirname(actionEntry), "agent", "optional-placeholders.js"),
    ).href
  )) as typeof import("@agent-native/core/dist/agent/optional-placeholders.js");
  return module.normalizeOptionalToolPlaceholders;
}

describe("add-project-cell padded tool input", () => {
  it("treats empty strings on unused optional fields as padding, not a mixed clear", async () => {
    const normalize = await normalizeOptionalToolPlaceholders();
    const repaired = normalize(
      addProjectCell.tool.parameters,
      {
        projectId: "project-1",
        kind: "sql",
        afterCellId: "",
        name: "",
        source: "",
      },
      addProjectCell,
    );
    expect(repaired.error).toBeUndefined();
    expect(repaired.input).toEqual({ projectId: "project-1", kind: "sql" });
  });

  it("treats an empty dataframe as padding next to other empty strings", async () => {
    const normalize = await normalizeOptionalToolPlaceholders();
    const repaired = normalize(
      addProjectCell.tool.parameters,
      { projectId: "project-1", kind: "chart", afterCellId: "", dataframe: "" },
      addProjectCell,
    );
    expect(repaired.error).toBeUndefined();
    expect(repaired.input).toEqual({ projectId: "project-1", kind: "chart" });
  });
});
