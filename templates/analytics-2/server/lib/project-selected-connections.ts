import { isActionContractError } from "@agent-native/core/action";
import { z } from "zod";

import type { ProjectDocument } from "../../app/lib/model/contracts.js";
import { readBrowsableDataConnection } from "../model/data-connections.js";

export const selectedConnectionSchema = z.discriminatedUnion("status", [
  z.object({
    id: z.string(),
    status: z.literal("available"),
    name: z.string(),
    type: z.string(),
  }),
  z.object({ id: z.string(), status: z.enum(["missing", "unavailable"]) }),
]);

export async function readProjectSelectedConnections(
  document: ProjectDocument,
) {
  return Promise.all(
    [
      ...new Set(
        document.cells.flatMap((cell) =>
          cell.contents.kind === "sql" &&
          cell.contents.dataConnectionId !== null
            ? [cell.contents.dataConnectionId]
            : [],
        ),
      ),
    ].map(async (id) => {
      try {
        const connection = await readBrowsableDataConnection(id);
        if (
          connection.config.draft === true ||
          connection.config.workspaceCredentialDraft === true
        )
          return { id, status: "missing" as const };
        return {
          id,
          status: "available" as const,
          name: connection.label,
          type: connection.provider,
        };
      } catch (error) {
        return {
          id,
          status:
            isActionContractError(error) &&
            error.errorCode === "data_connection_not_found"
              ? ("missing" as const)
              : ("unavailable" as const),
        };
      }
    }),
  );
}
