import fs from "node:fs";
import path from "node:path";

import {
  appendUniqueJsonLineAtomically,
  withFileLockSync,
  writeJsonFileAtomically,
} from "./atomic-json-file.js";
import { codeAgentStoreRoot } from "./code-agent-runs.js";

export type MultiFrontierPhase =
  | "proposing"
  | "cross_review"
  | "converging"
  | "awaiting_go"
  | "implementing"
  | "checkpoint_review"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export type MultiFrontierParticipantRole = "driver" | "watchdog";
export type MultiFrontierParticipantPermission =
  | "read_only"
  | "workspace_write";
export type MultiFrontierParticipantStatus =
  | "idle"
  | "running"
  | "waiting"
  | "failed"
  | "completed";
export type MultiFrontierApprovalState =
  | "not_required"
  | "pending"
  | "approved"
  | "rejected";
export type MultiFrontierRecoveryReason =
  | "main_process_restarted"
  | "driver_crashed"
  | "watchdog_crashed"
  | "app_quit"
  | "canceled";

export interface MultiFrontierParticipantState {
  participantId: string;
  provider: string;
  runtime: string;
  model?: string;
  capabilities?: string[];
  sessionRef?: string;
  role: MultiFrontierParticipantRole;
  permission: MultiFrontierParticipantPermission;
  status: MultiFrontierParticipantStatus;
}

export interface MultiFrontierDriverLease {
  participantId: string;
  generation: number;
  leaseState: "inactive" | "active" | "revoked";
}

export interface MultiFrontierApproval {
  state: MultiFrontierApprovalState;
  proposalId?: string;
  reviewPacketId?: string;
}

export interface MultiFrontierRecovery {
  reason: MultiFrontierRecoveryReason;
  recoveredAt: string;
  resumablePhase: MultiFrontierPhase;
  checkpointId?: string;
}

/**
 * The durable state contract shared by the main process and every participant.
 * Only the main-process coordinator writes it through this module.
 */
export interface MultiFrontierRunState {
  schemaVersion: 1;
  collaborationId: string;
  phase: MultiFrontierPhase;
  participants: MultiFrontierParticipantState[];
  driver: MultiFrontierDriverLease | null;
  approval: MultiFrontierApproval;
  checkpointIds: string[];
  round: number;
  proposalIds: string[];
  reviewIds: string[];
  recovery?: MultiFrontierRecovery;
}

export interface CreateMultiFrontierRunInput {
  collaborationId: string;
  phase?: MultiFrontierPhase;
  participants: MultiFrontierParticipantState[];
  approval?: MultiFrontierApproval;
  checkpointIds?: string[];
}

export interface RecoverMultiFrontierRunInput {
  now: string;
  reason: MultiFrontierRecoveryReason;
}

export interface MultiFrontierParticipantEvent {
  participantId: string;
  generation?: number;
  permission: MultiFrontierParticipantPermission;
}

export interface PersistedMultiFrontierParticipantEvent extends MultiFrontierParticipantEvent {
  schemaVersion: 1;
  id: string;
  collaborationId: string;
  createdAt: string;
  status?: MultiFrontierParticipantStatus;
}

export interface AppendMultiFrontierParticipantEventInput extends MultiFrontierParticipantEvent {
  id: string;
  collaborationId: string;
  createdAt?: string;
  status?: MultiFrontierParticipantStatus;
}

export interface MultiFrontierStoredRun extends MultiFrontierRunState {
  createdAt: string;
  updatedAt: string;
}

export type AppendMultiFrontierParticipantEventResult =
  | {
      accepted: true;
      deduplicated: boolean;
      event: PersistedMultiFrontierParticipantEvent;
      run: MultiFrontierStoredRun;
    }
  | {
      accepted: false;
      reason:
        | "missing-run"
        | "stale-driver"
        | "missing-participant"
        | "event-conflict"
        | "terminal-participant";
      run: MultiFrontierStoredRun | null;
    };

const TERMINAL_PHASES = new Set<MultiFrontierPhase>([
  "completed",
  "failed",
  "canceled",
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;

/** All multi-frontier state stays alongside the existing local Code store. */
export function multiFrontierRunsStoreRoot(): string {
  return path.join(codeAgentStoreRoot(), "multi-frontier");
}

export function multiFrontierRunsDir(): string {
  return path.join(multiFrontierRunsStoreRoot(), "runs");
}

export function multiFrontierParticipantEventsDir(): string {
  return path.join(multiFrontierRunsStoreRoot(), "events");
}

export function createMultiFrontierRun(
  input: CreateMultiFrontierRunInput,
): MultiFrontierStoredRun {
  assertSafeId(input.collaborationId, "collaboration id");
  assertParticipants(input.participants);
  if (getMultiFrontierRun(input.collaborationId)) {
    throw new Error(
      `Multi-frontier run already exists: ${input.collaborationId}`,
    );
  }
  const now = new Date().toISOString();
  const state: MultiFrontierStoredRun = {
    schemaVersion: 1,
    collaborationId: input.collaborationId,
    phase: input.phase ?? "proposing",
    participants: input.participants.map((participant) => ({
      ...participant,
      capabilities: [...(participant.capabilities ?? [])],
      role: "watchdog",
      permission: "read_only",
    })),
    driver: null,
    approval: { ...(input.approval ?? { state: "not_required" }) },
    checkpointIds: [...(input.checkpointIds ?? [])],
    round: 1,
    proposalIds: [],
    reviewIds: [],
    createdAt: now,
    updatedAt: now,
  };
  writeNewMultiFrontierRun(state);
  return state;
}

export function getMultiFrontierRun(
  collaborationId: string,
): MultiFrontierStoredRun | null {
  if (!SAFE_ID.test(collaborationId)) return null;
  return readStoredRun(multiFrontierRunPath(collaborationId));
}

export function listMultiFrontierRuns(): MultiFrontierStoredRun[] {
  const directory = multiFrontierRunsDir();
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readStoredRun(path.join(directory, file)))
    .filter((run): run is MultiFrontierStoredRun => run !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/**
 * Recovery never resumes a native participant automatically. Any in-flight
 * driver lease is revoked and requires an explicit, newly fenced activation.
 */
export function recoverMultiFrontierRun(
  state: MultiFrontierRunState,
  input: RecoverMultiFrontierRunInput,
): MultiFrontierRunState {
  assertTimestamp(input.now, "recovery time");
  if (TERMINAL_PHASES.has(state.phase) || state.phase === "paused") {
    return state;
  }

  const checkpointId = state.checkpointIds.at(-1);
  return {
    ...state,
    phase: "paused",
    participants: state.participants.map((participant) => ({
      ...participant,
      permission: "read_only",
      status: participant.status === "running" ? "waiting" : participant.status,
    })),
    driver: state.driver ? { ...state.driver, leaseState: "revoked" } : null,
    recovery: {
      reason: input.reason,
      recoveredAt: input.now,
      resumablePhase: state.phase,
      ...(checkpointId ? { checkpointId } : {}),
    },
  };
}

/** Persist the recovery decision made by the main-process coordinator. */
export function recoverStoredMultiFrontierRun(
  collaborationId: string,
  input: RecoverMultiFrontierRunInput,
): MultiFrontierStoredRun | null {
  return mutateStoredMultiFrontierRun(collaborationId, input.now, (current) => {
    const recovered = recoverMultiFrontierRun(current, input);
    return recovered === current ? current : recovered;
  });
}

/**
 * Coordinators must call this before applying a participant event. Write
 * events are accepted only from the active driver generation.
 */
export function canApplyMultiFrontierParticipantEvent(
  state: MultiFrontierRunState,
  event: MultiFrontierParticipantEvent,
): boolean {
  if (TERMINAL_PHASES.has(state.phase) || state.phase === "paused") {
    return false;
  }
  if (
    !state.participants.some(
      (candidate) => candidate.participantId === event.participantId,
    )
  ) {
    return false;
  }
  if (event.permission === "read_only") return true;
  const driver = state.driver;
  return Boolean(
    state.phase === "implementing" &&
    driver?.leaseState === "active" &&
    driver.participantId === event.participantId &&
    driver.generation === event.generation,
  );
}

/**
 * Explicitly restores a write lease after recovery. The generation increments
 * so an event from the interrupted process can never regain write authority.
 */
export function reactivateMultiFrontierDriver(
  state: MultiFrontierRunState,
  participantId: string,
): MultiFrontierRunState | null {
  if (
    state.phase !== "paused" ||
    !state.recovery ||
    state.recovery.resumablePhase !== "implementing" ||
    state.approval.state === "pending"
  ) {
    return null;
  }
  const participant = state.participants.find(
    (candidate) => candidate.participantId === participantId,
  );
  if (!participant || participant.status === "failed") return null;

  const nextGeneration = (state.driver?.generation ?? 0) + 1;
  return {
    ...state,
    phase: state.recovery.resumablePhase,
    participants: state.participants.map((candidate) => ({
      ...candidate,
      role: candidate.participantId === participantId ? "driver" : "watchdog",
      permission:
        candidate.participantId === participantId
          ? "workspace_write"
          : "read_only",
      status:
        candidate.participantId === participantId
          ? "waiting"
          : candidate.status,
    })),
    driver: {
      participantId,
      generation: nextGeneration,
      leaseState: "active",
    },
    recovery: undefined,
  };
}

/** Assign the first explicit write lease for an implementing run. */
export function activateMultiFrontierDriver(
  state: MultiFrontierRunState,
  participantId: string,
): MultiFrontierRunState | null {
  if (
    state.phase !== "implementing" ||
    state.approval.state === "pending" ||
    state.driver?.leaseState === "active"
  ) {
    return null;
  }
  const participant = state.participants.find(
    (candidate) => candidate.participantId === participantId,
  );
  if (!participant || participant.status === "failed") return null;

  return {
    ...state,
    participants: state.participants.map((candidate) => ({
      ...candidate,
      role: candidate.participantId === participantId ? "driver" : "watchdog",
      permission:
        candidate.participantId === participantId
          ? "workspace_write"
          : "read_only",
    })),
    driver: {
      participantId,
      generation: (state.driver?.generation ?? 0) + 1,
      leaseState: "active",
    },
  };
}

/** Persist the first explicit driver activation from the main-process coordinator. */
export function activateStoredMultiFrontierDriver(
  collaborationId: string,
  participantId: string,
  now = new Date().toISOString(),
): MultiFrontierStoredRun | null {
  assertTimestamp(now, "activation time");
  return mutateStoredMultiFrontierRun(collaborationId, now, (current) =>
    activateMultiFrontierDriver(current, participantId),
  );
}

/** Persist an explicit driver reactivation after the human-approved resume. */
export function reactivateStoredMultiFrontierDriver(
  collaborationId: string,
  participantId: string,
  now = new Date().toISOString(),
): MultiFrontierStoredRun | null {
  assertTimestamp(now, "reactivation time");
  return mutateStoredMultiFrontierRun(collaborationId, now, (current) =>
    reactivateMultiFrontierDriver(current, participantId),
  );
}

/**
 * Appends an idempotent participant event after the coordinator has fenced it.
 * The event journal is diagnostic; state is mutated only through this guarded
 * coordinator entry point.
 */
export function appendMultiFrontierParticipantEvent(
  input: AppendMultiFrontierParticipantEventInput,
): AppendMultiFrontierParticipantEventResult {
  assertSafeId(input.id, "event id");
  assertSafeId(input.collaborationId, "collaboration id");
  assertSafeId(input.participantId, "participant id");
  const createdAt = input.createdAt ?? new Date().toISOString();
  assertTimestamp(createdAt, "event time");

  const runPath = multiFrontierRunPath(input.collaborationId);
  return withFileLockSync(runPath, () => {
    const current = readStoredRun(runPath);
    if (!current) return { accepted: false, reason: "missing-run", run: null };
    const existing = listMultiFrontierParticipantEvents(
      input.collaborationId,
    ).find((event) => event.id === input.id);
    if (existing) {
      if (!isMatchingParticipantEvent(existing, input)) {
        return { accepted: false, reason: "event-conflict", run: current };
      }
      return {
        accepted: true,
        deduplicated: true,
        event: existing,
        run: current,
      };
    }
    if (
      !current.participants.some(
        (candidate) => candidate.participantId === input.participantId,
      )
    ) {
      return { accepted: false, reason: "missing-participant", run: current };
    }
    if (!canApplyMultiFrontierParticipantEvent(current, input)) {
      return { accepted: false, reason: "stale-driver", run: current };
    }
    const participant = current.participants.find(
      (candidate) => candidate.participantId === input.participantId,
    );
    if (
      input.status !== undefined &&
      (participant?.status === "completed" ||
        participant?.status === "failed") &&
      input.status !== participant.status
    ) {
      return { accepted: false, reason: "terminal-participant", run: current };
    }

    const event: PersistedMultiFrontierParticipantEvent = {
      schemaVersion: 1,
      id: input.id,
      collaborationId: input.collaborationId,
      participantId: input.participantId,
      permission: input.permission,
      createdAt,
      ...(input.generation === undefined
        ? {}
        : { generation: input.generation }),
      ...(input.status === undefined ? {} : { status: input.status }),
    };
    appendParticipantEvent(event);
    const participants = input.status
      ? current.participants.map((candidate) =>
          candidate.participantId === input.participantId
            ? { ...candidate, status: input.status }
            : candidate,
        )
      : current.participants;
    const run = writeNextStoredRun(
      current,
      { ...current, participants },
      createdAt,
    );
    return { accepted: true, deduplicated: false, event, run };
  });
}

export function listMultiFrontierParticipantEvents(
  collaborationId: string,
): PersistedMultiFrontierParticipantEvent[] {
  if (!SAFE_ID.test(collaborationId)) return [];
  const eventPath = multiFrontierParticipantEventsPath(collaborationId);
  if (!fs.existsSync(eventPath)) return [];
  return fs
    .readFileSync(eventPath, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(readParticipantEvent)
    .filter(
      (event): event is PersistedMultiFrontierParticipantEvent =>
        event !== null,
    );
}

function writeMultiFrontierRun(run: MultiFrontierStoredRun): void {
  writeJsonFileAtomically(multiFrontierRunPath(run.collaborationId), run);
}

function writeNewMultiFrontierRun(run: MultiFrontierStoredRun): void {
  const filePath = multiFrontierRunPath(run.collaborationId);
  withFileLockSync(filePath, () => {
    if (fs.existsSync(filePath)) {
      throw new Error(
        `Multi-frontier run already exists: ${run.collaborationId}`,
      );
    }
    writeJsonFileAtomically(filePath, run);
  });
}

function writeNextStoredRun(
  current: MultiFrontierStoredRun,
  nextState: MultiFrontierRunState,
  updatedAt: string,
): MultiFrontierStoredRun {
  const next: MultiFrontierStoredRun = {
    ...nextState,
    createdAt: current.createdAt,
    updatedAt,
  };
  writeMultiFrontierRun(next);
  return next;
}

function appendParticipantEvent(
  event: PersistedMultiFrontierParticipantEvent,
): void {
  appendUniqueJsonLineAtomically(
    multiFrontierParticipantEventsPath(event.collaborationId),
    event,
    readParticipantEventValue,
  );
}

function mutateStoredMultiFrontierRun(
  collaborationId: string,
  updatedAt: string,
  mutate: (current: MultiFrontierStoredRun) => MultiFrontierRunState | null,
): MultiFrontierStoredRun | null {
  const filePath = multiFrontierRunPath(collaborationId);
  return withFileLockSync(filePath, () => {
    const current = readStoredRun(filePath);
    if (!current) return null;
    const nextState = mutate(current);
    if (!nextState) return null;
    const next: MultiFrontierStoredRun = {
      ...nextState,
      createdAt: current.createdAt,
      updatedAt,
    };
    writeMultiFrontierRun(next);
    return next;
  });
}

function multiFrontierRunPath(collaborationId: string): string {
  return path.join(multiFrontierRunsDir(), `${collaborationId}.json`);
}

function multiFrontierParticipantEventsPath(collaborationId: string): string {
  return path.join(
    multiFrontierParticipantEventsDir(),
    `${collaborationId}.jsonl`,
  );
}

function readStoredRun(filePath: string): MultiFrontierStoredRun | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const run = raw as Partial<MultiFrontierStoredRun>;
    if (
      run.schemaVersion !== 1 ||
      typeof run.collaborationId !== "string" ||
      !SAFE_ID.test(run.collaborationId) ||
      !isPhase(run.phase) ||
      !isStoredRunParticipantsAndDriverValid(run.participants, run.driver) ||
      !isApproval(run.approval) ||
      !Array.isArray(run.checkpointIds) ||
      !run.checkpointIds.every(
        (checkpointId) => typeof checkpointId === "string",
      ) ||
      typeof run.round !== "number" ||
      !Number.isInteger(run.round) ||
      run.round < 1 ||
      !isStringArray(run.proposalIds) ||
      !isStringArray(run.reviewIds) ||
      (run.recovery !== undefined && !isRecovery(run.recovery)) ||
      typeof run.createdAt !== "string" ||
      Number.isNaN(Date.parse(run.createdAt)) ||
      typeof run.updatedAt !== "string" ||
      Number.isNaN(Date.parse(run.updatedAt))
    ) {
      return null;
    }
    return run as MultiFrontierStoredRun;
  } catch {
    return null;
  }
}

function readParticipantEvent(
  line: string,
): PersistedMultiFrontierParticipantEvent | null {
  try {
    return readParticipantEventValue(JSON.parse(line) as unknown);
  } catch {
    return null;
  }
}

function readParticipantEventValue(
  raw: unknown,
): PersistedMultiFrontierParticipantEvent | null {
  try {
    if (!raw || typeof raw !== "object") return null;
    const event = raw as Partial<PersistedMultiFrontierParticipantEvent>;
    if (
      event.schemaVersion !== 1 ||
      typeof event.id !== "string" ||
      typeof event.collaborationId !== "string" ||
      typeof event.participantId !== "string" ||
      !isPermission(event.permission) ||
      (event.generation !== undefined &&
        typeof event.generation !== "number") ||
      (event.status !== undefined && !isParticipantStatus(event.status)) ||
      typeof event.createdAt !== "string" ||
      Number.isNaN(Date.parse(event.createdAt))
    ) {
      return null;
    }
    return event as PersistedMultiFrontierParticipantEvent;
  } catch {
    return null;
  }
}

function assertParticipants(
  participants: MultiFrontierParticipantState[],
): void {
  if (participants.length === 0) {
    throw new Error("A multi-frontier run needs at least one participant.");
  }
  const participantIds = new Set<string>();
  for (const participant of participants) {
    if (!isParticipant(participant))
      throw new Error("Invalid multi-frontier participant.");
    assertSafeId(participant.participantId, "participant id");
    if (participantIds.has(participant.participantId)) {
      throw new Error(
        `Duplicate multi-frontier participant id: ${participant.participantId}`,
      );
    }
    participantIds.add(participant.participantId);
  }
}

function isParticipant(value: unknown): value is MultiFrontierParticipantState {
  if (!value || typeof value !== "object") return false;
  const participant = value as Partial<MultiFrontierParticipantState>;
  return (
    typeof participant.participantId === "string" &&
    SAFE_ID.test(participant.participantId) &&
    typeof participant.provider === "string" &&
    participant.provider.length > 0 &&
    typeof participant.runtime === "string" &&
    participant.runtime.length > 0 &&
    (participant.model === undefined ||
      typeof participant.model === "string") &&
    (participant.capabilities === undefined ||
      isStringArray(participant.capabilities)) &&
    (participant.sessionRef === undefined ||
      typeof participant.sessionRef === "string") &&
    (participant.role === "driver" || participant.role === "watchdog") &&
    isPermission(participant.permission) &&
    isParticipantStatus(participant.status)
  );
}

function areStoredParticipantsValid(
  value: unknown,
): value is MultiFrontierParticipantState[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(isParticipant)
  ) {
    return false;
  }
  return (
    new Set(value.map((participant) => participant.participantId)).size ===
    value.length
  );
}

function isStoredRunParticipantsAndDriverValid(
  participants: unknown,
  driver: unknown,
): participants is MultiFrontierParticipantState[] {
  if (!areStoredParticipantsValid(participants) || !isDriver(driver)) {
    return false;
  }
  if (driver?.leaseState !== "active") {
    return participants.every(
      (participant) => participant.permission === "read_only",
    );
  }
  if (
    !participants.some(
      (participant) => participant.participantId === driver.participantId,
    )
  ) {
    return false;
  }
  return participants.every((participant) => {
    if (participant.participantId !== driver.participantId) {
      return (
        participant.role === "watchdog" &&
        participant.permission === "read_only"
      );
    }
    return (
      participant.role === "driver" &&
      participant.permission === "workspace_write"
    );
  });
}

function isDriver(value: unknown): value is MultiFrontierDriverLease | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const driver = value as Partial<MultiFrontierDriverLease>;
  return (
    typeof driver.participantId === "string" &&
    typeof driver.generation === "number" &&
    (driver.leaseState === "inactive" ||
      driver.leaseState === "active" ||
      driver.leaseState === "revoked")
  );
}

function isApproval(value: unknown): value is MultiFrontierApproval {
  if (!value || typeof value !== "object") return false;
  const approval = value as Partial<MultiFrontierApproval>;
  return (
    (approval.state === "not_required" ||
      approval.state === "pending" ||
      approval.state === "approved" ||
      approval.state === "rejected") &&
    (approval.proposalId === undefined ||
      typeof approval.proposalId === "string") &&
    (approval.reviewPacketId === undefined ||
      typeof approval.reviewPacketId === "string")
  );
}

function isRecovery(value: unknown): value is MultiFrontierRecovery {
  if (!value || typeof value !== "object") return false;
  const recovery = value as Partial<MultiFrontierRecovery>;
  return (
    isRecoveryReason(recovery.reason) &&
    typeof recovery.recoveredAt === "string" &&
    !Number.isNaN(Date.parse(recovery.recoveredAt)) &&
    isPhase(recovery.resumablePhase) &&
    (recovery.checkpointId === undefined ||
      typeof recovery.checkpointId === "string")
  );
}

function isPhase(value: unknown): value is MultiFrontierPhase {
  return (
    typeof value === "string" &&
    [
      "proposing",
      "cross_review",
      "converging",
      "awaiting_go",
      "implementing",
      "checkpoint_review",
      "paused",
      "completed",
      "failed",
      "canceled",
    ].includes(value)
  );
}

function isParticipantStatus(
  value: unknown,
): value is MultiFrontierParticipantStatus {
  return (
    value === "idle" ||
    value === "running" ||
    value === "waiting" ||
    value === "failed" ||
    value === "completed"
  );
}

function isPermission(
  value: unknown,
): value is MultiFrontierParticipantPermission {
  return value === "read_only" || value === "workspace_write";
}

function isMatchingParticipantEvent(
  existing: PersistedMultiFrontierParticipantEvent,
  input: AppendMultiFrontierParticipantEventInput,
): boolean {
  return (
    existing.collaborationId === input.collaborationId &&
    existing.participantId === input.participantId &&
    existing.permission === input.permission &&
    existing.generation === input.generation &&
    existing.status === input.status &&
    (input.createdAt === undefined || existing.createdAt === input.createdAt)
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isRecoveryReason(
  value: unknown,
): value is MultiFrontierRecoveryReason {
  return (
    value === "main_process_restarted" ||
    value === "driver_crashed" ||
    value === "watchdog_crashed" ||
    value === "app_quit" ||
    value === "canceled"
  );
}

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`Invalid multi-frontier ${label}.`);
}

function assertTimestamp(value: string, label: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid multi-frontier ${label}.`);
  }
}
