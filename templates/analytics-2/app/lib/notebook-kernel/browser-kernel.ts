import { appPath } from "@agent-native/core/client/api-path";
import { DataType, tableFromIPC } from "apache-arrow";

import { decimalText } from "../../../shared/arrow-decimal";
import {
  CONTRACT_VERSION,
  kernelCommandSchema,
  type KernelAcknowledgement,
  type KernelCommand,
  type KernelEvent,
} from "../../../shared/kernel-contract";
import type { Snapshot } from "../../../shared/notebook-execution";
import type { CompleteResultManifest } from "../../../shared/notebook-result-contract";
import { PROJECT_QUERY_PAGE_SIZE } from "../../../shared/project-query-page";
import type { CellOutput } from "../model/contracts";
import type { LocalArtifact } from "./offline-kernel";
import { openOfflineNotebookKernel } from "./open-offline-kernel";

type Command = KernelCommand["command"];
type Output = { event: KernelEvent; artifact?: LocalArtifact };

type Response =
  | { id: string; type: "ready" | "unavailable" | "unreadable" }
  | ({ id: string; type: "event" } & Output)
  | { id: string; type: "acknowledgement"; receipt: KernelAcknowledgement };

export class BrowserNotebookKernel {
  private readonly worker = openOfflineNotebookKernel();
  private pending: { cancel: (error: Error) => void } | undefined;
  private closed = false;

  get usable() {
    return !this.closed;
  }

  private exchange<T>(
    request:
      | { type: "initialize"; assets: string }
      | {
          type: "command";
          command: KernelCommand;
          artifacts: ReadonlyMap<string, Uint8Array>;
        },
    read: (reply: Response) => T | undefined,
  ) {
    return new Promise<T>((resolve, reject) => {
      if (this.closed || this.pending) {
        reject(new Error("Browser kernel is not available"));
        return;
      }
      const id = crypto.randomUUID();
      const clean = () => {
        clearTimeout(timeout);
        this.worker.removeEventListener("message", receive);
        this.worker.removeEventListener("error", fail);
        this.worker.removeEventListener("messageerror", fail);
        this.pending = undefined;
      };
      const cancel = (error: Error) => {
        clean();
        reject(error);
      };
      const receive = ({ data }: MessageEvent<Response>) => {
        if (data.id !== id) return;
        if (data.type === "unavailable" || data.type === "unreadable") {
          this.close(new Error("Browser kernel could not respond"));
          return;
        }
        try {
          const value = read(data);
          if (value === undefined) return;
          clean();
          resolve(value);
        } catch (error) {
          clean();
          reject(error);
        }
      };
      const fail = () => this.close(new Error("Browser kernel worker failed"));
      const timeout = setTimeout(fail, 120_000);
      this.pending = { cancel };
      this.worker.addEventListener("message", receive);
      this.worker.addEventListener("error", fail);
      this.worker.addEventListener("messageerror", fail);
      try {
        this.worker.postMessage({ ...request, id });
      } catch (error) {
        clean();
        reject(error);
      }
    });
  }

  async initialize(snapshot: Snapshot) {
    await this.exchange(
      { type: "initialize", assets: appPath("/offline-kernel/") },
      ({ type }) => (type === "ready" ? true : undefined),
    );
    await this.execute(snapshot, crypto.randomUUID(), { operation: "open" });
  }

  async execute(
    snapshot: Snapshot,
    runId: string,
    command: Command,
    artifacts: ReadonlyMap<string, Uint8Array> = new Map(),
    onOutput: (output: Output) => void = () => {},
  ) {
    const envelope = kernelCommandSchema.parse({
      protocolVersion: CONTRACT_VERSION,
      namespaceId: snapshot.namespace.namespaceId,
      generation: "1",
      commandId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      runId,
      resumeCursor: null,
      command,
    });
    return this.exchange(
      { type: "command", command: envelope, artifacts },
      (reply) => {
        if (reply.type === "event") onOutput(reply);
        if (reply.type !== "acknowledgement") return undefined;
        if (reply.receipt.acknowledgement.status !== "accepted")
          throw new Error(reply.receipt.acknowledgement.reason);
        return envelope;
      },
    );
  }

  close(
    error: Error = new DOMException("Browser kernel stopped", "AbortError"),
  ) {
    this.closed = true;
    this.worker.terminate();
    this.pending?.cancel(error);
  }
}

export type BrowserResult = {
  manifest: CompleteResultManifest;
  bytes: Uint8Array;
};

export function browserTable(
  bytes: Uint8Array,
): Extract<CellOutput, { type: "table" }> {
  const data = tableFromIPC(bytes);
  const columns = data.schema.fields.map(({ name, type }) => ({
    name,
    type: /^(Int|Uint|Float|Decimal)/.test(String(type))
      ? ("number" as const)
      : String(type) === "Bool"
        ? ("boolean" as const)
        : ("string" as const),
  }));
  const rows = Array.from(
    { length: Math.min(data.numRows, PROJECT_QUERY_PAGE_SIZE) },
    (_, row) =>
      columns.map((_, index) => {
        const vector = data.getChildAt(index);
        const value: unknown = vector?.get(row);
        if (value === null || value === undefined) return null;
        if (vector && DataType.isDecimal(vector.type)) {
          if (!(value instanceof Uint32Array))
            throw new Error("Unreadable Arrow decimal");
          return decimalText(value, vector.type.scale, false);
        }
        return typeof value === "string" ||
          typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value))
          ? value
          : String(value);
      }),
  );
  return {
    type: "table",
    columns,
    rows,
    rowCount: rows.length,
    totalRows: String(data.numRows),
    truncated: rows.length < data.numRows,
  };
}
