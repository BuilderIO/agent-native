import { agentNativePath } from "./api-path.js";
import {
  isRecord,
  malformedFrameworkRouteResponse,
  requestFrameworkRouteJson,
} from "./framework-route-request.js";

const ROUTE = "available-clis";

export interface AvailableCli {
  command: string;
  label: string;
  available: boolean;
}

/**
 * The coding CLIs the local dev server knows how to launch, with whether each
 * is installed. Throws `FrameworkRouteError` when the list cannot be read, so
 * an unreadable list is never shown as "no CLIs installed".
 */
export async function fetchAvailableClis(
  options: { signal?: AbortSignal } = {},
): Promise<AvailableCli[]> {
  const { status, body } = await requestFrameworkRouteJson(
    ROUTE,
    agentNativePath("/_agent-native/available-clis"),
    options.signal ? { signal: options.signal } : undefined,
  );
  if (!Array.isArray(body)) {
    throw malformedFrameworkRouteResponse(ROUTE, status, "not a list");
  }
  return body.map((row) => {
    if (
      !isRecord(row) ||
      typeof row.command !== "string" ||
      typeof row.label !== "string" ||
      typeof row.available !== "boolean"
    ) {
      throw malformedFrameworkRouteResponse(ROUTE, status, "invalid CLI row");
    }
    return {
      command: row.command,
      label: row.label,
      available: row.available,
    };
  });
}
