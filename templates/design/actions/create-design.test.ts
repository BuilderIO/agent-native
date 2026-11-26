import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const designsTable = { id: "design_id" };
  const state = {
    userEmail: "owner@example.com" as string | null,
    orgId: null as string | null,
    insertedRow: undefined as Record<string, unknown> | undefined,
  };
  const valuesFn = vi.fn(async (row: Record<string, unknown>) => {
    state.insertedRow = row;
  });
  const insertFn = vi.fn(() => ({ values: valuesFn }));
  const mockDb = { insert: insertFn };

  return { state, designsTable, mockDb };
});

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.mockDb,
  schema: { designs: mocks.designsTable },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: () => undefined,
  getRequestUserEmail: () => mocks.state.userEmail,
  getRequestOrgId: () => mocks.state.orgId,
}));

const track = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/tracking", () => ({ track }));

import action from "./create-design";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.userEmail = "owner@example.com";
  mocks.state.orgId = null;
  mocks.state.insertedRow = undefined;
  track.mockReset();
});

// oracle-change: Design Systems removed from Design; its assertions no longer apply
describe("create-design — legacy design system input", () => {
  it("ignores a designSystemId or designSystem an older caller still sends", async () => {
    const input = action.schema.parse({
      title: "T",
      designSystemId: "ds-old",
      designSystem: "Acme",
    });

    const result = await action.run(input);

    expect(mocks.state.insertedRow).not.toHaveProperty("designSystemId");
    expect(result).not.toHaveProperty("designSystemId");
    expect(result).not.toHaveProperty("designSystem");
  });
});

describe("create-design — design_created", () => {
  const createdEvents = () =>
    track.mock.calls.filter(([name]) => name === "design_created");

  it("fires once after the insert with the creation method the caller passed", async () => {
    const result = await action.run({ title: "T", creationMethod: "prompt" }, {
      caller: "frontend",
      actionName: "create-design",
    } as never);

    expect(createdEvents()).toHaveLength(1);
    expect(createdEvents()[0]![1]).toMatchObject({
      output_id: result.id,
      output_type: "design",
      creation_method: "prompt",
      project_type: "prototype",
      app_name: "design",
      caller: "frontend",
    });
    expect(mocks.state.insertedRow).not.toHaveProperty("creationMethod");
  });

  it("defaults an unlabelled UI create to blank and any other caller to agent", async () => {
    await action.run({ title: "T" }, {
      caller: "frontend",
      actionName: "create-design",
    } as never);
    await action.run({ title: "T" }, {
      caller: "tool",
      actionName: "create-design",
    } as never);
    await action.run({ title: "T" });

    expect(
      createdEvents().map(([, properties]) => properties.creation_method),
    ).toEqual(["blank", "agent", "agent"]);
  });

  it("does not fire when the insert fails", async () => {
    mocks.mockDb.insert.mockImplementationOnce(() => ({
      values: async () => {
        throw new Error("insert failed");
      },
    }));

    await expect(action.run({ title: "T" })).rejects.toThrow("insert failed");
    expect(createdEvents()).toHaveLength(0);
  });

  it("returns the created design when tracking throws", async () => {
    track.mockImplementation(() => {
      throw new Error("analytics down");
    });

    const result = await action.run({ title: "T" });

    expect(result.id).toBe(mocks.state.insertedRow?.id);
    expect(track).toHaveBeenCalledTimes(1);
  });
});
