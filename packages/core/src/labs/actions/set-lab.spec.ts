import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setUserLabStates: vi.fn() }));

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string) => {
    throw new Error(message);
  },
}));
vi.mock("../registry.js", () => ({
  getLabDefinition: (key: string) =>
    key === "clips.editor" ? { key } : undefined,
}));
vi.mock("../store.js", () => mocks);

const action = (await import("./set-lab.js")).default;

beforeEach(() => {
  mocks.setUserLabStates.mockReset();
});

describe("set-lab action", () => {
  it("preserves boolean values and exposes typed per-Lab states", async () => {
    const states = {
      "clips.editor": { enabled: true, source: "choice", mixed: false },
      "clips.meetings": { enabled: false, source: "default", mixed: false },
      "design.builder": { error: "legacy-unavailable" },
    } as const;
    mocks.setUserLabStates.mockResolvedValue(states);

    await expect(
      action.run(
        { key: "clips.editor", enabled: true },
        { userEmail: "alice@example.com", orgId: "org-1" },
      ),
    ).resolves.toEqual({
      key: "clips.editor",
      enabled: true,
      values: { "clips.editor": true, "clips.meetings": false },
      states,
    });
  });

  it("clears a saved choice when enabled is null", async () => {
    const states = {
      "clips.editor": { enabled: false, source: "default", mixed: false },
    } as const;
    mocks.setUserLabStates.mockResolvedValue(states);

    expect(action.schema.parse({ key: "clips.editor", enabled: null })).toEqual(
      { key: "clips.editor", enabled: null },
    );
    await expect(
      action.run(
        { key: "clips.editor", enabled: null },
        { userEmail: "alice@example.com", orgId: "org-1" },
      ),
    ).resolves.toEqual({
      key: "clips.editor",
      enabled: false,
      values: { "clips.editor": false },
      states,
    });
    expect(mocks.setUserLabStates).toHaveBeenCalledWith(
      "alice@example.com",
      "clips.editor",
      null,
      { orgId: "org-1" },
    );
  });

  it("reports a cleared lab whose legacy flags can't be read as off, without failing the saved clear", async () => {
    const states = {
      "clips.editor": { error: "legacy-unavailable" },
    } as const;
    mocks.setUserLabStates.mockResolvedValue(states);

    await expect(
      action.run(
        { key: "clips.editor", enabled: null },
        { userEmail: "alice@example.com" },
      ),
    ).resolves.toEqual({
      key: "clips.editor",
      enabled: false,
      values: {},
      states,
    });
  });
});
