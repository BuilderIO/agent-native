import { ActionContractError } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

export function requireDocumentRequestActor(
  ctx?: Pick<ActionRunContext, "userEmail">,
): string {
  const actor = documentAttributionActor(ctx);
  if (!actor) {
    throw new ActionContractError(
      "Document attribution requires an authenticated caller.",
      { errorCode: "DOCUMENT_ACTOR_REQUIRED", statusCode: 401 },
    );
  }
  return actor;
}

export function documentAttributionActor(
  ctx?: Pick<ActionRunContext, "userEmail">,
): string | null {
  return (
    (ctx?.userEmail ?? getRequestUserEmail())?.trim().toLowerCase() ?? null
  );
}

export function documentCreationAttribution(actor: string) {
  return { createdBy: actor, updatedBy: actor };
}

export function documentEditAttribution(actor: string) {
  return { updatedBy: actor };
}
