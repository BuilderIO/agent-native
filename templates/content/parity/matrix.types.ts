export type ParitySurface =
  | "sidebar"
  | "header"
  | "editor"
  | "database"
  | "local-files"
  | "sharing"
  | "source-sync"
  | "comments"
  | "versions";

export type ParityStatus =
  | "action-backed"
  | "action-equivalent"
  | "route-backed-gap"
  | "host-only"
  | "client-only-ephemeral"
  | "client-assist"
  | "missing";

export type ReliabilityRisk = "none" | "per-row-loop";
export type SpinePriority = "P0" | "P1" | "P2";
export type TestCoverage = "covered" | "seeded" | "none";

export interface ParityRow {
  id: string;
  surface: ParitySurface;
  label: string;
  uiEntrypoints: string[];
  durableEffect: string | null;
  uiImplementation: string;
  status: ParityStatus;
  actions: string[];
  exception: string | null;
  reliabilityRisk: ReliabilityRisk;
  spinePriority: SpinePriority;
  testCoverage: TestCoverage;
  followUpPR: string | null;
  coverageRefs?: string[];
  evalScenarioIds?: string[];
  routePatterns?: string[];
}
