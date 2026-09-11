/**
 * Shared types for `agent-native doctor`'s guard functions.
 *
 * Each guard is a pure function `scan<Name>(options): GuardResult` that
 * scans a single app root and returns a flat list of findings. Guards do
 * not print, exit, or read `agent-native.json` themselves — that
 * orchestration lives in `../cli/doctor.ts` so the functions stay pure and
 * independently testable/importable (see the `./guards` package export).
 */

export interface GuardFinding {
  /** Path to the offending file, relative to the scanned root. */
  file: string;
  /** 1-based line number of the offending line. */
  line: number;
  /** Human-readable explanation of the finding. */
  message: string;
}

export interface GuardResult {
  /** Stable guard identifier, e.g. "no-drizzle-push". Matches the name used
   * by `--only` and `agent-native.json`'s `doctor.disabledGuards`. */
  name: string;
  findings: GuardFinding[];
}

export interface GuardScanOptions {
  /** Absolute path to the app root to scan. */
  root: string;
}
