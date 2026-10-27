import { agentNativePath } from "./api-path.js";
import {
  isRecord,
  malformedFrameworkRouteResponse,
  requestFrameworkRouteJson,
} from "./framework-route-request.js";

const ROUTE = "builder/agents-run";

/** `FrameworkRouteError.errorCode` when Builder Cloud Agents are not connected. */
export const BUILDER_AGENT_NOT_CONNECTED_ERROR_CODE =
  "builder_agent_not_connected";

export interface BuilderAgentsRunRequest {
  userMessage: string;
  branchName?: string;
}

export interface BuilderAgentsRunReceipt {
  /** The branch page Builder opened, when its answer included one. */
  url: string | null;
  /** Builder's full answer, passed through unchanged. */
  body: Record<string, unknown>;
}

/**
 * Ask Builder Cloud Agents to start a background code change. Throws
 * `FrameworkRouteError`; an `errorCode` of
 * `BUILDER_AGENT_NOT_CONNECTED_ERROR_CODE` means the workspace has no Builder
 * connection yet.
 */
export async function startBuilderAgentsRun(
  request: BuilderAgentsRunRequest,
): Promise<BuilderAgentsRunReceipt> {
  const { status, body } = await requestFrameworkRouteJson(
    ROUTE,
    agentNativePath("/_agent-native/builder/agents-run"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!isRecord(body)) {
    throw malformedFrameworkRouteResponse(ROUTE, status, "not an object");
  }
  return {
    url: typeof body.url === "string" && body.url ? body.url : null,
    body,
  };
}
