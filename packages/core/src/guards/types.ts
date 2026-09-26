
export interface GuardFinding {
  file: string;
  line: number;
  message: string;
}

export interface GuardResult {
  name: string;
  findings: GuardFinding[];
  warnings?: GuardFinding[];
}

export interface GuardScanOptions {
  root: string;
}
