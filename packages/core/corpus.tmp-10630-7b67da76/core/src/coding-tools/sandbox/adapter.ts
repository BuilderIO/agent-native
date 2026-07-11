/**
 * Pluggable sandbox-adapter seam for the `run-code` tool.
 *
 * The `run-code` tool runs agent-supplied JavaScript in an isolated environment.
 * Historically that environment was always a local spawned child process with a
 * scrubbed env and the Node permission model. This interface factors the
 * *execution* concern out of `run-code.ts` so the sandbox can be swapped for a
 * different backend (e.g. a Docker container or a remote/durable
 * Vercel-Sandbox-style runner) WITHOUT changing the calling agent code, the
 * localhost bridge, the env scrub, or the output formatting.
 *
 * The parent process keeps ownership of everything secret-bearing: it builds the
 * sandbox module, runs the localhost bridge (which holds the request context and
 * applies the registered tools' host allowlists and SSRF guards), scrubs the env,
 * and formats output. An adapter only receives an already-prepared, non-secret
 * module source plus resource limits, and is responsible solely for *running* it
 * and capturing stdout/stderr/exit status.
 *
 * Keeping the contract this narrow means a remote adapter inherits the same
 * security posture: it never sees app secrets, only the (already env-scrubbed)
 * code and the loopback bridge URL embedded in that code by the parent.
 */

/** Environment variables an adapter may expose to the sandbox process. */
export type SandboxEnv = Record<string, string>;

/**
 * A single sandbox execution request. The module source is fully prepared by the
 * parent (`run-code.ts`): it already embeds the loopback bridge port/token and
 * wraps the user's code, so an adapter treats it as an opaque program to run.
 */
export interface SandboxRunRequest {
  /**
   * The complete ESM module source to execute. Already wraps the user's code and
   * embeds the loopback bridge URL/token; the adapter does not parse or rewrite
   * it.
   */
  moduleSource: string;
  /**
   * Scrubbed environment for the sandbox process. Contains only safe POSIX vars
   * (PATH/HOME/TMPDIR/etc.) — never app secrets. Adapters must not augment this
   * with the parent's own environment.
   */
  env: SandboxEnv;
  /** Hard wall-clock timeout in milliseconds. The adapter must enforce it. */
  timeoutMs: number;
  /**
   * Loopback port of the parent's bridge server. The bridge runs in the parent
   * process and is reachable from the sandbox over 127.0.0.1. A remote adapter
   * that cannot reach the parent's loopback interface must tunnel or proxy this
   * before it can support bridge-backed globals (`appAction`, `providerFetch`,
   * etc.).
   */
  bridgePort: number;
}

/** The result of a single sandbox execution. */
export interface SandboxRunResult {
  /** Captured standard output. */
  stdout: string;
  /** Captured standard error. */
  stderr: string;
  /**
   * Process exit code. `0` for clean exit, non-zero for failures, `null` when
   * the process was terminated by a signal (e.g. timeout SIGKILL).
   */
  exitCode: number | null;
  /** True when the run was killed because it exceeded `timeoutMs`. */
  timedOut: boolean;
}

/**
 * Contract every sandbox backend implements. The default
 * `LocalChildProcessAdapter` spawns a local Node child process; a future
 * Docker/remote/durable adapter implements the same method.
 */
export interface SandboxAdapter {
  /** Stable identifier, surfaced for diagnostics and adapter selection. */
  readonly id: string;
  /** Execute one prepared sandbox module and capture its output. */
  run(request: SandboxRunRequest): Promise<SandboxRunResult>;
}
