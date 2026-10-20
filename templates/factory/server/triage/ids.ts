import { createHash } from "node:crypto";

export function stableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

export function itemDedupeKey(
  input: {
    source: string;
    externalId: string;
    repository?: string;
    pullRequestNumber?: number;
    headSha?: string;
  },
  organizationId = "",
  factoryId = "",
): string {
  const factorySegment =
    factoryId && factoryId !== "product-feedback" ? factoryId : "";
  return stableId(
    organizationId,
    factorySegment,
    input.source,
    input.externalId,
    input.repository ?? "",
    input.pullRequestNumber === undefined
      ? ""
      : String(input.pullRequestNumber),
    input.headSha ?? "",
  );
}

/**
 * The id of an item a provider operation brought in. One record keeps one id
 * across ticks of a factory, and gets a different id in every other factory
 * and organization: `factory_items.id` is a primary key shared by all of them,
 * so the same HubSpot contact in two factories must not map to one row.
 */
export function operationItemId(
  scope: { orgId: string; factoryId: string },
  operationId: string,
  externalId: string,
): string {
  return `${operationId}:${stableId("operation-item", scope.orgId, scope.factoryId, operationId, externalId)}`;
}

/** What `operationItemId` was before ids carried a scope; rows stored under it keep it. */
export function unscopedOperationItemId(
  operationId: string,
  externalId: string,
): string {
  return `${operationId}:${externalId}`;
}
