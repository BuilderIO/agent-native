/** The columns a funnel panel's `config.funnelOutcomes` names. */
export interface FunnelChartOutcomeKeys {
  completedKey: string;
  leftKey: string;
  skippedKey?: string;
  /** A boolean column; true marks a stage people may skip. */
  optionalKey?: string;
}

export interface DashboardFunnelOutcomes {
  completed: number;
  skipped: number;
  /** Shown but neither completed, skipped nor left: went on another way. */
  movedOn: number;
  left: number;
  optional: boolean;
}

export interface DashboardFunnelItem {
  label: string;
  value: number;
  percentOfFirst: number;
  dropOffPercent: number | null;
  /** Set when `config.funnelOutcomes` applies and this stage's columns add up. */
  outcomes?: DashboardFunnelOutcomes;
}

export type DashboardFunnelOutcomeProblem =
  | "not-a-count"
  | "overfull"
  | "not-a-flag";

export interface DashboardFunnelOutcomeIssue {
  label: string;
  problem: DashboardFunnelOutcomeProblem;
}

export interface DashboardFunnelOutcomeSummary {
  keys: FunnelChartOutcomeKeys;
  /** Configured columns the result lacks; no stage splits while any is missing. */
  missingColumns: string[];
  /** Stages that draw a plain bar, or draw without their Optional tag. */
  issues: DashboardFunnelOutcomeIssue[];
}

/** `part` as a percentage of the people shown a stage. */
export function funnelOutcomeShare(part: number, shown: number): number {
  return shown > 0 ? (part / shown) * 100 : 0;
}
