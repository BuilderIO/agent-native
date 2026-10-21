import { describe, expect, it, vi } from "vitest";

import {
  finalizeRuntimeBudget,
  writeRuntimeBudgetReceipt,
  type RuntimeBudgetReceipt,
} from "./_runtime-budget-finalize";

function measurement() {
  return {
    designId: "test-design",
    metrics: { heapMB: 123.5, cameraScale: 60 / 1.125 },
    zoomMeasurements: [
      {
        target: 60,
        arrived: true,
        final: { cameraScale: 60 / 1.125 },
        error: null as null | string,
      },
    ],
    heapSeries: [{ heapMB: 123.5 }],
    failedSteps: [] as string[],
  };
}

function ports() {
  const events: string[] = [];
  const artifacts: RuntimeBudgetReceipt<ReturnType<typeof measurement>>[] = [];
  const summaries: string[] = [];
  return {
    events,
    artifacts,
    summaries,
    writeReceipt: vi.fn(
      (receipt: RuntimeBudgetReceipt<ReturnType<typeof measurement>>) => {
        events.push(`write:${receipt.finalization.phase}`);
        artifacts.push(structuredClone(receipt));
      },
    ),
    printReceipt: vi.fn(
      (_receipt: RuntimeBudgetReceipt<ReturnType<typeof measurement>>) => {
        events.push("print-receipt");
      },
    ),
    printSummary: vi.fn((_text: string) => {
      events.push("print-summary");
    }),
    appendSummary: vi.fn((text: string) => {
      events.push("append-summary");
      summaries.push(text);
    }),
    closeBrowser: vi.fn(async () => {
      events.push("close-browser");
    }),
    deleteSeed: vi.fn(async () => {
      events.push("delete-seed");
    }),
  };
}

describe("runtime budget finalization boundary", () => {
  it("persists the complete measurement and summary before either teardown", async () => {
    const receipt = measurement();
    const io = ports();
    const result = await finalizeRuntimeBudget(
      receipt,
      0,
      "measured summary",
      io,
    );
    expect(io.events).toEqual([
      "write:measured",
      "print-summary",
      "append-summary",
      "close-browser",
      "delete-seed",
      "write:cleanup-attempted",
    ]);
    expect(io.artifacts[0]).toMatchObject(receipt);
    expect(io.artifacts[0]!.finalization).toEqual({
      phase: "measured",
      measurementExitCode: 0,
      operations: [],
    });
    expect(io.summaries).toEqual(["measured summary"]);
    expect(result.exitCode).toBe(0);
    expect(result.receipt.metrics).toEqual(receipt.metrics);
    expect(result.receipt.zoomMeasurements).toEqual(receipt.zoomMeasurements);
  });

  it.each([
    [true, false],
    [false, true],
    [true, true],
  ])(
    "retains measurements and attempts both teardowns (browser failure %s, seed failure %s)",
    async (browserFails, seedFails) => {
      const receipt = measurement();
      const io = ports();
      io.closeBrowser.mockImplementationOnce(async () => {
        expect(io.artifacts[0]).toMatchObject(receipt);
        expect(io.summaries[0]).toBe("measured summary");
        if (browserFails) throw new Error("browser close rejected");
      });
      io.deleteSeed.mockImplementationOnce(async () => {
        if (seedFails) throw new Error("seed delete rejected");
      });
      const result = await finalizeRuntimeBudget(
        receipt,
        0,
        "measured summary",
        io,
      );
      expect(io.closeBrowser).toHaveBeenCalledOnce();
      expect(io.deleteSeed).toHaveBeenCalledOnce();
      expect(result.exitCode).toBe(2);
      const failures = result.receipt.finalization.operations.filter(
        (operation) => operation.status === "failed",
      );
      expect(failures.map((failure) => failure.operation)).toEqual([
        ...(browserFails ? ["close-browser"] : []),
        ...(seedFails ? ["delete-seed"] : []),
      ]);
      expect(
        failures.every(
          (failure) =>
            failure.status === "failed" &&
            failure.cause.message.includes("rejected"),
        ),
      ).toBe(true);
      expect(io.artifacts[io.artifacts.length - 1]!.metrics).toEqual(
        receipt.metrics,
      );
      expect(io.artifacts[io.artifacts.length - 1]!.zoomMeasurements).toEqual(
        receipt.zoomMeasurements,
      );
      expect(io.artifacts[io.artifacts.length - 1]!.finalization.exitCode).toBe(
        2,
      );
      expect(io.summaries[io.summaries.length - 1]).toContain(
        "Finalization failed:",
      );
    },
  );

  it("retains a genuine measurement failure alongside both cleanup failures", async () => {
    const receipt = measurement();
    receipt.failedSteps.push("zoomCycle");
    receipt.zoomMeasurements[0]!.arrived = false;
    receipt.zoomMeasurements[0]!.error = "deadline-exceeded";
    const io = ports();
    io.closeBrowser.mockRejectedValueOnce(new Error("browser close rejected"));
    io.deleteSeed.mockRejectedValueOnce(new Error("seed delete rejected"));
    const result = await finalizeRuntimeBudget(
      receipt,
      2,
      "Could not measure: zoomCycle",
      io,
    );
    expect(result.exitCode).toBe(2);
    expect(result.receipt.finalization.measurementExitCode).toBe(2);
    expect(result.receipt.failedSteps).toEqual(["zoomCycle"]);
    expect(result.receipt.zoomMeasurements).toEqual(receipt.zoomMeasurements);
    expect(
      result.receipt.finalization.operations.filter(
        (operation) => operation.status === "failed",
      ),
    ).toHaveLength(2);
    expect(io.artifacts[0]).toMatchObject(receipt);
  });

  it("reports an initial artifact write failure, prints a fallback before cleanup, and still attempts both teardowns", async () => {
    const io = ports();
    io.writeReceipt.mockImplementationOnce(() => {
      throw new Error("artifact disk write rejected");
    });
    const result = await finalizeRuntimeBudget(
      measurement(),
      0,
      "measured summary",
      io,
    );
    expect(result.exitCode).toBe(2);
    expect(io.printReceipt).toHaveBeenCalledOnce();
    expect(io.events.indexOf("print-receipt")).toBeLessThan(
      io.events.indexOf("close-browser"),
    );
    expect(io.closeBrowser).toHaveBeenCalledOnce();
    expect(io.deleteSeed).toHaveBeenCalledOnce();
    expect(result.receipt.finalization.operations).toContainEqual({
      operation: "write-receipt",
      status: "failed",
      cause: { name: "Error", message: "Error: artifact disk write rejected" },
    });
    expect(io.artifacts[io.artifacts.length - 1]!.finalization.exitCode).toBe(
      2,
    );
  });

  it("does not skip teardown or report success when the initial summary append fails", async () => {
    const io = ports();
    io.appendSummary.mockImplementationOnce(() => {
      throw new Error("summary write rejected");
    });
    const result = await finalizeRuntimeBudget(
      measurement(),
      0,
      "measured summary",
      io,
    );
    expect(io.closeBrowser).toHaveBeenCalledOnce();
    expect(io.deleteSeed).toHaveBeenCalledOnce();
    expect(result.exitCode).toBe(2);
    expect(result.receipt.finalization.operations).toContainEqual({
      operation: "append-summary",
      status: "failed",
      cause: { name: "Error", message: "Error: summary write rejected" },
    });
  });

  it("preserves the first complete receipt if the final atomic update fails", async () => {
    const receipt = measurement();
    const io = ports();
    const files = new Map<string, string>();
    let replacements = 0;
    io.writeReceipt.mockImplementation((value) => {
      writeRuntimeBudgetReceipt("result.json", JSON.stringify(value), {
        write: (path, data) => {
          files.set(path, data);
        },
        replace: (from, to) => {
          if (++replacements === 2) throw new Error("final rename rejected");
          files.set(String(to), files.get(String(from))!);
          files.delete(String(from));
        },
      });
    });
    io.closeBrowser.mockRejectedValueOnce(new Error("browser close rejected"));
    io.deleteSeed.mockRejectedValueOnce(new Error("seed delete rejected"));
    const result = await finalizeRuntimeBudget(
      receipt,
      0,
      "measured summary",
      io,
    );
    expect(JSON.parse(files.get("result.json")!)).toMatchObject(receipt);
    expect(JSON.parse(files.get("result.json")!).finalization.phase).toBe(
      "measured",
    );
    expect(result.exitCode).toBe(2);
    expect(
      result.receipt.finalization.operations
        .filter((operation) => operation.status === "failed")
        .map((operation) => operation.operation),
    ).toEqual(["close-browser", "delete-seed", "update-receipt"]);
    expect(result.receipt.zoomMeasurements).toEqual(receipt.zoomMeasurements);
    expect(io.summaries[io.summaries.length - 1]).toContain(
      "browser close rejected",
    );
    expect(io.summaries[io.summaries.length - 1]).toContain(
      "seed delete rejected",
    );
  });

  it("prints the complete receipt before cleanup when no output path is supplied", async () => {
    const io = ports();
    const result = await finalizeRuntimeBudget(
      measurement(),
      0,
      "measured summary",
      { ...io, writeReceipt: undefined, appendSummary: undefined },
    );
    expect(io.events).toEqual([
      "print-receipt",
      "print-summary",
      "close-browser",
      "delete-seed",
    ]);
    expect(io.printReceipt).toHaveBeenCalledWith(
      expect.objectContaining(measurement()),
    );
    expect(result.exitCode).toBe(0);
  });

  it("snapshots measured values before teardown can mutate caller-owned references", async () => {
    const receipt = measurement();
    const expected = structuredClone(receipt);
    const io = ports();
    io.closeBrowser.mockImplementationOnce(async () => {
      receipt.metrics.heapMB = 999;
      receipt.zoomMeasurements[0]!.target = 1;
    });
    const result = await finalizeRuntimeBudget(
      receipt,
      0,
      "measured summary",
      io,
    );
    expect(result.receipt.metrics).toEqual(expected.metrics);
    expect(result.receipt.zoomMeasurements).toEqual(expected.zoomMeasurements);
    expect(io.artifacts[0]!.metrics).toEqual(
      io.artifacts[io.artifacts.length - 1]!.metrics,
    );
    expect(io.artifacts[0]!.zoomMeasurements).toEqual(
      io.artifacts[io.artifacts.length - 1]!.zoomMeasurements,
    );
  });

  it.each([1, 2])(
    "preserves measurement exit code %i when finalization succeeds",
    async (code) => {
      const result = await finalizeRuntimeBudget(
        measurement(),
        code,
        "measured summary",
        ports(),
      );
      expect(result.exitCode).toBe(code);
      expect(result.receipt.finalization.measurementExitCode).toBe(code);
    },
  );

  it.each(["stage", "replace"])(
    "never truncates the old receipt when atomic %s fails",
    (failure) => {
      const files = new Map([["result.json", "complete original receipt"]]);
      expect(() =>
        writeRuntimeBudgetReceipt("result.json", "updated receipt", {
          write: (path, data) => {
            if (failure === "stage") throw new Error("stage failed");
            files.set(path, data);
          },
          replace: () => {
            throw new Error("replace failed");
          },
        }),
      ).toThrow();
      expect(files.get("result.json")).toBe("complete original receipt");
    },
  );
});
