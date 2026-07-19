import fs from "node:fs";
import path from "node:path";

import {
  appendUniqueJsonLineAtomically,
  withFileLockSync,
  writeJsonFileAtomically,
  writeTextFileAtomically,
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

export type MultiFrontierArtifactKind = "proposal" | "review" | "checkpoint";

export interface MultiFrontierArtifactTestSummary {
  name: string;
  status: "passed" | "failed" | "skipped";
  summary?: string;
}

/**
 * A deliberately narrow coordination record. Full diffs, transcripts, and
 * provider payloads stay in their owning runtime rather than this durable
 * cross-provider index.
 */
export interface PersistedMultiFrontierArtifact {
  schemaVersion: 1;
  id: string;
  collaborationId: string;
  kind: MultiFrontierArtifactKind;
  createdAt: string;
  participantId?: string;
  title: string;
  summary: string;
  supersedesArtifactId?: string;
  contentHash?: string;
  fileRefs?: string[];
  testSummary?: MultiFrontierArtifactTestSummary[];
}

export interface AppendMultiFrontierArtifactInput {
  id: string;
  collaborationId: string;
  kind: MultiFrontierArtifactKind;
  createdAt?: string;
  participantId?: string;
  title: string;
  summary: string;
  supersedesArtifactId?: string;
  contentHash?: string;
  fileRefs?: string[];
  testSummary?: MultiFrontierArtifactTestSummary[];
}

export interface MultiFrontierParticipantEventRetention {
  schemaVersion: 1;
  retainedEventCount: number;
  retainedByteCount: number;
  droppedEventCount: number;
  droppedByteCount: number;
  truncated: boolean;
  replay: {
    requiresSnapshot: boolean;
    firstRetainedEventId?: string;
  };
}

export interface MultiFrontierParticipantEventRetentionLimits {
  maxEventCount: number;
  maxBytes: number;
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

/**
 * The desktop main-process coordinator is the sole caller of this transition
 * boundary. Its callback receives a detached snapshot, never renderer input.
 */
export type MultiFrontierCoordinatorTransition = (
  current: MultiFrontierStoredRun,
) => MultiFrontierRunState | MultiFrontierStoredRun | null;

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

export type AppendMultiFrontierArtifactResult =
  | {
      accepted: true;
      deduplicated: boolean;
      artifact: PersistedMultiFrontierArtifact;
      run: MultiFrontierStoredRun;
    }
  | {
      accepted: false;
      reason:
        | "missing-run"
        | "artifact-conflict"
        | "missing-participant"
        | "missing-superseded-artifact"
        | "artifact-limit-reached";
      run: MultiFrontierStoredRun | null;
    };

const TERMINAL_PHASES = new Set<MultiFrontierPhase>([
  "completed",
  "failed",
  "canceled",
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;
const SAFE_CONTENT_HASH = /^[a-f0-9]{64}$/;
const SAFE_FILE_REF = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/@+-]+$/;
const MAX_ARTIFACT_TITLE_BYTES = 280;
const MAX_ARTIFACT_SUMMARY_BYTES = 8 * 1024;
const MAX_ARTIFACT_FILE_REFS = 40;
const MAX_ARTIFACT_TEST_SUMMARIES = 40;
const MAX_ARTIFACT_TEST_NAME_BYTES = 280;
const MAX_ARTIFACT_TEST_SUMMARY_BYTES = 2 * 1024;
export const MAX_MULTI_FRONTIER_ARTIFACTS_PER_RUN = 200;
export const DEFAULT_MULTI_FRONTIER_PARTICIPANT_EVENT_RETENTION: MultiFrontierParticipantEventRetentionLimits =
  {
    maxEventCount: 2_000,
    maxBytes: 1_000_000,
  };

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

export function multiFrontierArtifactsDir(): string {
  return path.join(multiFrontierRunsStoreRoot(), "artifacts");
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
      role: "watchdog",
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
 * Applies one durable coordinator-owned state transition under the run lock.
 * A state-shaped result retains proposal and review references by default;
 * returning a full stored record is the explicit escape hatch for a
 * coordinator operation that intentionally changes those references.
 */
export function transitionStoredMultiFrontierRun(
  collaborationId: string,
  updatedAt: string,
  transition: MultiFrontierCoordinatorTransition,
): MultiFrontierStoredRun | null {
  assertSafeId(collaborationId, "collaboration id");
  assertTimestamp(updatedAt, "transition time");
  if (typeof transition !== "function") {
    throw new Error("Invalid multi-frontier coordinator transition.");
  }

  return mutateStoredMultiFrontierRun(collaborationId, updatedAt, (current) => {
    const candidate = transition(cloneStoredMultiFrontierRun(current));
    if (candidate === null) return null;
    if (isThenable(candidate)) {
      throw new Error(
        "Multi-frontier coordinator transitions must be synchronous.",
      );
    }
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      throw new Error("Invalid multi-frontier coordinator transition state.");
    }

    const isFullStoredRun = hasStoredRunTimestamps(candidate);
    if (
      !isFullStoredRun &&
      (Object.hasOwn(candidate, "createdAt") ||
        Object.hasOwn(candidate, "updatedAt"))
    ) {
      throw new Error("Invalid multi-frontier coordinator transition state.");
    }
    if (
      candidate.schemaVersion !== current.schemaVersion ||
      candidate.collaborationId !== current.collaborationId
    ) {
      throw new Error(
        "Multi-frontier coordinator transitions cannot change run identity.",
      );
    }
    if (isFullStoredRun) {
      if (!isCompleteMultiFrontierStoredRun(candidate)) {
        throw new Error("Invalid multi-frontier coordinator transition state.");
      }
      if (candidate.createdAt !== current.createdAt) {
        throw new Error(
          "Multi-frontier coordinator transitions cannot change creation time.",
        );
      }
    }

    const nextState: MultiFrontierRunState = {
      ...candidate,
      ...(isFullStoredRun
        ? {}
        : {
            proposalIds: [...current.proposalIds],
            reviewIds: [...current.reviewIds],
          }),
    };
    if (!isCompleteMultiFrontierRunState(nextState)) {
      throw new Error("Invalid multi-frontier coordinator transition state.");
    }
    return nextState;
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
    compactParticipantEventJournal(input.collaborationId);
    const status = input.status;
    const participants = status
      ? current.participants.map((candidate) =>
          candidate.participantId === input.participantId
            ? { ...candidate, status }
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

/**
 * Appends a bounded proposal, review, or checkpoint index record. The
 * coordinator owns both the artifact and its run-state reference under one
 * run lock, so a reader never observes a durable reference without its record.
 */
export function appendMultiFrontierArtifact(
  input: AppendMultiFrontierArtifactInput,
): AppendMultiFrontierArtifactResult {
  assertArtifactInput(input);
  const createdAt = input.createdAt ?? new Date().toISOString();
  assertTimestamp(createdAt, "artifact time");
  const artifact = toPersistedArtifact(input, createdAt);
  const runPath = multiFrontierRunPath(input.collaborationId);
  return withFileLockSync(runPath, () => {
    const current = readStoredRun(runPath);
    if (!current) return { accepted: false, reason: "missing-run", run: null };
    if (
      input.participantId !== undefined &&
      !current.participants.some(
        (participant) => participant.participantId === input.participantId,
      )
    ) {
      return { accepted: false, reason: "missing-participant", run: current };
    }
    if (
      input.supersedesArtifactId !== undefined &&
      !readStoredArtifact(
        multiFrontierArtifactPath(
          input.collaborationId,
          input.supersedesArtifactId,
        ),
      )
    ) {
      return {
        accepted: false,
        reason: "missing-superseded-artifact",
        run: current,
      };
    }

    const artifactPath = multiFrontierArtifactPath(
      input.collaborationId,
      input.id,
    );
    const existing = readStoredArtifact(artifactPath);
    if (existing) {
      if (!isMatchingArtifact(existing, artifact)) {
        return { accepted: false, reason: "artifact-conflict", run: current };
      }
      const ids = artifactIdsForKind(current, existing.kind);
      const run = ids.includes(existing.id)
        ? current
        : writeNextStoredRun(
            current,
            withArtifactId(current, existing.kind, existing.id),
            new Date().toISOString(),
          );
      return {
        accepted: true,
        deduplicated: true,
        artifact: existing,
        run,
      };
    }
    if (fs.existsSync(artifactPath)) {
      return { accepted: false, reason: "artifact-conflict", run: current };
    }
    if (
      listMultiFrontierArtifacts(input.collaborationId).length >=
      MAX_MULTI_FRONTIER_ARTIFACTS_PER_RUN
    ) {
      return {
        accepted: false,
        reason: "artifact-limit-reached",
        run: current,
      };
    }

    writeJsonFileAtomically(artifactPath, artifact, { mode: 0o600 });
    const ids = artifactIdsForKind(current, artifact.kind);
    const next = ids.includes(artifact.id)
      ? current
      : withArtifactId(current, artifact.kind, artifact.id);
    const run = writeNextStoredRun(current, next, createdAt);
    return { accepted: true, deduplicated: false, artifact, run };
  });
}

export function getMultiFrontierArtifact(
  collaborationId: string,
  artifactId: string,
): PersistedMultiFrontierArtifact | null {
  if (!SAFE_ID.test(collaborationId) || !SAFE_ID.test(artifactId)) return null;
  return readStoredArtifact(
    multiFrontierArtifactPath(collaborationId, artifactId),
  );
}

export function listMultiFrontierArtifacts(
  collaborationId: string,
): PersistedMultiFrontierArtifact[] {
  if (!SAFE_ID.test(collaborationId)) return [];
  const directory = multiFrontierArtifactsRunDir(collaborationId);
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readStoredArtifact(path.join(directory, file)))
    .filter(
      (artifact): artifact is PersistedMultiFrontierArtifact =>
        artifact !== null,
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
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

export function getMultiFrontierParticipantEventRetention(
  collaborationId: string,
): MultiFrontierParticipantEventRetention | null {
  if (!SAFE_ID.test(collaborationId)) return null;
  return readParticipantEventRetention(
    multiFrontierParticipantEventRetentionPath(collaborationId),
  );
}

/**
 * Coordinator maintenance for a bounded event journal. It deliberately keeps
 * the newest contiguous tail and a replay marker instead of deleting run state.
 */
export function compactMultiFrontierParticipantEvents(
  collaborationId: string,
  limits = DEFAULT_MULTI_FRONTIER_PARTICIPANT_EVENT_RETENTION,
): MultiFrontierParticipantEventRetention | null {
  assertSafeId(collaborationId, "collaboration id");
  assertRetentionLimits(limits);
  const runPath = multiFrontierRunPath(collaborationId);
  return withFileLockSync(runPath, () => {
    if (!readStoredRun(runPath)) return null;
    return compactParticipantEventJournal(collaborationId, limits);
  });
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
    { mode: 0o600 },
  );
}

function compactParticipantEventJournal(
  collaborationId: string,
  limits = DEFAULT_MULTI_FRONTIER_PARTICIPANT_EVENT_RETENTION,
): MultiFrontierParticipantEventRetention {
  const eventPath = multiFrontierParticipantEventsPath(collaborationId);
  return withFileLockSync(eventPath, () => {
    const previous = readParticipantEventRetention(
      multiFrontierParticipantEventRetentionPath(collaborationId),
    );
    const events = listMultiFrontierParticipantEvents(collaborationId);
    const retained: PersistedMultiFrontierParticipantEvent[] = [];
    let retainedByteCount = 0;
    for (const event of [...events].reverse()) {
      const bytes = eventLineByteLength(event);
      if (
        retained.length >= limits.maxEventCount ||
        retainedByteCount + bytes > limits.maxBytes
      ) {
        break;
      }
      retained.push(event);
      retainedByteCount += bytes;
    }
    retained.reverse();
    const retainedIds = new Set(retained.map((event) => event.id));
    const dropped = events.filter((event) => !retainedIds.has(event.id));
    if (dropped.length > 0) {
      writeTextFileAtomically(
        eventPath,
        retained.map((event) => `${JSON.stringify(event)}\n`).join(""),
      );
    }
    const retention: MultiFrontierParticipantEventRetention = {
      schemaVersion: 1,
      retainedEventCount: retained.length,
      retainedByteCount,
      droppedEventCount: (previous?.droppedEventCount ?? 0) + dropped.length,
      droppedByteCount:
        (previous?.droppedByteCount ?? 0) +
        dropped.reduce((total, event) => total + eventLineByteLength(event), 0),
      truncated: (previous?.truncated ?? false) || dropped.length > 0,
      replay: {
        requiresSnapshot: (previous?.truncated ?? false) || dropped.length > 0,
        ...(retained[0] ? { firstRetainedEventId: retained[0].id } : {}),
      },
    };
    writeJsonFileAtomically(
      multiFrontierParticipantEventRetentionPath(collaborationId),
      retention,
      { mode: 0o600 },
    );
    return retention;
  });
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

function multiFrontierParticipantEventRetentionPath(
  collaborationId: string,
): string {
  return path.join(
    multiFrontierParticipantEventsDir(),
    `${collaborationId}.retention.json`,
  );
}

function multiFrontierArtifactsRunDir(collaborationId: string): string {
  return path.join(multiFrontierArtifactsDir(), collaborationId);
}

function multiFrontierArtifactPath(
  collaborationId: string,
  artifactId: string,
): string {
  return path.join(
    multiFrontierArtifactsRunDir(collaborationId),
    `${artifactId}.json`,
  );
}

function readStoredRun(filePath: string): MultiFrontierStoredRun | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    return isCompleteMultiFrontierStoredRun(raw) ? raw : null;
  } catch {
    return null;
  }
}

function isCompleteMultiFrontierStoredRun(
  value: unknown,
): value is MultiFrontierStoredRun {
  if (!hasStoredRunTimestamps(value)) return false;
  return (
    isCompleteMultiFrontierRunState(value) &&
    !Number.isNaN(Date.parse(value.createdAt)) &&
    !Number.isNaN(Date.parse(value.updatedAt))
  );
}

function isCompleteMultiFrontierRunState(
  value: unknown,
): value is MultiFrontierRunState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const run = value as Partial<MultiFrontierRunState>;
  return (
    run.schemaVersion === 1 &&
    typeof run.collaborationId === "string" &&
    SAFE_ID.test(run.collaborationId) &&
    isPhase(run.phase) &&
    isStoredRunParticipantsAndDriverValid(run.participants, run.driver) &&
    isApproval(run.approval) &&
    Array.isArray(run.checkpointIds) &&
    run.checkpointIds.every(
      (checkpointId) => typeof checkpointId === "string",
    ) &&
    typeof run.round === "number" &&
    Number.isInteger(run.round) &&
    run.round >= 1 &&
    isStringArray(run.proposalIds) &&
    isStringArray(run.reviewIds) &&
    (run.recovery === undefined || isRecovery(run.recovery))
  );
}

function hasStoredRunTimestamps(
  value: unknown,
): value is MultiFrontierStoredRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const run = value as Partial<MultiFrontierStoredRun>;
  return typeof run.createdAt === "string" && typeof run.updatedAt === "string";
}

function cloneStoredMultiFrontierRun(
  run: MultiFrontierStoredRun,
): MultiFrontierStoredRun {
  return JSON.parse(JSON.stringify(run)) as MultiFrontierStoredRun;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    Boolean(value) &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
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

function readStoredArtifact(
  filePath: string,
): PersistedMultiFrontierArtifact | null {
  try {
    return readArtifactValue(
      JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown,
    );
  } catch {
    return null;
  }
}

function readArtifactValue(
  raw: unknown,
): PersistedMultiFrontierArtifact | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const artifact = raw as Partial<PersistedMultiFrontierArtifact>;
  if (
    artifact.schemaVersion !== 1 ||
    !isSafeId(artifact.id) ||
    !isSafeId(artifact.collaborationId) ||
    !isArtifactKind(artifact.kind) ||
    typeof artifact.createdAt !== "string" ||
    Number.isNaN(Date.parse(artifact.createdAt)) ||
    (artifact.participantId !== undefined &&
      !isSafeId(artifact.participantId)) ||
    !isBoundedText(artifact.title, MAX_ARTIFACT_TITLE_BYTES) ||
    !isArtifactSummary(artifact.summary) ||
    (artifact.supersedesArtifactId !== undefined &&
      !isSafeId(artifact.supersedesArtifactId)) ||
    (artifact.contentHash !== undefined &&
      !SAFE_CONTENT_HASH.test(artifact.contentHash)) ||
    !isArtifactFileRefs(artifact.fileRefs) ||
    !isArtifactTestSummaries(artifact.testSummary)
  ) {
    return null;
  }
  return artifact as PersistedMultiFrontierArtifact;
}

function readParticipantEventRetention(
  filePath: string,
): MultiFrontierParticipantEventRetention | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const retention = raw as Partial<MultiFrontierParticipantEventRetention>;
    if (
      retention.schemaVersion !== 1 ||
      !isNonNegativeInteger(retention.retainedEventCount) ||
      !isNonNegativeInteger(retention.retainedByteCount) ||
      !isNonNegativeInteger(retention.droppedEventCount) ||
      !isNonNegativeInteger(retention.droppedByteCount) ||
      typeof retention.truncated !== "boolean" ||
      !retention.replay ||
      typeof retention.replay !== "object" ||
      typeof retention.replay.requiresSnapshot !== "boolean" ||
      (retention.replay.firstRetainedEventId !== undefined &&
        !isSafeId(retention.replay.firstRetainedEventId))
    ) {
      return null;
    }
    return retention as MultiFrontierParticipantEventRetention;
  } catch {
    return null;
  }
}

function assertArtifactInput(input: AppendMultiFrontierArtifactInput): void {
  assertAllowlistedArtifactInput(input);
  assertSafeId(input.id, "artifact id");
  assertSafeId(input.collaborationId, "collaboration id");
  if (!isArtifactKind(input.kind))
    throw new Error("Invalid multi-frontier artifact kind.");
  if (input.participantId !== undefined) {
    assertSafeId(input.participantId, "participant id");
  }
  assertBoundedText(input.title, MAX_ARTIFACT_TITLE_BYTES, "artifact title");
  if (!isArtifactSummary(input.summary)) {
    throw new Error("Invalid multi-frontier artifact summary.");
  }
  if (input.supersedesArtifactId !== undefined) {
    assertSafeId(input.supersedesArtifactId, "superseded artifact id");
  }
  if (
    input.contentHash !== undefined &&
    !SAFE_CONTENT_HASH.test(input.contentHash)
  ) {
    throw new Error("Invalid multi-frontier artifact content hash.");
  }
  if (!isArtifactFileRefs(input.fileRefs)) {
    throw new Error("Invalid multi-frontier artifact file references.");
  }
  if (!isArtifactTestSummaries(input.testSummary)) {
    throw new Error("Invalid multi-frontier artifact test summary.");
  }
}

function assertAllowlistedArtifactInput(
  input: AppendMultiFrontierArtifactInput,
): void {
  const allowed = new Set([
    "id",
    "collaborationId",
    "kind",
    "createdAt",
    "participantId",
    "title",
    "summary",
    "supersedesArtifactId",
    "contentHash",
    "fileRefs",
    "testSummary",
  ]);
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.has(key))
  ) {
    throw new Error(
      "Multi-frontier artifacts only accept allowlisted summary fields.",
    );
  }
}

function toPersistedArtifact(
  input: AppendMultiFrontierArtifactInput,
  createdAt: string,
): PersistedMultiFrontierArtifact {
  return {
    schemaVersion: 1,
    id: input.id,
    collaborationId: input.collaborationId,
    kind: input.kind,
    createdAt,
    title: input.title,
    summary: input.summary,
    ...(input.participantId === undefined
      ? {}
      : { participantId: input.participantId }),
    ...(input.supersedesArtifactId === undefined
      ? {}
      : { supersedesArtifactId: input.supersedesArtifactId }),
    ...(input.contentHash === undefined
      ? {}
      : { contentHash: input.contentHash }),
    ...(input.fileRefs === undefined ? {} : { fileRefs: [...input.fileRefs] }),
    ...(input.testSummary === undefined
      ? {}
      : {
          testSummary: input.testSummary.map((summary) => ({ ...summary })),
        }),
  };
}

function artifactIdsForKind(
  run: MultiFrontierStoredRun,
  kind: MultiFrontierArtifactKind,
): string[] {
  if (kind === "proposal") return run.proposalIds;
  if (kind === "review") return run.reviewIds;
  return run.checkpointIds;
}

function withArtifactId(
  run: MultiFrontierStoredRun,
  kind: MultiFrontierArtifactKind,
  artifactId: string,
): MultiFrontierStoredRun {
  if (kind === "proposal") {
    return { ...run, proposalIds: [...run.proposalIds, artifactId] };
  }
  if (kind === "review") {
    return { ...run, reviewIds: [...run.reviewIds, artifactId] };
  }
  return { ...run, checkpointIds: [...run.checkpointIds, artifactId] };
}

function isMatchingArtifact(
  existing: PersistedMultiFrontierArtifact,
  candidate: PersistedMultiFrontierArtifact,
): boolean {
  return JSON.stringify(existing) === JSON.stringify(candidate);
}

function isArtifactKind(value: unknown): value is MultiFrontierArtifactKind {
  return value === "proposal" || value === "review" || value === "checkpoint";
}

function isArtifactSummary(value: unknown): value is string {
  return (
    isBoundedText(value, MAX_ARTIFACT_SUMMARY_BYTES) &&
    !/(?:^|\n)diff --git\s|(?:^|\n)@@\s+-\d+/m.test(value)
  );
}

function isArtifactFileRefs(value: unknown): value is string[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= MAX_ARTIFACT_FILE_REFS &&
      value.every(
        (fileRef) =>
          typeof fileRef === "string" &&
          Buffer.byteLength(fileRef, "utf-8") <= 512 &&
          SAFE_FILE_REF.test(fileRef),
      ))
  );
}

function isArtifactTestSummaries(
  value: unknown,
): value is MultiFrontierArtifactTestSummary[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= MAX_ARTIFACT_TEST_SUMMARIES &&
      value.every(
        (summary) =>
          Boolean(summary) &&
          typeof summary === "object" &&
          isBoundedText(
            (summary as MultiFrontierArtifactTestSummary).name,
            MAX_ARTIFACT_TEST_NAME_BYTES,
          ) &&
          ["passed", "failed", "skipped"].includes(
            (summary as MultiFrontierArtifactTestSummary).status,
          ) &&
          ((summary as MultiFrontierArtifactTestSummary).summary ===
            undefined ||
            isBoundedText(
              (summary as MultiFrontierArtifactTestSummary).summary,
              MAX_ARTIFACT_TEST_SUMMARY_BYTES,
            )),
      ))
  );
}

function isBoundedText(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf-8") <= maxBytes
  );
}

function assertBoundedText(
  value: unknown,
  maxBytes: number,
  label: string,
): void {
  if (!isBoundedText(value, maxBytes)) {
    throw new Error(`Invalid multi-frontier ${label}.`);
  }
}

function assertRetentionLimits(
  limits: MultiFrontierParticipantEventRetentionLimits,
): void {
  if (
    !isNonNegativeInteger(limits.maxEventCount) ||
    limits.maxEventCount < 1 ||
    !isNonNegativeInteger(limits.maxBytes) ||
    limits.maxBytes < 512
  ) {
    throw new Error(
      "Invalid multi-frontier participant event retention limits.",
    );
  }
}

function eventLineByteLength(
  event: PersistedMultiFrontierParticipantEvent,
): number {
  return Buffer.byteLength(`${JSON.stringify(event)}\n`, "utf-8");
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
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
