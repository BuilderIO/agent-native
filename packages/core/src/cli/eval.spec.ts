import { afterEach, describe, expect, it, vi } from "vitest";

import { parseEvalArgs } from "./eval.js";

describe("parseEvalArgs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps run-mode pattern parsing when argv[0] is not promote", () => {
    expect(parseEvalArgs(["greeting", "--json"])).toEqual({
      command: "run",
      pattern: "greeting",
      json: true,
      threshold: undefined,
    });
    expect(parseEvalArgs(["--threshold", "0.8"])).toEqual({
      command: "run",
      pattern: undefined,
      json: false,
      threshold: 0.8,
    });
    expect(parseEvalArgs(["promote-me"])).toEqual({
      command: "run",
      pattern: "promote-me",
      json: false,
      threshold: undefined,
    });
  });

  it("parses promote <runId> [--write] [--json] [--must-contain]", () => {
    expect(
      parseEvalArgs([
        "promote",
        "run-1",
        "--write",
        "evals/from-trace.eval.ts",
        "--json",
        "--must-contain",
        "30 days",
      ]),
    ).toEqual({
      command: "promote",
      runId: "run-1",
      write: "evals/from-trace.eval.ts",
      json: true,
      mustContain: "30 days",
    });
  });

  it("refuses promote --write without a runId", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      parseEvalArgs(["promote", "--write", "evals/from-trace.eval.ts"]),
    ).toThrow("process.exit(2)");
    expect(exit).toHaveBeenCalledWith(2);
  });

  it("refuses promote with no runId", () => {
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => parseEvalArgs(["promote"])).toThrow("process.exit(2)");
  });
});
