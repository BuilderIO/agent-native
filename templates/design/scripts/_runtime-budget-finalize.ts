import { randomUUID } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";

type Operation =
  | "write-receipt"
  | "print-receipt"
  | "print-summary"
  | "append-summary"
  | "close-browser"
  | "delete-seed"
  | "append-finalization-summary"
  | "update-receipt";

type Outcome =
  | { operation: Operation; status: "completed" }
  | {
      operation: Operation;
      status: "failed";
      cause: { name: string; message: string };
    };

export type RuntimeBudgetReceipt<T> = T & {
  finalization: {
    phase: "measured" | "cleanup-attempted";
    measurementExitCode: number;
    operations: Outcome[];
    exitCode?: number;
  };
};

export function writeRuntimeBudgetReceipt(
  path: string,
  contents: string,
  files = {
    write: (target: string, data: string) => writeFileSync(target, data),
    replace: renameSync,
  },
) {
  // A failed update must leave the already-persisted measurement intact.
  const staged = `${path}.${randomUUID()}.pending`;
  files.write(staged, contents);
  files.replace(staged, path);
}

export async function finalizeRuntimeBudget<T extends object>(
  receipt: T,
  measurementExitCode: number,
  summary: string,
  io: {
    writeReceipt?: (value: RuntimeBudgetReceipt<T>) => unknown;
    printReceipt: (value: RuntimeBudgetReceipt<T>) => unknown;
    printSummary: (text: string) => unknown;
    appendSummary?: (text: string) => unknown;
    closeBrowser: () => unknown;
    deleteSeed: () => unknown;
  },
) {
  const measured = structuredClone(receipt);
  const operations: Outcome[] = [];
  const exitCode = () =>
    operations.some((outcome) => outcome.status === "failed")
      ? 2
      : measurementExitCode;
  const artifact = (
    phase: "measured" | "cleanup-attempted",
  ): RuntimeBudgetReceipt<T> => ({
    ...measured,
    finalization: {
      phase,
      measurementExitCode,
      operations: operations.map((outcome) => ({ ...outcome })),
      ...(phase === "cleanup-attempted" ? { exitCode: exitCode() } : {}),
    },
  });
  const run = async (operation: Operation, action: () => unknown) => {
    try {
      await action();
      operations.push({ operation, status: "completed" });
      return true;
    } catch (cause) {
      operations.push({
        operation,
        status: "failed",
        cause: {
          name: cause instanceof Error ? cause.name : typeof cause,
          message: String(cause),
        },
      });
      return false;
    }
  };

  const persisted = io.writeReceipt
    ? await run("write-receipt", () => io.writeReceipt!(artifact("measured")))
    : false;
  if (!persisted)
    await run("print-receipt", () => io.printReceipt(artifact("measured")));
  await run("print-summary", () => io.printSummary(summary));
  if (io.appendSummary)
    await run("append-summary", () => io.appendSummary!(summary));

  await run("close-browser", io.closeBrowser);
  await run("delete-seed", io.deleteSeed);

  const failures = operations.filter((outcome) => outcome.status === "failed");
  if (failures.length && io.appendSummary) {
    const details = failures
      .map((failure) => `- ${failure.operation}: ${failure.cause.message}`)
      .join("\n");
    await run("append-finalization-summary", () =>
      io.appendSummary!(`\nFinalization failed:\n${details}\n`),
    );
  }
  if (io.writeReceipt)
    await run("update-receipt", () =>
      io.writeReceipt!(artifact("cleanup-attempted")),
    );
  return { receipt: artifact("cleanup-attempted"), exitCode: exitCode() };
}
