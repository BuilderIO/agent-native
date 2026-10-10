import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSourceWorkspace: vi.fn(),
  loadSelectedSourceWorkspaceFile: vi.fn(),
  readLiveSourceFile: vi.fn(),
  writeInlineSourceFile: vi.fn(),
  snapshotDesignBeforeAgentEdit: vi.fn(),
  readAppState: vi.fn(),
  compareAndSetAppState: vi.fn(),
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
  compareAndSetAppState: mocks.compareAndSetAppState,
}));
vi.mock("../server/source-workspace.js", () => ({
  resolveSourceWorkspace: mocks.resolveSourceWorkspace,
  loadSelectedSourceWorkspaceFile: mocks.loadSelectedSourceWorkspaceFile,
  readLiveSourceFile: mocks.readLiveSourceFile,
  writeInlineSourceFile: mocks.writeInlineSourceFile,
  SourceWorkspaceEditConflictError: class extends Error {},
}));
vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: mocks.snapshotDesignBeforeAgentEdit,
}));
import action from "./edit-native-shader.js";

describe("native timing action input", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });
  it.each(["apply", "apply-many", "playback"] as const)(
    "rejects f32-overflow timing in the %s input schema before source work",
    (kind) => {
      for (const field of ["time", "speed"] as const) {
        for (const value of [
          1e40,
          Number.MAX_VALUE,
          Number.POSITIVE_INFINITY,
          Number.NaN,
        ]) {
          const operation =
            kind === "playback"
              ? { kind, instanceId: "timed", [field]: value }
              : {
                  kind,
                  nodeId: "hero",
                  nodeIds: ["hero", "second"],
                  placement: "fill",
                  timing: { time: 0, speed: 1, paused: false, [field]: value },
                };
          const parsed = action.schema.safeParse({
            designId: "design-1",
            fileId: "file-1",
            expectedVersionHash: "hash-1",
            operation,
          });
          expect(parsed.success).toBe(false);
          if (parsed.success) throw new Error("Expected invalid timing schema");
          expect(
            parsed.error.issues.some((issue) => issue.path.at(-1) === field),
          ).toBe(true);
        }
      }
      expect(mocks.resolveSourceWorkspace).not.toHaveBeenCalled();
      expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
      expect(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
    },
  );
});
