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

export type SandboxEnv = Record<string, string>;

export interface SandboxRunRequest {
  moduleSource: string;
  env: SandboxEnv;
  timeoutMs: number;
  bridgePort: number;
}

export interface SandboxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface SandboxAdapter {
  readonly id: string;
  run(request: SandboxRunRequest): Promise<SandboxRunResult>;
}
