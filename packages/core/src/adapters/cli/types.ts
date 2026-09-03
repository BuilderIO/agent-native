/**
 * Result of executing a CLI command.
 */
export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * A CLI adapter provides a standard interface for the agent to discover
 * and execute CLI tools. Each adapter wraps a single CLI (gh, stripe,
 * ffmpeg, etc.) and handles auth, output parsing, and error handling.
 */
export interface CliAdapter {
  /** Short name used to invoke this adapter (e.g. "gh", "stripe", "ffmpeg"). */
  name: string;

  /** Human-readable description of what this CLI does — shown to the agent for discovery. */
  description: string;

  /** Check whether the CLI is installed and accessible. */
  isAvailable(): Promise<boolean>;

  /** Execute the CLI with the given arguments. */
  execute(args: string[]): Promise<CliResult>;
}
