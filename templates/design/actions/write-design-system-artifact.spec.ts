import { beforeEach, describe, expect, it, vi } from "vitest";
const write = vi.hoisted(() => vi.fn());
vi.mock("../server/lib/design-system-authoring.js", () => ({
  designSystemAuthoring: { write },
}));
import action from "./write-design-system-artifact.js";

beforeEach(() => {
  vi.clearAllMocks();
  write.mockImplementation(async (args) => ({ persisted: args }));
});
describe("actual artifact action tool contract", () => {
  it("advertises mandatory content and passes actual foundation values to the writer", async () => {
    expect(action.tool.parameters?.required).toContain("content");
    const result = await action.run({
      id: "system",
      targetId: "typography",
      expectedRevision: 0,
      operationId: "write-typography",
      name: "Typography",
      provenance: "generated",
      sourceIds: [],
      content: {
        kind: "foundation",
        tokens: [
          { name: "headingFont", value: "Inter" },
          { name: "headingSizes.h1", value: "48px" },
        ],
      },
    });
    expect(result.persisted).toMatchObject({
      kind: "foundation",
      values: { headingFont: "Inter", "headingSizes.h1": "48px" },
    });
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("rejects missing payload before any storage write", async () => {
    await expect(
      action.run({
        id: "system",
        targetId: "typography",
        expectedRevision: 0,
        operationId: "missing",
        name: "Typography",
        provenance: "generated",
        sourceIds: [],
        content: { kind: "foundation" },
      } as never),
    ).rejects.toThrow(/tokens/);
    expect(write).not.toHaveBeenCalled();
  });
  it("rejects unsupported extracted attribution before calling storage", async () => {
    await expect(
      action.run({
        id: "system",
        targetId: "colors",
        expectedRevision: 0,
        operationId: "false-extracted",
        name: "Colors",
        provenance: "extracted",
        sourceIds: ["website"],
        content: {
          kind: "foundation",
          tokens: [{ name: "surface", value: "#ffffff" }],
        },
      } as never),
    ).rejects.toThrow(/provenance/);
    expect(write).not.toHaveBeenCalled();
  });
});
