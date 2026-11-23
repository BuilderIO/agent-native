import { describe, expect, it, vi } from "vitest";

import {
  resourceTargetsHost,
  setsExecutionTarget,
} from "./execution-target.js";

describe("setsExecutionTarget", () => {
  it("reads camelCase or snake_case keys by style", () => {
    expect(setsExecutionTarget({ executionHostId: "h" }, "camel")).toBe(true);
    expect(setsExecutionTarget({ execution_host_id: "h" }, "camel")).toBe(
      false,
    );
    expect(setsExecutionTarget({ execution_cwd: "/x" }, "snake")).toBe(true);
    expect(setsExecutionTarget({ executionCwd: "/x" }, "snake")).toBe(false);
    expect(setsExecutionTarget({ executionEngine: "codex" }, "camel")).toBe(
      true,
    );
  });

  it("ignores absent, null, and blank values", () => {
    expect(setsExecutionTarget({}, "camel")).toBe(false);
    expect(
      setsExecutionTarget(
        { executionHostId: null, executionEngine: undefined },
        "camel",
      ),
    ).toBe(false);
    expect(
      setsExecutionTarget(
        { executionHostId: "", executionCwd: "   " },
        "camel",
      ),
    ).toBe(false);
    expect(setsExecutionTarget({ execution_engine: " \n" }, "snake")).toBe(
      false,
    );
  });

  it("treats non-string values as setting a target", () => {
    expect(setsExecutionTarget({ executionHostId: 0 }, "camel")).toBe(true);
    expect(setsExecutionTarget({ execution_cwd: {} }, "snake")).toBe(true);
    expect(setsExecutionTarget({ executionEngine: false }, "camel")).toBe(true);
  });
});

describe("resourceTargetsHost", () => {
  it("is true when the job names an execution host", () => {
    expect(
      resourceTargetsHost(
        "---\nschedule: '0 9 * * *'\nenabled: true\nexecutionHostId: host-1\n---\nbody",
      ),
    ).toBe(true);
  });

  it("is false for a job without an execution host", () => {
    expect(
      resourceTargetsHost(
        "---\nschedule: '0 9 * * *'\nenabled: true\n---\nbody",
      ),
    ).toBe(false);
    expect(resourceTargetsHost("no frontmatter")).toBe(false);
  });

  it("is true when the content cannot be parsed", async () => {
    vi.resetModules();
    vi.doMock("./frontmatter.js", () => ({
      parseJobResource: () => {
        throw new Error("bad frontmatter");
      },
    }));
    const mod = await import("./execution-target.js");
    expect(mod.resourceTargetsHost("---\nx\n---")).toBe(true);
    vi.doUnmock("./frontmatter.js");
  });
});
