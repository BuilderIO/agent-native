import { runWithRequestContext } from "@agent-native/core/server";
import { z } from "zod";

import { workspaceIdSchema } from "../../shared/notebook-snapshot-contract.js";
import {
  analyticsKernelConfig,
  openKernelEventTicket,
  verifyKernelStreamTicket,
} from "../execution/kernel-client.js";
import { requireCurrentWorkspace } from "../lib/workspace-access.js";
import { ensureAnalyticsDatabase } from "./database.js";
import {
  kernelStreamInputSchema,
  readKernelBinding,
  type KernelControlInput,
} from "./kernel-namespaces.js";
import { draftKernelControl } from "./notebook-execution/service.js";

async function currentActor() {
  await ensureAnalyticsDatabase();
  const { orgId, ownerEmail } = await requireCurrentWorkspace();
  return {
    workspaceId: workspaceIdSchema.parse(orgId),
    principalId: ownerEmail,
    email: ownerEmail,
  };
}

export async function requestNotebookKernelStream(
  input: z.infer<typeof kernelStreamInputSchema>,
) {
  const actor = await currentActor();
  const execution =
    analyticsKernelConfig.read().execution ?? draftKernelControl;
  try {
    const decision = await execution.authorizeStream(actor, input);
    if (decision.status !== "allowed") return decision;
    return await openKernelEventTicket(
      actor,
      {
        namespaceId: decision.namespaceId,
        generation: decision.generation,
        runId: input.runId,
      },
      decision.cursor,
    );
  } catch {
    return { status: "unreadable", reason: "read_failed" } as const;
  }
}

export async function controlNotebookKernel(input: KernelControlInput) {
  const actor = await currentActor();
  const execution =
    analyticsKernelConfig.read().execution ?? draftKernelControl;
  return execution.control(actor, input);
}

export async function authorizeKernelStreamConnection(
  bearer: string,
): Promise<number> {
  let claims: ReturnType<typeof verifyKernelStreamTicket>;
  try {
    claims = verifyKernelStreamTicket(bearer);
  } catch {
    return 403;
  }
  const execution =
    analyticsKernelConfig.read().execution ?? draftKernelControl;

  return runWithRequestContext(
    { userEmail: claims.sub, orgId: claims.workspaceId },
    async () => {
      try {
        const actor = await currentActor();
        const decision = await execution.authorizeStream(actor, {
          runId: claims.runId,
        });
        if (decision.status === "unreadable" || decision.status === "pending")
          return 503;
        if (
          decision.status !== "allowed" ||
          decision.namespaceId !== claims.namespaceId ||
          decision.generation !== claims.generation
        )
          return 403;
        const binding = await readKernelBinding(
          actor,
          claims.namespaceId,
          claims.generation,
        );
        return binding?.hostId === claims.hostId ? 204 : 403;
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "statusCode" in error &&
          (error.statusCode === 401 || error.statusCode === 403)
        )
          return 403;
        return 503;
      }
    },
  );
}
