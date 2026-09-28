import { execFile } from "node:child_process";

import type { CliAdapter, CliResult } from "./types.js";

export interface ShellCliAdapterOptions {
  command: string;

  description: string;

  name?: string;

  env?: Record<string, string>;

  cwd?: string;

  timeoutMs?: number;
}

export class ShellCliAdapter implements CliAdapter {
  readonly name: string;
  readonly description: string;

  private command: string;
  private env: Record<string, string> | undefined;
  private cwd: string | undefined;
  private timeoutMs: number;

  constructor(options: ShellCliAdapterOptions) {
    this.name = options.name ?? options.command;
    this.description = options.description;
    this.command = options.command;
    this.env = options.env;
    this.cwd = options.cwd;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.execute(["--version"]);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  execute(args: string[]): Promise<CliResult> {
    return new Promise((resolve) => {
      const child = execFile(
        this.command,
        args,
        {
          env: this.env ? { ...process.env, ...this.env } : process.env,
          cwd: this.cwd,
          timeout: this.timeoutMs,
          maxBuffer: 10 * 1024 * 1024, // 10MB
          encoding: "utf-8",
        },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            exitCode:
              error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
                ? 1
                : ((error as any)?.code ?? child.exitCode ?? 0),
          });
        },
      );
    });
  }
}
