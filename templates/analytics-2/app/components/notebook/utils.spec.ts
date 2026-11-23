import { callAction } from "@agent-native/core/client/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CellContents } from "@/lib/model/contracts";

import {
  cellContentsWithText,
  editableCellText,
  toNotebookError,
} from "./utils";

const inputCell: CellContents = {
  id: "cel_input",
  order: "a0",
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
  kind: "input",
  name: "region",
  inputType: "TEXT_INPUT",
  defaultValueString: "EMEA",
};

describe("input cell text", () => {
  it("reads and writes the text input's stored default", () => {
    expect(editableCellText(inputCell)).toBe("EMEA");
    expect(cellContentsWithText(inputCell, "APAC")).toMatchObject({
      kind: "input",
      defaultValueString: "APAC",
      name: "region",
    });
  });
});

describe("notebook error display", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("presents the authored reason from an action rejection", async () => {
    const reason = "Check the SQL syntax and try again.";
    const details = { providerStatus: 400 };
    vi.stubGlobal("fetch", async () =>
      Response.json(
        { error: reason, errorCode: "warehouse_query_failed", details },
        { status: 422 },
      ),
    );

    const result = callAction("run-project-cell", {
      projectId: "proj",
      cellId: "cell",
    });
    await expect(result).rejects.toMatchObject({
      status: 422,
      actionMessage: reason,
      errorCode: "warehouse_query_failed",
      details,
    });
    expect(
      toNotebookError(await result.catch((cause: unknown) => cause)),
    ).toEqual({ message: reason, details: null });
  });

  it("falls back for a proxy response while preserving local error text", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("<html>Proxy failure</html>", { status: 502 }),
    );
    const error: unknown = await callAction("run-project-cell", {
      projectId: "proj",
      cellId: "cell",
    }).catch((cause: unknown) => cause);

    expect(toNotebookError(error).message).toBe("The request failed.");
    expect(
      toNotebookError(new Error("Save the cell before running it.")).message,
    ).toBe("Save the cell before running it.");
  });
});
