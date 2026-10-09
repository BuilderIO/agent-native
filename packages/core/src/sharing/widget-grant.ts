import type { ActionRunContext } from "../action.js";
import { ForbiddenError } from "./access.js";

interface WidgetShareTarget {
  resourceType: string;
  resourceId: string;
}

interface WidgetShareGrantee {
  principalType?: string;
  role?: string;
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
  args: WidgetShareTarget & WidgetShareGrantee,
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
  if (actionName === "share-resource") assertWidgetMayGrant(args);
}

/**
 * A widget ticket is a short-lived credential an iframe holds, not the person
 * clicking: what it can grant outlives it. It hands out access to individuals,
 * and never the admin role that lets the grantee manage sharing in turn.
 */
function assertWidgetMayGrant(args: WidgetShareTarget & WidgetShareGrantee) {
  if (args.principalType !== undefined && args.principalType !== "user") {
    throw new ForbiddenError(
      "A widget can share only with individual people, not an organization or group.",
    );
  }
  if (args.role === "admin") {
    throw new ForbiddenError(
      "A widget cannot grant the admin role. Change that access in the app.",
    );
  }
}

/** The note in a share email is the caller's free text, so a widget sends none. */
export function widgetShareMessage(
  ctx: ActionRunContext | undefined,
  message: string | undefined,
): string | undefined {
  return ctx?.caller === "mcp-widget-write" ? undefined : message;
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
