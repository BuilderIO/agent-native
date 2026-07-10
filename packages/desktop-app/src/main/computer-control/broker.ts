import { randomBytes } from "node:crypto";

import type { DesktopHelper } from "./helper-client";
import {
  assertModeAllowsOperation,
  ComputerControlPolicyError,
  isMutationOperation,
  normalizeOrigin,
  normalizeScope,
  scopeAllowsTarget,
} from "./policy";
import type {
  AgentExecutionMode,
  ComputerAuditEvent,
  ComputerLease,
  ComputerOperation,
  ComputerScope,
  MutationOperation,
  SemanticNode,
  SemanticSnapshot,
  ComputerPermissionStatus,
} from "./types";

export interface ComputerControlBrokerOptions {
  helper: DesktopHelper;
  audit?: (event: ComputerAuditEvent) => void | Promise<void>;
  now?: () => number;
  token?: () => string;
  permissionStatus?: () => ComputerPermissionStatus;
}

const MAX_LEASE_MS = 15 * 60 * 1000;

export class ComputerControlBroker {
  private activeLease: ComputerLease | undefined;
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private activeAbort = new AbortController();
  private readonly snapshots = new Map<string, SemanticSnapshot>();
  private readonly now: () => number;
  private readonly token: () => string;

  constructor(private readonly options: ComputerControlBrokerOptions) {
    this.now = options.now ?? Date.now;
    this.token = options.token ?? (() => randomBytes(24).toString("base64url"));
  }

  get lease(): Readonly<ComputerLease> | undefined {
    return this.activeLease;
  }

  async acquireLease(
    taskId: string,
    requestedScope: ComputerScope,
    ttlMs: number,
    options: { takeover?: boolean } = {},
  ): Promise<ComputerLease> {
    const scope = normalizeScope(requestedScope);
    if (!taskId.trim() || scope.bundleIds.length === 0) {
      throw new ComputerControlPolicyError(
        "A task and at least one application are required for computer control.",
        "LEASE_SCOPE_VIOLATION",
      );
    }

    if (this.activeLease && this.activeLease.expiresAt > this.now()) {
      if (!options.takeover && this.activeLease.taskId !== taskId) {
        throw new ComputerControlPolicyError(
          `Computer control is already leased to task ${this.activeLease.taskId}.`,
          "CONTROL_BUSY",
        );
      }
      await this.stop(options.takeover ? "control.takeover" : "control.kill");
    }

    const issuedAt = this.now();
    this.activeLease = {
      taskId,
      token: this.token(),
      scope,
      issuedAt,
      expiresAt: issuedAt + Math.max(1_000, Math.min(ttlMs, MAX_LEASE_MS)),
    };
    return this.activeLease;
  }

  async execute(
    mode: AgentExecutionMode,
    operation: ComputerOperation,
  ): Promise<SemanticSnapshot | void> {
    try {
      assertModeAllowsOperation(mode, operation);
    } catch (error) {
      await this.audit(operation, "blocked", auditMetadata(operation));
      throw error;
    }

    if (!isMutationOperation(operation)) {
      const permissions = this.options.permissionStatus?.();
      if (permissions && !permissions.accessibility) {
        const error = new Error(
          "Accessibility permission is required to observe semantic desktop targets. Enable Agent Native in System Settings > Privacy & Security > Accessibility.",
        );
        await this.audit(operation, "blocked", { permission: "accessibility" });
        throw error;
      }
      const snapshot = await this.options.helper.snapshot();
      this.snapshots.set(operation.taskId, snapshot);
      await this.audit(operation, "succeeded", snapshotMetadata(snapshot));
      return snapshot;
    }

    const lease = this.assertLease(operation);
    const snapshot = this.assertFreshTarget(operation, lease.scope);
    const generation = this.generation;
    await this.audit(operation, "allowed", auditMetadata(operation));

    return new Promise<void>((resolve, reject) => {
      const run = async () => {
        if (generation !== this.generation) {
          throw new ComputerControlPolicyError(
            "Computer action was cancelled before execution.",
            "CONTROL_CANCELLED",
          );
        }
        this.assertLease(operation);
        this.assertFreshTarget(operation, lease.scope);
        await this.options.helper.mutate(
          operation,
          lease.scope,
          this.activeAbort.signal,
        );
        // The helper atomically revalidates the focused app/origin and AX target.
        this.snapshots.set(operation.taskId, snapshot);
        await this.audit(operation, "succeeded", auditMetadata(operation));
      };
      this.queue = this.queue
        .then(run, run)
        .then(resolve, async (error: unknown) => {
          await this.audit(operation, "failed", auditMetadata(operation));
          reject(error);
        });
    });
  }

  async kill(taskId?: string): Promise<void> {
    if (taskId && this.activeLease && this.activeLease.taskId !== taskId)
      return;
    await this.stop("control.kill");
  }

  close(): void {
    this.generation += 1;
    this.activeAbort.abort(new Error("Computer control broker closed."));
    this.options.helper.close();
  }

  private assertLease(operation: MutationOperation): ComputerLease {
    const lease = this.activeLease;
    if (
      !lease ||
      lease.taskId !== operation.taskId ||
      lease.token !== operation.leaseToken
    ) {
      throw new ComputerControlPolicyError(
        "A valid task lease is required for computer mutations.",
        "LEASE_REQUIRED",
      );
    }
    if (lease.expiresAt <= this.now()) {
      throw new ComputerControlPolicyError(
        "Computer control lease expired.",
        "LEASE_EXPIRED",
      );
    }
    if (!scopeAllowsTarget(lease.scope, operation.target)) {
      throw new ComputerControlPolicyError(
        "The target application or origin is outside this task's scope.",
        "LEASE_SCOPE_VIOLATION",
      );
    }
    return lease;
  }

  private assertFreshTarget(
    operation: MutationOperation,
    scope: ComputerScope,
  ): SemanticSnapshot {
    const snapshot = this.snapshots.get(operation.taskId);
    const targetOrigin = normalizeOrigin(operation.target.origin);
    if (
      !snapshot ||
      snapshot.snapshotId !== operation.target.snapshotId ||
      snapshot.bundleId !== operation.target.bundleId ||
      normalizeOrigin(snapshot.origin) !== targetOrigin ||
      !scopeAllowsTarget(scope, snapshot) ||
      !findNode(
        snapshot.nodes,
        operation.target.nodeId,
        operation.target.expectedRole,
      )
    ) {
      throw new ComputerControlPolicyError(
        "The semantic target is stale. Observe the desktop again before acting.",
        "STALE_TARGET",
      );
    }
    return snapshot;
  }

  private async stop(
    operation: "control.kill" | "control.takeover",
  ): Promise<void> {
    const taskId = this.activeLease?.taskId ?? "none";
    this.activeLease = undefined;
    this.generation += 1;
    this.activeAbort.abort(new Error("Computer control stopped."));
    this.activeAbort = new AbortController();
    this.snapshots.clear();
    // releaseAll is intentionally immediate and does not wait behind the action queue.
    await this.options.helper.releaseAll();
    await this.options.audit?.({
      taskId,
      operation,
      outcome: "succeeded",
      at: new Date(this.now()).toISOString(),
      metadata: {},
    });
  }

  private async audit(
    operation: ComputerOperation,
    outcome: ComputerAuditEvent["outcome"],
    metadata: ComputerAuditEvent["metadata"],
  ): Promise<void> {
    await this.options.audit?.({
      taskId: operation.taskId,
      operation: operation.kind,
      outcome,
      at: new Date(this.now()).toISOString(),
      metadata,
    });
  }
}

function findNode(
  nodes: readonly SemanticNode[],
  nodeId: string,
  expectedRole: string | undefined,
): boolean {
  for (const node of nodes) {
    if (node.id === nodeId && (!expectedRole || node.role === expectedRole))
      return true;
    if (node.children && findNode(node.children, nodeId, expectedRole))
      return true;
  }
  return false;
}

function auditMetadata(
  operation: ComputerOperation,
): ComputerAuditEvent["metadata"] {
  if (!isMutationOperation(operation)) return {};
  return {
    bundleId: operation.target.bundleId,
    origin: normalizeOrigin(operation.target.origin),
    targetRole: operation.target.expectedRole,
    // Never record typed text, target labels/values, lease tokens, or printable keys.
    inputLength:
      operation.kind === "input.type" ? operation.text.length : undefined,
    keyClass:
      operation.kind === "input.key"
        ? operation.key.length === 1
          ? "printable"
          : "control"
        : undefined,
  };
}

function snapshotMetadata(
  snapshot: SemanticSnapshot,
): ComputerAuditEvent["metadata"] {
  return {
    bundleId: snapshot.bundleId,
    origin: normalizeOrigin(snapshot.origin),
    nodeCount: countNodes(snapshot.nodes),
  };
}

function countNodes(nodes: readonly SemanticNode[]): number {
  return nodes.reduce(
    (count, node) =>
      count + 1 + (node.children ? countNodes(node.children) : 0),
    0,
  );
}
