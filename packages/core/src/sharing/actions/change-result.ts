import type { ActionChangeResult, ActionChangeVerb } from "../../action-ui.js";
import type { ShareableResourceRegistration } from "../registry.js";

export function resourceSharingChange(
  registration: Pick<
    ShareableResourceRegistration,
    "displayName" | "titleColumn"
  >,
  resource: unknown,
  verb: ActionChangeVerb,
  detail?: string,
): ActionChangeResult {
  const record =
    resource && typeof resource === "object" && !Array.isArray(resource)
      ? (resource as Record<string, unknown>)
      : undefined;
  const candidate = record?.[registration.titleColumn ?? "title"];
  const fallbackTitle = registration.displayName.trim().slice(0, 180);
  const title =
    typeof candidate === "string" &&
    candidate.trim().length > 0 &&
    candidate.trim().length <= 180
      ? candidate.trim()
      : fallbackTitle;

  return {
    change: {
      verb,
      kind: "resource-share",
      title,
      ...(detail && detail.length <= 500 ? { detail } : {}),
    },
  };
}
