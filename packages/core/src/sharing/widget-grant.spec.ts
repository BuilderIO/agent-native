import { describe, expect, it } from "vitest";

import type { ActionRunContext } from "../action.js";
import { ForbiddenError } from "./access.js";
import {
  assertWidgetShareReadGrant,
  assertWidgetShareWriteGrant,
} from "./widget-grant.js";

const deck = { resourceType: "deck", resourceId: "deck-a" };
const grantIds = { deckId: "deck-a", resourceType: "deck" };

function writeContext(
  overrides: Partial<
    NonNullable<ActionRunContext["mcpDirectoryWidgetWrite"]>
  > & { omit?: boolean } = {},
): ActionRunContext {
  return {
    caller: "mcp-widget-write",
    ...(overrides.omit
      ? {}
      : {
          mcpDirectoryWidgetWrite: {
            appId: "slides",
            resourceIds: grantIds,
            actionNames: ["share-resource"],
            ...overrides,
          },
        }),
  };
}

describe("assertWidgetShareWriteGrant", () => {
  it.each([
    ["no context", undefined],
    ["a frontend caller", { caller: "frontend" } as ActionRunContext],
    ["an agent caller", { caller: "agent" } as ActionRunContext],
  ])("lets %s through", (_label, ctx) => {
    expect(() =>
      assertWidgetShareWriteGrant(ctx, "share-resource", {
        resourceType: "deck",
        resourceId: "any-deck",
      }),
    ).not.toThrow();
  });

  it("accepts the granted resource and action", () => {
    expect(() =>
      assertWidgetShareWriteGrant(writeContext(), "share-resource", deck),
    ).not.toThrow();
  });

  it.each([
    ["no grant", writeContext({ omit: true }), deck],
    ["another resource id", writeContext(), { ...deck, resourceId: "deck-b" }],
    [
      "another resource type",
      writeContext(),
      { ...deck, resourceType: "document" },
    ],
    [
      "a grant without a resource type",
      writeContext({ resourceIds: { deckId: "deck-a" } }),
      deck,
    ],
    [
      "a grant for another resource type",
      writeContext({
        resourceIds: { documentId: "deck-a", resourceType: "document" },
      }),
      deck,
    ],
    [
      "an action outside the grant",
      writeContext({ actionNames: ["unshare-resource"] }),
      deck,
    ],
    [
      "a read-only widget session",
      {
        caller: "mcp-widget",
        mcpDirectoryWidgetResourceIds: grantIds,
      } as ActionRunContext,
      deck,
    ],
  ])("refuses %s", (_label, ctx, args) => {
    expect(() =>
      assertWidgetShareWriteGrant(ctx, "share-resource", args),
    ).toThrow(ForbiddenError);
  });
});

describe("assertWidgetShareReadGrant", () => {
  const readContext = (
    resourceIds?: Record<string, string>,
  ): ActionRunContext => ({
    caller: "mcp-widget",
    ...(resourceIds ? { mcpDirectoryWidgetResourceIds: resourceIds } : {}),
  });

  it("lets callers that are not a widget through", () => {
    expect(() =>
      assertWidgetShareReadGrant({ caller: "frontend" }, deck),
    ).not.toThrow();
  });

  it("accepts the bound resource, from either kind of capability", () => {
    expect(() =>
      assertWidgetShareReadGrant(readContext(grantIds), deck),
    ).not.toThrow();
    expect(() =>
      assertWidgetShareReadGrant(
        { caller: "mcp-widget", ...writeContext() },
        deck,
      ),
    ).not.toThrow();
  });

  it.each([
    ["no resource ids", readContext(), deck],
    [
      "another resource id",
      readContext(grantIds),
      { ...deck, resourceId: "deck-b" },
    ],
    [
      "another resource type",
      readContext(grantIds),
      { ...deck, resourceType: "form" },
    ],
    ["no resource type", readContext({ deckId: "deck-a" }), deck],
  ])("refuses %s", (_label, ctx, args) => {
    expect(() => assertWidgetShareReadGrant(ctx, args)).toThrow(ForbiddenError);
  });
});
