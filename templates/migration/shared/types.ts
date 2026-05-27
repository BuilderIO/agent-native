export type MigrationPhase =
  | "discover"
  | "plan"
  | "approve"
  | "sweep"
  | "verify"
  | "complete";

export interface MigrationRunSummary {
  id: string;
  name: string;
  sourceRoot: string;
  inputKind: string;
  inputDescription: string;
  outputRoot: string;
  target: string;
  phase: MigrationPhase;
  approved: boolean;
  hasPlanInputs?: boolean;
  taskCount: number;
  passedTaskCount: number;
  coveredTaskCount: number;
  failedTaskCount: number;
  createdAt: string;
  updatedAt: string;
}
