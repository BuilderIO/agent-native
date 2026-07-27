import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  createInterface,
  type Interface as ReadlineInterface,
} from "node:readline";

import type {
  ComputerScope,
  MutationOperation,
  SemanticSnapshot,
} from "./types";

export interface DesktopHelper {
  snapshot(signal?: AbortSignal): Promise<SemanticSnapshot>;
  mutate(
    operation: MutationOperation,
    expectedScope: ComputerScope,
    signal?: AbortSignal,
  ): Promise<void>;
  releaseAll(): Promise<void>;
  close(): void;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

type SpawnHelper = (executablePath: string) => ChildProcessWithoutNullStreams;

/**
 * A deliberately narrow client for the bundled Swift helper. It launches one fixed
 * executable directly (never through a shell) and exchanges line-delimited JSON.
 */
export class SwiftDesktopHelperClient implements DesktopHelper {
  private process: ChildProcessWithoutNullStreams | undefined;
  private lines: ReadlineInterface | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(
    private readonly executablePath: string,
    private readonly spawnHelper: SpawnHelper = (executablePath) =>
      spawn(executablePath, [], {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      }),
  ) {}

  async snapshot(signal?: AbortSignal): Promise<SemanticSnapshot> {
    return this.request<SemanticSnapshot>({ command: "snapshot" }, signal);
  }

  async mutate(
    operation: MutationOperation,
    expectedScope: ComputerScope,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request({ command: "mutate", operation, expectedScope }, signal);
  }

  async releaseAll(): Promise<void> {
    await this.request({ command: "releaseAll" });
  }

  close(): void {
    this.terminateProcess(new Error("Desktop helper closed."));
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.process && !this.process.killed) return this.process;

    const child = this.spawnHelper(this.executablePath);
    this.process = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    child.once("error", (error) => {
      if (this.process !== child) return;
      this.process = undefined;
      this.rejectPending(error);
    });
    child.once("exit", (code, signal) => {
      if (this.process !== child) return;
      this.rejectPending(
        new Error(`Desktop helper exited (${code ?? signal ?? "unknown"}).`),
      );
      this.process = undefined;
    });
    return child;
  }

  private request<T = void>(
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const id = this.nextId++;
    const child = this.ensureProcess();

    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        // The Swift helper handles requests serially, so rejecting only this
        // promise would leave the mutation running and queue releaseAll behind
        // it. Terminating the helper preempts the native work; releaseAll then
        // starts a fresh helper process.
        this.terminateProcess(
          signal?.reason ?? new Error("Desktop helper request aborted."),
        );
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener("abort", abort);
          resolve(value as T);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", abort);
          reject(error);
        },
      });
      child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private handleLine(line: string): void {
    let response: {
      id?: number;
      ok?: boolean;
      result?: unknown;
      error?: string;
    };
    try {
      response = JSON.parse(line) as typeof response;
    } catch {
      return;
    }
    if (typeof response.id !== "number") return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else
      pending.reject(
        new Error(response.error || "Desktop helper request failed."),
      );
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private terminateProcess(error: Error): void {
    const child = this.process;
    this.process = undefined;
    this.lines?.close();
    this.lines = undefined;
    child?.kill("SIGKILL");
    this.rejectPending(error);
  }
}
