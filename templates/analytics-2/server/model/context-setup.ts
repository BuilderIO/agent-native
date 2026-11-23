import { isActionContractError } from "@agent-native/core/action";
import { getOrgSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import {
  defaultDataConnectionId,
  isBuiltinSampleConnection,
  organizationSourceAccess,
  readDataConnection,
} from "./data-connections.js";

export const workspaceContextSetupSchema = z.object({
  progressPercent: z.number(),
  completedSteps: z.array(
    z.enum(["connect", "endorse", "improve", "reference", "extend", "govern"]),
  ),
});

const stepsSchema = z
  .object({
    endorsedData: z.boolean().optional(),
    rulesAdded: z.boolean().optional(),
    referenceRepositoryAdded: z.boolean().optional(),
    contextServerAdded: z.boolean().optional(),
    semanticModelAdded: z.boolean().optional(),
  })
  .strict();

/** Completion comes from durable workspace facts; absent facts remain incomplete. */
export async function readWorkspaceContextSetup(orgId: string) {
  const [stored, selected] = await Promise.all([
    getOrgSetting(orgId, "analytics.context.setup"),
    defaultDataConnectionId(),
  ]);
  let connected = false;
  if (selected === ORGANIZATION_BIGQUERY_SOURCE_ID) {
    connected = (await organizationSourceAccess()).configured;
  } else if (selected !== null && !isBuiltinSampleConnection(selected)) {
    try {
      const connection = await readDataConnection(selected);
      connected =
        connection.config.draft !== true &&
        connection.config.workspaceCredentialDraft !== true;
    } catch (error) {
      if (
        !isActionContractError(error) ||
        (error.errorCode !== "data_connection_not_found" &&
          error.errorCode !== "data_connection_unavailable")
      )
        throw error;
    }
  }
  const steps = stepsSchema.parse(stored ?? {});
  const complete = {
    connect: connected,
    endorse: steps.endorsedData === true,
    improve: steps.rulesAdded === true,
    reference: steps.referenceRepositoryAdded === true,
    extend: steps.contextServerAdded === true,
    govern: steps.semanticModelAdded === true,
  };
  const completedSteps = (
    Object.keys(complete) as Array<keyof typeof complete>
  ).filter((key) => complete[key]);
  return {
    progressPercent:
      (completedSteps.length / Object.keys(complete).length) * 100,
    completedSteps,
  };
}
