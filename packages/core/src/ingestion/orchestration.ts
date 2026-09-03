export type IngestionPhase = "inventory" | "fetch" | "completed";

export interface IngestionCheckpoint {
  phase: IngestionPhase;
  cursor: string | null;
  inventoryComplete: boolean;
  itemOffset: number;
  itemsInventoried: number;
  itemsProcessed: number;
  itemsFailed: number;
}

export interface IngestionLease {
  owner: string;
  token: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface AcquireIngestionLeaseInput {
  owner: string;
  token: string;
  ttlMs: number;
  now?: number;
}

export type AcquireIngestionLeaseResult =
  | { acquired: true; lease: IngestionLease }
  | { acquired: false; lease: IngestionLease };

export interface IngestionBudgetLimits {
  runtimeMs: number;
  itemBudget: number;
  batchBudget: number;
}

export interface IngestionBudgetState {
  startedAt: number;
  items: number;
  batches: number;
}

export type IngestionBudgetStopReason = "runtime" | "items" | "batches" | null;

export function createIngestionCheckpoint(): IngestionCheckpoint {
  return {
    phase: "inventory",
    cursor: null,
    inventoryComplete: false,
    itemOffset: 0,
    itemsInventoried: 0,
    itemsProcessed: 0,
    itemsFailed: 0,
  };
}

export function acquireIngestionLease(
  current: IngestionLease | null | undefined,
  input: AcquireIngestionLeaseInput,
): AcquireIngestionLeaseResult {
  const now = input.now ?? Date.now();
  if (current && current.expiresAt > now && current.owner !== input.owner) {
    return { acquired: false, lease: current };
  }
  const ttlMs = positiveInteger(input.ttlMs, "lease ttlMs");
  return {
    acquired: true,
    lease: {
      owner: nonEmpty(input.owner, "lease owner"),
      token: nonEmpty(input.token, "lease token"),
      acquiredAt: now,
      expiresAt: now + ttlMs,
    },
  };
}

export function renewIngestionLease(
  current: IngestionLease,
  input: Pick<AcquireIngestionLeaseInput, "token" | "ttlMs" | "now">,
): IngestionLease | null {
  if (current.token !== input.token) return null;
  const now = input.now ?? Date.now();
  if (current.expiresAt <= now) return null;
  return {
    ...current,
    expiresAt: now + positiveInteger(input.ttlMs, "lease ttlMs"),
  };
}

export function releaseIngestionLease(
  current: IngestionLease | null | undefined,
  token: string,
): null | IngestionLease {
  if (!current || current.token === token) return null;
  return current;
}

export function createIngestionBudgetState(
  now = Date.now(),
): IngestionBudgetState {
  return { startedAt: now, items: 0, batches: 0 };
}

export function consumeIngestionBudget(
  state: IngestionBudgetState,
  input: { items?: number; batches?: number },
): IngestionBudgetState {
  return {
    ...state,
    items: state.items + nonNegativeInteger(input.items ?? 0, "items"),
    batches: state.batches + nonNegativeInteger(input.batches ?? 0, "batches"),
  };
}

export function ingestionBudgetStopReason(
  limits: IngestionBudgetLimits,
  state: IngestionBudgetState,
  now = Date.now(),
): IngestionBudgetStopReason {
  if (now - state.startedAt >= positiveInteger(limits.runtimeMs, "runtimeMs")) {
    return "runtime";
  }
  if (state.items >= positiveInteger(limits.itemBudget, "itemBudget")) {
    return "items";
  }
  if (state.batches >= positiveInteger(limits.batchBudget, "batchBudget")) {
    return "batches";
  }
  return null;
}

export function assertInventoryComplete(
  checkpoint: Pick<IngestionCheckpoint, "inventoryComplete">,
): void {
  if (!checkpoint.inventoryComplete) {
    throw new Error(
      "Context import fetch cannot start before inventory is complete.",
    );
  }
}

function nonEmpty(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}
