import type { ActionRunContext } from "../action.js";
import { ForbiddenError } from "./access.js";

interface WidgetShareTarget {
  resourceType: string;
  resourceId: string;
}

function assertGrantMatches(
  resourceIds: Record<string, string> | undefined,
  args: WidgetShareTarget,
): void {
  // A widget grant names its resource as `resourceType` plus `<type>Id`
  // (`{ resourceType: "deck", deckId }`), the same keys the route binds.
  const idKey = `${args.resourceType}Id`;
  if (
    !resourceIds ||
    resourceIds.resourceType !== args.resourceType ||
    !Object.hasOwn(resourceIds, idKey) ||
    resourceIds[idKey] !== args.resourceId
  ) {
    throw new ForbiddenError(
      "This widget grant is missing or scoped to a different resource.",
    );
  }
}

/**
 * The widget route already pins these arguments to the signed grant; this
 * repeats the pin inside the action so a mistake in the route's wiring cannot
 * widen what a widget may share. Other callers pass through untouched.
 */
export function assertWidgetShareWriteGrant(
  ctx: ActionRunContext | undefined,
  actionName: string,
  args: WidgetShareTarget,
): void {
  if (ctx?.caller === "mcp-widget") {
    throw new ForbiddenError(
      "A read-only widget session cannot change sharing.",
    );
  }
  if (ctx?.caller !== "mcp-widget-write") return;
  const grant = ctx.mcpDirectoryWidgetWrite;
  if (!grant?.actionNames.includes(actionName)) {
    throw new ForbiddenError(
      "This widget grant is missing or does not include this action.",
    );
  }
  assertGrantMatches(grant.resourceIds, args);
}

export function assertWidgetShareReadGrant(
  ctx: ActionRunContext | undefined,
  args: WidgetShareTarget,
): void {
  if (ctx?.caller !== "mcp-widget" && ctx?.caller !== "mcp-widget-write") {
    return;
  }
  assertGrantMatches(
    ctx.mcpDirectoryWidgetResourceIds ??
      ctx.mcpDirectoryWidgetWrite?.resourceIds,
    args,
  );
}
