import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
}));
const promotion = vi.hoisted(() => ({
  loadTraceEvalPromotion: vi.fn(),
  persistPromotedEvalDataset: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: fsMock,
  mkdir: fsMock.mkdir,
  writeFile: fsMock.writeFile,
  rename: fsMock.rename,
  rm: fsMock.rm,
}));
vi.mock("../observability/actions/promote-trace-eval.js", () => ({
  loadTraceEvalPromotion: (...args: unknown[]) =>
    promotion.loadTraceEvalPromotion(...args),
  persistPromotedEvalDataset: (...args: unknown[]) =>
    promotion.persistPromotedEvalDataset(...args),
}));

import { parseEvalArgs, runEval } from "./eval.js";

const promoted = {
  promotion: {
    sourceRunId: "run-1",
    dataset: { id: "ds-1", name: "from-trace:run-1" },
    eval: {
      name: "from-trace:run-1",
      input: { prompt: "hello" },
      threshold: 0.5,
      source: { kind: "trace" as const, runId: "run-1" },
      scorers: [{ type: "usesTool" as const, toolName: "search-docs" }],
    },
  },
  alreadyStored: false,
};

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

describe("runPromote", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    promotion.loadTraceEvalPromotion.mockReset();
    promotion.persistPromotedEvalDataset.mockReset();
    fsMock.mkdir.mockReset();
    fsMock.writeFile.mockReset();
    fsMock.rename.mockReset();
    fsMock.rm.mockReset();
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.rename.mockResolvedValue(undefined);
    fsMock.rm.mockResolvedValue(undefined);
    promotion.loadTraceEvalPromotion.mockResolvedValue(promoted);
    promotion.persistPromotedEvalDataset.mockImplementation(
      async (dataset: unknown) => dataset,
    );
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("writes the fixture before persisting the dataset", async () => {
    const order: string[] = [];
    promotion.loadTraceEvalPromotion.mockImplementation(async () => {
      order.push("load");
      return promoted;
    });
    fsMock.writeFile.mockImplementation(async () => {
      order.push("write");
    });
    fsMock.rename.mockImplementation(async () => {
      order.push("rename");
    });
    promotion.persistPromotedEvalDataset.mockImplementation(
      async (dataset: unknown) => {
        order.push("persist");
        return dataset;
      },
    );

    await expect(
      runEval(["promote", "run-1", "--write", "evals/from-trace.eval.ts"]),
    ).rejects.toThrow("process.exit(0)");

    expect(order).toEqual(["load", "write", "rename", "persist"]);
    const tmp = String(fsMock.writeFile.mock.calls[0]?.[0]);
    const target = String(fsMock.rename.mock.calls[0]?.[1]);
    expect(tmp).toMatch(/\.tmp$/);
    expect(target).toMatch(/from-trace\.eval\.ts$/);
  });

  it("does not persist when --write fails", async () => {
    fsMock.writeFile.mockRejectedValue(new Error("EACCES"));

    await expect(
      runEval(["promote", "run-1", "--write", "evals/from-trace.eval.ts"]),
    ).rejects.toThrow("process.exit(1)");

    expect(promotion.persistPromotedEvalDataset).not.toHaveBeenCalled();
    expect(fsMock.rename).not.toHaveBeenCalled();
    expect(fsMock.rm).toHaveBeenCalled();
  });

  it("does not insert again when the promotion is already stored", async () => {
    promotion.loadTraceEvalPromotion.mockResolvedValue({
      ...promoted,
      alreadyStored: true,
    });

    await expect(
      runEval(["promote", "run-1", "--write", "evals/from-trace.eval.ts"]),
    ).rejects.toThrow("process.exit(0)");

    expect(fsMock.rename).toHaveBeenCalled();
    expect(promotion.persistPromotedEvalDataset).not.toHaveBeenCalled();
  });
});
