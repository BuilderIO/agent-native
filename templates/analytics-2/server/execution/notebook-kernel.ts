import { setTimeout as delay } from "node:timers/promises";

import {
  kernelCommandSchema,
  type KernelCommand,
  type KernelEvent,
} from "../../shared/kernel-contract.js";
import type { AuthorizedResultRef } from "../../shared/notebook-result-contract.js";
import { workspaceIdSchema } from "../../shared/notebook-snapshot-contract.js";
import { getDb } from "../db/index.js";
import {
  advanceKernelGeneration,
  readKernelBinding,
  readKernelNamespace,
  recordKernelHeartbeat,
  reserveKernelNamespace,
} from "../model/kernel-namespaces.js";
import type {
  Claim,
  createRunStore,
} from "../model/notebook-execution/run-store.js";
import { checkNotebookAuthorities } from "../model/notebook-results.js";
import {
  createKernelCommandSession,
  KernelGatewayError,
  selectKernelHost,
} from "./kernel-client.js";

type Store = ReturnType<typeof createRunStore>;
export const KERNEL_IDLE_MS = 15 * 60_000;

export class KernelAttemptError extends Error {
  constructor(
    code: string,
    readonly outcome: "failed" | "unknown" | "cancelled" = "failed",
  ) {
    super(code);
  }
}

export type KernelArtifact = { contentType: string; bytes: Uint8Array };
export type KernelPort = {
  generation: (claim: Claim) => Promise<string>;
  execute: (
    claim: Claim,
    command: KernelCommand,
    readArrow: (ref: AuthorizedResultRef) => Promise<Uint8Array>,
    receive: (
      event: KernelEvent["event"],
      artifact?: KernelArtifact,
    ) => Promise<void>,
    signal?: AbortSignal,
  ) => Promise<void>;
};

export function kernelActor(actor: { orgId: string; ownerEmail: string }) {
  return {
    workspaceId: workspaceIdSchema.parse(actor.orgId),
    principalId: actor.ownerEmail,
    email: actor.ownerEmail,
  };
}

export function createHostedKernelPort(store: Store): KernelPort {
  return {
    async generation(claim) {
      const actor = kernelActor(claim.run);
      const { namespace, ref } = claim.run.receipt.request.snapshot;
      const existing = await readKernelNamespace(actor, namespace.namespaceId);
      if (claim.work.dispatched) {
        const generation = claim.work.resultBuild?.result.kernelGeneration;
        if (
          !generation ||
          !existing ||
          String(existing.generation) !== generation
        )
          throw new KernelAttemptError("kernel_generation_changed", "unknown");
        return generation;
      }
      const at = new Date();
      if (
        existing &&
        existing.lineageId === ref.head.versionId &&
        existing.status !== "expired" &&
        existing.status !== "stopped" &&
        at.getTime() - existing.heartbeatAt.getTime() < KERNEL_IDLE_MS
      ) {
        return String(existing.generation);
      }
      const host = await selectKernelHost().catch(() => {
        throw new KernelAttemptError("kernel_unavailable");
      });
      if (existing) {
        const advanced = await advanceKernelGeneration(
          existing,
          { status: "reserved", host, lineageId: ref.head.versionId },
          at,
          getDb(),
        );
        if (!advanced)
          throw new KernelAttemptError("kernel_generation_changed");
        return String(advanced.generation);
      }
      const row = await reserveKernelNamespace(
        {
          id: namespace.namespaceId,
          orgId: actor.workspaceId,
          projectId: ref.projectId,
          scopeKind: namespace.kind,
          scopeId: namespace.namespaceId,
          principalId: actor.principalId,
          lineageId: ref.head.versionId,
        },
        host,
        at,
        getDb(),
      );
      return String(row.generation);
    },

    async execute(claim, command, readArrow, receive, signal) {
      const actor = kernelActor(claim.run);
      const { namespaceId, generation } = command;
      const binding = await readKernelBinding(actor, namespaceId, generation);
      if (!binding)
        throw new KernelAttemptError("kernel_generation_changed", "unknown");
      const authority = await checkNotebookAuthorities(
        {
          orgId: claim.run.orgId,
          ownerEmail: claim.run.ownerEmail,
          caller: claim.run.caller,
        },
        binding.variableState?.authorities ?? [],
      );
      if (authority) {
        await advanceKernelGeneration(
          binding,
          { status: "expired" },
          new Date(),
          getDb(),
        );
        throw new KernelAttemptError(
          authority.status === "denied"
            ? "dataframe_denied"
            : "result_unreadable",
        );
      }
      const lease = () => store.renew(claim);
      const authorize = async () =>
        !signal?.aborted && (await lease()).status !== "lost";
      const executeCommand = claim.work.dispatched
        ? {
            ...command,
            attemptId: claim.attempt.attemptId,
            command: { operation: "inspect" as const },
          }
        : command;
      const session = createKernelCommandSession(
        actor,
        executeCommand,
        authorize,
        command,
      );
      const task = new AbortController();
      const eventSignal = signal
        ? AbortSignal.any([signal, task.signal])
        : task.signal;
      let after: string | null = null;
      let accepted = false;
      let cancellationError: unknown;
      let monitor: Promise<void> | undefined;
      try {
        if (!claim.work.dispatched && binding.status === "reserved") {
          const open = kernelCommandSchema.parse({
            ...command,
            commandId: `open:${command.commandId}`,
            command: { operation: "open" },
          });
          const receipt = await createKernelCommandSession(
            actor,
            open,
            authorize,
          ).submit();
          if (receipt.acknowledgement.status !== "accepted")
            throw new KernelAttemptError(receipt.acknowledgement.reason);
        }
        const receipt = await session.submit(readArrow);
        if (receipt.acknowledgement.status !== "accepted") {
          if (claim.work.dispatched)
            throw new KernelAttemptError("kernel_execution_unknown", "unknown");
          if (
            receipt.acknowledgement.status === "absent" ||
            receipt.acknowledgement.status === "stale"
          ) {
            await advanceKernelGeneration(
              binding,
              { status: "expired" },
              new Date(),
              getDb(),
            );
            throw new KernelAttemptError("kernel_expired");
          }
          throw new KernelAttemptError(receipt.acknowledgement.reason);
        }
        accepted = true;
        monitor = (async () => {
          for (;;) {
            await delay(500, undefined, { signal: eventSignal });
            const state = await lease();
            if (state.status === "lost")
              throw new KernelAttemptError("kernel_lease_lost", "unknown");
            if (state.status !== "cancel") continue;
            const interrupt = kernelCommandSchema.parse({
              ...command,
              commandId: `interrupt:${command.commandId}`,
              command: { operation: "interrupt" },
            });
            const result = await createKernelCommandSession(
              actor,
              interrupt,
              authorize,
            ).submit();
            if (result.acknowledgement.status === "accepted") return;
            if (result.acknowledgement.status !== "absent")
              throw new KernelAttemptError(
                "kernel_interrupt_unknown",
                "unknown",
              );
          }
        })().catch((error: unknown) => {
          if (eventSignal.aborted) return;
          cancellationError = error;
          task.abort();
        });

        for (let reconnect = 0; reconnect < 3; reconnect++) {
          try {
            for await (const frame of session.events(after, eventSignal)) {
              const event = frame.event;
              if (event.type === "terminal") {
                const { outcome } = event;
                if (outcome.status === "complete") {
                  await recordKernelHeartbeat(binding, "ready", new Date());
                  return;
                }
                if (outcome.status === "interrupted") {
                  if (outcome.reason === "interrupt_confirmed")
                    throw new KernelAttemptError(
                      "cancel_confirmed",
                      "cancelled",
                    );
                  throw new KernelAttemptError(
                    "kernel_execution_unknown",
                    "unknown",
                  );
                }
                throw new KernelAttemptError(outcome.reason);
              }
              if (event.type === "ready")
                await recordKernelHeartbeat(binding, "busy", new Date());
              const artifact =
                event.type === "result" || event.type === "display"
                  ? await session.readArtifact(frame)
                  : undefined;
              await receive(event, artifact);
              after = frame.sequence;
            }
          } catch (error) {
            if (
              eventSignal.aborted ||
              !(error instanceof KernelGatewayError) ||
              error.code !== "unreadable"
            )
              throw error;
          }
        }
        throw new KernelAttemptError("kernel_execution_unknown", "unknown");
      } catch (error) {
        const cause = cancellationError ?? error;
        if (
          cause instanceof KernelAttemptError &&
          cause.outcome !== "unknown"
        ) {
          await recordKernelHeartbeat(binding, "ready", new Date());
          throw cause;
        }
        if (signal?.aborted)
          throw new KernelAttemptError("kernel_worker_detached", "unknown");
        if (
          accepted ||
          claim.work.dispatched ||
          cause instanceof KernelGatewayError
        ) {
          await advanceKernelGeneration(
            binding,
            { status: "expired" },
            new Date(),
            getDb(),
          );
          throw new KernelAttemptError("kernel_execution_unknown", "unknown");
        }
        throw cause;
      } finally {
        task.abort();
        await monitor;
      }
    },
  };
}
