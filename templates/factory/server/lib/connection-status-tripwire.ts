import { scrub } from "../tripwire/redact.js";
import {
  TRIPWIRE_FAILED_PREFIX,
  type TripwireSink,
} from "../tripwire/types.js";
import { readProviderConnections } from "./factory-workflow-connections.js";

/**
 * A call just found no credential. When the connection status check, which
 * resolves the same credential another way, says the provider is connected,
 * the two disagree and one of them is wrong: that is what this records. It
 * runs only on the missing-credential path, never on a call that works.
 */
export async function reportConnectionStatusMismatch(input: {
  tripwire: TripwireSink;
  provider: string;
  operationId?: string;
  identity: { userEmail: string; orgId: string };
}): Promise<void> {
  let connection: Awaited<ReturnType<typeof readProviderConnections>>[number];
  try {
    [connection] = await readProviderConnections(
      [input.provider],
      input.identity,
    );
  } catch (error) {
    console.error(
      `${TRIPWIRE_FAILED_PREFIX} connection status check: ${scrub(error instanceof Error ? error.message : String(error))}`,
    );
    return;
  }
  if (connection?.status !== "connected") return;
  input.tripwire({
    area: "credential",
    code: "connection_status_mismatch",
    severity: "warn",
    ...(input.operationId === undefined
      ? {}
      : { operationId: input.operationId }),
    details: {
      provider: input.provider,
      status: connection.status,
      observed: "no_credential_at_run",
      ...(connection.connectWith === null
        ? {}
        : { connectWith: connection.connectWith }),
    },
  });
}
