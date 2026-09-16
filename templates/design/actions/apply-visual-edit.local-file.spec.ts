import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
}));

vi.mock("./read-local-file.js", () => ({
  default: { run: mocks.read },
}));
vi.mock("./write-local-file.js", () => ({
  default: { run: mocks.write },
}));

import action from "./apply-visual-edit.js";

const content = [
  "export function Card() {",
  "  return (",
  '    <h2 className="text-sm">Old title</h2>',
  "  );",
  "}",
].join("\n");

const source = {
  kind: "local-file" as const,
  designId: "design_example",
  connectionId: "connection_example",
  path: "src/Card.tsx",
};

const intent = {
  kind: "textContent" as const,
  target: {
    sourceAnchor: {
      line: 3,
      column: 5,
      scope: "single-instance" as const,
      runtimeMultiplicity: 1,
    },
  },
  value: "New title",
};

describe("apply-visual-edit localhost source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.read.mockResolvedValue({
      content,
      versionHash: "a".repeat(64),
    });
    mocks.write.mockResolvedValue({
      written: true,
      versionHash: "b".repeat(64),
    });
  });

  it("returns a proposed diff without writing by default", async () => {
    const result = await action.run({ source, intent });
    expect(result).toMatchObject({
      persisted: false,
      result: { status: "applied", changed: true },
    });
    expect(result.proposedDiff).toBeDefined();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("persists through write-local-file with exact optimistic concurrency", async () => {
    const result = await action.run({ source, intent, persist: true });
    expect(result.persisted).toBe(true);
    expect(mocks.write).toHaveBeenCalledWith({
      designId: "design_example",
      connectionId: "connection_example",
      relPath: "src/Card.tsx",
      content: expect.stringContaining("New title"),
      expectedVersionHash: "a".repeat(64),
      requireExpectedVersionHash: true,
    });
  });

  it("does not bypass write-local-file consent failures", async () => {
    mocks.write.mockRejectedValueOnce(
      new Error("A valid write-consent grant is required."),
    );
    await expect(action.run({ source, intent, persist: true })).rejects.toThrow(
      /write-consent grant/,
    );
  });

  it("fails closed for structural intents before reading or writing", async () => {
    const result = await action.run({
      source,
      intent: {
        kind: "moveNode",
        target: { sourceAnchor: intent.target.sourceAnchor },
        anchor: { selector: "main" },
        placement: "inside",
      },
      persist: true,
    });
    expect(result.result.status).toBe("needsAgent");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("keeps remote URLs unsupported and never reads the local bridge", async () => {
    const result = await action.run({
      source: { kind: "remote-url", url: "https://example.test/card" },
      intent: { ...intent, target: { selector: "h2" } },
    });
    expect(result.result.status).toBe("unsupported");
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("rejects generated output paths before reading or writing", async () => {
    const result = await action.run({
      source: { ...source, path: "dist/Card.js" },
      intent,
      persist: true,
    });
    expect(result.result.status).toBe("unsupported");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
