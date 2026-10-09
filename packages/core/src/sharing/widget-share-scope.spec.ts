import { describe, expect, it } from "vitest";

import { ActionContractError, type ActionRunContext } from "../action.js";
import listResourceShares from "./actions/list-resource-shares.js";
import setResourceVisibility from "./actions/set-resource-visibility.js";
import shareResource from "./actions/share-resource.js";
import unshareResource from "./actions/unshare-resource.js";
import { assertWidgetShareScope } from "./widget-share-scope.js";

const SHARE_ACTIONS = [
  "share-resource",
  "unshare-resource",
  "set-resource-visibility",
];

function context(
  overrides: Partial<ActionRunContext> = {},
  grant?: Partial<NonNullable<ActionRunContext["mcpDirectoryWidgetWrite"]>>,
): ActionRunContext {
  return {
    caller: "mcp-widget-write",
    mcpDirectoryWidgetWrite: {
      appId: "content",
      resourceIds: { documentId: "doc-1", resourceType: "document" },
      actionNames: ["update-document", ...SHARE_ACTIONS],
      ...grant,
    },
    ...overrides,
  };
}

const ownDocument = { resourceType: "document", resourceId: "doc-1" };

describe("assertWidgetShareScope", () => {
  it("admits the granted resource through a granted action", () => {
    for (const action of SHARE_ACTIONS) {
      expect(() =>
        assertWidgetShareScope(context(), action, ownDocument),
      ).not.toThrow();
    }
  });

  it("leaves callers that are not a widget alone", () => {
    for (const caller of ["frontend", "mcp", "a2a", undefined] as const) {
      expect(() =>
        assertWidgetShareScope(
          { caller } as ActionRunContext,
          "share-resource",
          { resourceType: "form", resourceId: "anything" },
        ),
      ).not.toThrow();
    }
    expect(() =>
      assertWidgetShareScope(undefined, "share-resource", ownDocument),
    ).not.toThrow();
  });

  it.each([
    ["another document id", { ...ownDocument, resourceId: "doc-2" }],
    ["another resource type", { ...ownDocument, resourceType: "form" }],
    ["an empty resource id", { ...ownDocument, resourceId: "" }],
  ])("rejects %s", (_label, args) => {
    for (const action of SHARE_ACTIONS) {
      expect(() => assertWidgetShareScope(context(), action, args)).toThrow(
        ActionContractError,
      );
    }
  });

  it("rejects an action the grant does not name", () => {
    const grantWithoutVisibility = context(
      {},
      { actionNames: ["update-document", "share-resource"] },
    );
    expect(() =>
      assertWidgetShareScope(
        grantWithoutVisibility,
        "set-resource-visibility",
        ownDocument,
      ),
    ).toThrow(ActionContractError);
  });

  it("rejects a widget write with no grant, or a grant with no resource of its own", () => {
    expect(() =>
      assertWidgetShareScope(
        { caller: "mcp-widget-write" } as ActionRunContext,
        "share-resource",
        ownDocument,
      ),
    ).toThrow(ActionContractError);
    expect(() =>
      assertWidgetShareScope(
        context({}, { resourceIds: { resourceType: "document" } }),
        "share-resource",
        ownDocument,
      ),
    ).toThrow(ActionContractError);
    expect(() =>
      assertWidgetShareScope(
        context({}, { resourceIds: { documentId: "doc-1" } }),
        "share-resource",
        ownDocument,
      ),
    ).toThrow(ActionContractError);
  });

  it("does not take a database id for the document id", () => {
    const grant = context(
      {},
      {
        resourceIds: {
          documentId: "doc-1",
          databaseId: "db-1",
          resourceType: "document",
        },
      },
    );
    expect(() =>
      assertWidgetShareScope(grant, "share-resource", {
        resourceType: "document",
        resourceId: "db-1",
      }),
    ).toThrow(ActionContractError);
  });

  it("bounds a widget read that carries a write grant, and leaves a read-only ticket to its route", () => {
    const reading = context({ caller: "mcp-widget" });
    expect(() =>
      assertWidgetShareScope(reading, "list-resource-shares", ownDocument),
    ).not.toThrow();
    expect(() =>
      assertWidgetShareScope(reading, "list-resource-shares", {
        ...ownDocument,
        resourceId: "doc-2",
      }),
    ).toThrow(ActionContractError);
    expect(() =>
      assertWidgetShareScope(
        { caller: "mcp-widget", mcpDirectoryWidgetReadOnly: true },
        "list-resource-shares",
        { ...ownDocument, resourceId: "doc-2" },
      ),
    ).not.toThrow();
  });

  it("carries a 403 contract error", () => {
    try {
      assertWidgetShareScope(context(), "share-resource", {
        ...ownDocument,
        resourceId: "doc-2",
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        errorCode: "mcp_widget_write_scope_mismatch",
        statusCode: 403,
      });
    }
  });
});

describe("the share actions run the widget scope check before anything else", () => {
  const mismatched = context({}, {});
  const otherDocument = { resourceType: "document", resourceId: "doc-2" };
  const calls = [
    [
      "share-resource",
      () =>
        shareResource.run(
          {
            ...otherDocument,
            principalType: "user",
            principalId: "guest@example.com",
            role: "viewer",
            notify: false,
          } as never,
          mismatched,
        ),
    ],
    [
      "unshare-resource",
      () =>
        unshareResource.run(
          {
            ...otherDocument,
            principalType: "user",
            principalId: "guest@example.com",
          } as never,
          mismatched,
        ),
    ],
    [
      "set-resource-visibility",
      () =>
        setResourceVisibility.run(
          { ...otherDocument, visibility: "public" } as never,
          mismatched,
        ),
    ],
    [
      "list-resource-shares",
      () => listResourceShares.run(otherDocument as never, mismatched),
    ],
  ] as const;

  it.each(calls)("%s rejects another resource's id", async (_name, call) => {
    await expect(call()).rejects.toMatchObject({
      errorCode: "mcp_widget_write_scope_mismatch",
      statusCode: 403,
    });
  });
});
