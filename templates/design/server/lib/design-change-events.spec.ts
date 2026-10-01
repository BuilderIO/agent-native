import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ recordChange: vi.fn() }));

vi.mock("@agent-native/core/server/poll", () => ({
  recordChange: mocks.recordChange,
}));

import { publishesDesignChange } from "./design-change-events.js";

const headers = (requestSource?: string) =>
  ({
    get: (name: string) =>
      name === "x-request-source" ? (requestSource ?? null) : null,
  }) as unknown as Headers;

describe("design-mutating actions", () => {
  it.each([
    "update-design",
    "create-file",
    "delete-file",
    "rename-screen",
    "add-breakpoint",
    "remove-breakpoint",
    "add-localhost-screens",
    "update-screen-source",
    "update-visual-edit-collaboration",
  ])("%s announces its change to collaborators", (name) => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "..", "actions", `${name}.ts`),
      "utf8",
    );
    expect(source).toMatch(/export default publishesDesignChange\(/);
  });
});

const stub = (run: (params?: any, context?: any) => unknown) => ({ run });

describe("publishesDesignChange", () => {
  beforeEach(() => {
    mocks.recordChange.mockClear();
  });

  it("scopes the change to the design so collaborators, not just the caller, are notified", async () => {
    const action = publishesDesignChange(
      stub(async () => ({ changed: true })),
      { designId: (p) => p.id },
    );
    await action.run({ id: "d1" }, { requestHeaders: headers("tab-a") });
    expect(mocks.recordChange).toHaveBeenCalledWith({
      source: "design",
      type: "design-changed",
      key: "d1",
      resourceType: "design",
      resourceId: "d1",
      requestSource: "tab-a",
    });
  });

  it("reads the design from the result when the call is keyed by file id", async () => {
    const action = publishesDesignChange(
      stub(async () => ({ deleted: true, designId: "d9" })),
      { designId: (_params, result) => result.designId },
    );
    await action.run({ id: "f1" });
    expect(mocks.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: "d9" }),
    );
  });

  it.each([{ stale: true }, { changed: false }, { deleted: false }])(
    "stays quiet when the action reports nothing changed (%o)",
    async (result) => {
      const action = publishesDesignChange(
        stub(async () => result),
        { designId: (p) => p.id },
      );
      await action.run({ id: "d1" });
      expect(mocks.recordChange).not.toHaveBeenCalled();
    },
  );

  it("does not announce a change when the action throws", async () => {
    const action = publishesDesignChange(
      stub(async () => {
        throw new Error("write failed");
      }),
      { designId: (p) => p.id },
    );
    await expect(action.run({ id: "d1" })).rejects.toThrow("write failed");
    expect(mocks.recordChange).not.toHaveBeenCalled();
  });
});
