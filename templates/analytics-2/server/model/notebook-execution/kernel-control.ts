import { and, eq } from "drizzle-orm";

import {
  CONTRACT_VERSION,
  kernelCommandSchema,
} from "../../../shared/kernel-contract.js";
import {
  kernelGenerationSchema,
  runRequestSchema,
} from "../../../shared/notebook-execution.js";
import { getDb } from "../../db/index.js";
import {
  selectKernelHost,
  terminateKernelGeneration,
} from "../../execution/kernel-client.js";
import {
  advanceKernelGeneration,
  commitKernelControl,
  readKernelBinding,
  readKernelNamespace,
  reserveKernelNamespace,
  type NotebookKernelExecution,
} from "../kernel-namespaces.js";
import { checkNotebookAuthorities } from "../notebook-results.js";
import {
  fenceNotebookOutputs,
  lockNotebookRunOutputs,
  type createRunStore,
} from "./run-store.js";
import {
  notebookRunAttempts,
  notebookRuns,
  notebookRunWork,
} from "./schema.js";
import { readCurrentDraftSnapshot } from "./snapshot.js";

const absent = { status: "absent", reason: "not_found" } as const;
const pending = { status: "pending", reason: "not_ready" } as const;
const unreadable = { status: "unreadable", reason: "read_failed" } as const;
const conflict = {
  status: "rejected",
  reason: "kernel_generation_conflict",
} as const;

export function createDraftKernelControl(
  store: ReturnType<typeof createRunStore>,
  kick: (
    actor: { orgId: string; ownerEmail: string; caller: string },
    runId: string,
  ) => void,
): NotebookKernelExecution {
  return {
    async authorizeStream(actor, input) {
      const scope = {
        orgId: actor.workspaceId,
        ownerEmail: actor.email,
        caller: "frontend",
      };
      const read = await store.read(scope, input.runId, 0n, 1);
      if (read.status !== "found") return read;
      const { ref, namespace } = read.run.request.snapshot;
      const accepted = await readCurrentDraftSnapshot(scope, ref.projectId);
      if (
        accepted.status !== "accepted" ||
        accepted.value.snapshot.ref.head.versionId !== ref.head.versionId
      )
        return absent;
      const binding = await readKernelNamespace(actor, namespace.namespaceId);
      if (
        !binding ||
        binding.status === "stopped" ||
        binding.status === "expired"
      )
        return absent;
      if (binding.variableState) {
        const failure = await checkNotebookAuthorities(
          scope,
          binding.variableState.authorities,
        );
        if (failure) return failure;
      }
      return {
        status: "allowed",
        namespaceId: namespace.namespaceId,
        generation: kernelGenerationSchema.parse(String(binding.generation)),
        cursor: input.after ?? "0",
      };
    },

    async control(actor, input) {
      if (input.scope.kind !== "draft") return pending;
      const { projectId } = input.scope;
      const scope = {
        orgId: actor.workspaceId,
        ownerEmail: actor.email,
        caller: "frontend",
      };
      const loaded = await readCurrentDraftSnapshot(scope, projectId);
      if (loaded.status !== "accepted")
        return loaded.status === "absent" ? absent : unreadable;
      const { snapshot, cells } = loaded.value;
      const { namespaceId } = snapshot.namespace;
      const generation = input.expectedGeneration;
      const at = new Date();
      const prior = await readKernelBinding(actor, namespaceId, generation);

      if (input.operation === "interrupt") {
        if (!prior) return conflict;
        const [attempt] = await getDb()
          .select({ runId: notebookRuns.id })
          .from(notebookRunAttempts)
          .innerJoin(
            notebookRuns,
            eq(notebookRuns.id, notebookRunAttempts.runId),
          )
          .innerJoin(
            notebookRunWork,
            eq(notebookRunAttempts.id, notebookRunWork.attemptId),
          )
          .where(
            and(
              eq(notebookRunAttempts.id, input.attemptId),
              eq(notebookRuns.namespaceId, namespaceId),
              eq(notebookRuns.ownerEmail, actor.email),
              eq(notebookRuns.orgId, actor.workspaceId),
              eq(notebookRunWork.done, false),
            ),
          )
          .limit(1);
        if (!attempt) return absent;
        const cancelled = await store.cancel(scope, attempt.runId);
        if (
          cancelled.status === "absent" ||
          cancelled.status === "denied" ||
          cancelled.status === "pending" ||
          cancelled.status === "unreadable"
        )
          return cancelled;
        return {
          requestId: input.requestId,
          generation,
          state:
            cancelled.status === "cancelled"
              ? "ready"
              : cancelled.status === "completed"
                ? "ready"
                : "stopping",
          runId: attempt.runId,
          cursor: "0",
        };
      }

      const host =
        input.operation === "stop"
          ? null
          : (prior ?? (await selectKernelHost().catch(() => null)));
      if (input.operation !== "stop" && !host) return pending;
      const ids = cells.map(({ id }) => id);
      const result = await getDb().transaction(async (tx) => {
        await lockNotebookRunOutputs(tx, namespaceId, ids, true);
        const current = await readCurrentDraftSnapshot(scope, projectId, tx);
        if (
          current.status !== "accepted" ||
          current.value.snapshot.ref.head.versionId !==
            snapshot.ref.head.versionId
        )
          return absent;
        const binding = await readKernelNamespace(actor, namespaceId, tx);
        if (!binding && generation === "0" && host) {
          await reserveKernelNamespace(
            {
              id: namespaceId,
              scopeId: namespaceId,
              scopeKind: "draft",
              orgId: actor.workspaceId,
              projectId,
              principalId: actor.principalId,
              lineageId: current.value.snapshot.ref.head.versionId,
            },
            host,
            at,
            tx,
            0n,
          );
        }
        return commitKernelControl(
          actor,
          namespaceId,
          input,
          at,
          tx,
          async (locked) => {
            const advanced = await advanceKernelGeneration(
              locked,
              host
                ? {
                    status: "reserved",
                    host,
                    lineageId: current.value.snapshot.ref.head.versionId,
                  }
                : { status: "stopped" },
              at,
              tx,
            );
            if (!advanced)
              throw new Error("Kernel generation was not advanced under lock");
            let runId;
            if (input.operation === "restart-and-run-all") {
              await fenceNotebookOutputs(
                tx,
                namespaceId,
                current.value.cells.map(({ id }) => id),
              );
              const run = await store.admit(
                scope,
                runRequestSchema.parse({
                  mode: "run-all",
                  restart: false,
                  cache: "bypass",
                  requestId: `${input.requestId}:restart`,
                  snapshot: current.value.snapshot,
                }),
                undefined,
                tx,
              );
              if (run.status !== "admitted")
                throw new Error("Restart run could not be reserved");
              runId = run.runId;
            }
            return {
              requestId: input.requestId,
              generation: kernelGenerationSchema.parse(
                String(advanced.generation),
              ),
              state: input.operation === "stop" ? "stopped" : "queued",
              ...(runId ? { runId } : {}),
              cursor: "0",
            };
          },
        );
      });
      if ("status" in result) return result;
      if (prior) {
        const command = kernelCommandSchema.parse({
          protocolVersion: CONTRACT_VERSION,
          namespaceId,
          generation,
          runId: result.runId ?? input.requestId,
          attemptId: input.requestId,
          commandId: input.requestId,
          resumeCursor: null,
          command: {
            operation: input.operation === "stop" ? "close" : "restart",
          },
        });
        try {
          await terminateKernelGeneration(
            actor,
            prior,
            command,
            async () =>
              (await readCurrentDraftSnapshot(scope, projectId)).status ===
              "accepted",
          );
        } catch {
          return { ...result, state: "unknown" };
        } finally {
          if (result.runId) kick(scope, result.runId);
        }
      } else if (result.runId) kick(scope, result.runId);
      return result;
    },
  };
}
