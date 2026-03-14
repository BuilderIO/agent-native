import { execFile } from "node:child_process";
import type { CliAdapter, CliResult } from "./types.js";

export interface ShellCliAdapterOptions {
  /** The CLI binary name or path (e.g. "gh", "/usr/local/bin/ffmpeg"). */
  command: string;

  /** Human-readable description for agent discovery. */
  description: string;

  /**
   * Optional display name. Defaults to `command`.
   * Use this when the binary name differs from how you want to reference it
   * (e.g. command: "python3", name: "python").
   */
  name?: string;

  /** Environment variables to pass to the CLI process. Merged with process.env. */
  env?: Record<string, string>;

  /** Working directory for the CLI process. Defaults to process.cwd(). */
  cwd?: string;

  /** Timeout in milliseconds. Default: 30000 (30s). */
  timeoutMs?: number;
}

/**
 * Generic adapter that wraps any CLI binary. Use this to quickly register
 * a CLI without writing a custom adapter class.
 *
 * ```ts
 * const gh = new ShellCliAdapter({
 *   command: "gh",
 *   description: "GitHub CLI for repos, PRs, issues, and releases",
 * });
 * ```
 */
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
