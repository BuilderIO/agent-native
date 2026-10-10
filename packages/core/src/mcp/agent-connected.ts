import { createHash, randomUUID } from "node:crypto";

import { getAppConfig } from "../app-config/index.js";
import { mutateSetting } from "../settings/store.js";
import { normalizeTrackingDimension } from "../shared/analytics-events.js";
import { resolveMcpConnectHostId } from "../shared/mcp-connect-content.js";
import {
  isTrackingSuppressed,
  listTrackingProviders,
  track,
} from "../tracking/registry.js";
import { detectVendorClient } from "./analytics.js";

export function connectionApp(origin: string, appId?: string): string {
  const app = getAppConfig().app;
  return normalizeTrackingDimension(
    appId ??
      app.id ??
      app.template ??
      app.slug ??
      new URL(origin).hostname.split(".")[0],
  )!;
}

export async function trackAgentConnected(input: {
  email: string;
  app: string;
  client: string | readonly string[] | null;
  method: "mcp" | "oauth";
}): Promise<"emitted" | "duplicate" | "disabled" | "failed"> {
  if (listTrackingProviders().length === 0 || isTrackingSuppressed(input.email))
    return "disabled";
  try {
    const raw = input.client;
    const clients = new Set(
      (typeof raw === "string" ? [raw] : (raw ?? ["unknown"])).map(
        (name) =>
          resolveMcpConnectHostId(name) ??
          detectVendorClient(name) ??
          (name.trim().toLowerCase().slice(0, 120) || "unknown"),
      ),
    );
    let emitted = false;
    for (const client of clients) {
      const email = input.email.trim().toLowerCase();
      const key = createHash("sha256")
        .update(JSON.stringify([email, input.app, client]))
        .digest("hex");
      const claimId = randomUUID();
      // Both success paths share a durable CAS claim; process-local state
      // cannot suppress reconnects across serverless invocations.
      const claim = await mutateSetting(`agent-connected:${key}`, (current) => {
        if (current && typeof current.claim_id !== "string") {
          throw new Error("Invalid agent connection claim");
        }
        return current ?? { claim_id: claimId };
      });
      if (claim.claim_id !== claimId) continue;
      track(
        "agent_connected",
        {
          email,
          app: input.app,
          client,
          connection_method: input.method,
        },
        { userId: email },
      );
      emitted = true;
    }
    return emitted ? "emitted" : "duplicate";
  } catch (error) {
    console.error("[agent-connected] Failed to record connection:", error);
    return "failed";
  }
}
