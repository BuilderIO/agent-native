import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as { input: unknown; caller: string | undefined }[],
}));

vi.mock("../server/model/data-table-details.js", () => ({
  getDataTableDetails: async (
    input: { connectionId: string; tableId: string },
    caller?: string,
  ) => {
    state.calls.push({ input, caller });
    return {
      connectionId: input.connectionId,
      table: {
        projectId: "qa-project",
        datasetId: "qa_dataset",
        tableId: "qa_table",
        name: "qa_table",
        type: "TABLE",
        description: null,
        numRows: null,
        numBytes: null,
        lastModifiedTime: null,
        columnCount: 0,
        columns: [],
      },
    };
  },
}));

import action from "./get-data-table-details.js";

describe("get-data-table-details transport", () => {
  it("is a read-only GET that does not persist inputs in the browser", () => {
    expect(action.http).toMatchObject({ method: "GET" });
    expect(action.readOnly).toBe(true);
    expect(action.persistInBrowser).toBe(false);
  });

  it("accepts only the connection and opaque table id", () => {
    expect(
      action.schema.safeParse({
        connectionId: "connection-qa",
        tableId: "table:qa-project:qa_dataset:qa_table",
      }).success,
    ).toBe(true);
    expect(
      action.schema.safeParse({
        connectionId: "connection-qa",
        tableId: "table:qa-project:qa_dataset:qa_table",
        forAgent: true,
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        connectionId: "",
        tableId: "table:qa-project:qa_dataset:qa_table",
      }).success,
    ).toBe(false);
  });

  it("forwards the real action caller context and treats a missing caller as unknown", async () => {
    const input = {
      connectionId: "connection-qa",
      tableId: "table:qa-project:qa_dataset:qa_table",
    };
    const agentResult = await action.run(input, {
      caller: "agent",
    } as never);
    expect(agentResult.connectionId).toBe("connection-qa");
    await action.run(input, {} as never);
    expect(state.calls).toEqual([
      { input, caller: "agent" },
      { input, caller: undefined },
    ]);
  });
});
