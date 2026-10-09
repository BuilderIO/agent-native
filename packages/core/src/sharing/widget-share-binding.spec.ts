import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { ActionRunContext } from "../action.js";
import { table, text, ownableColumns } from "../db/schema.js";
import { runWithRequestContext } from "../server/request-context.js";
import { ForbiddenError } from "./access.js";
import listResourceShares from "./actions/list-resource-shares.js";
import setResourceVisibility from "./actions/set-resource-visibility.js";
import shareResource from "./actions/share-resource.js";
import unshareResource from "./actions/unshare-resource.js";
import { registerShareableResource } from "./registry.js";
import { createSharesTable } from "./schema.js";

vi.mock("../db/client.js", () => {
  return {
    getDbExec: () => sharedClient,
    getScopedDbExec: () => undefined,
    isProductionServerlessFunctionRuntime: () => false,
    retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
  };
});

interface FrameworkClient {
  execute(arg: string | { sql: string; args: any[] }): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
}

let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

const resourceType = "widget-doc";
const ownerEmail = "owner+qa@example.com";
const outsiderEmail = "outsider+qa@example.com";
const friendEmail = "friend+qa@example.com";

const docs = table("widget_docs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ...ownableColumns(),
});
const docShares = createSharesTable("widget_doc_shares");

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  pglite = await createTestPglite();
  await pglite.exec(`
    CREATE TABLE widget_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
    CREATE TABLE widget_doc_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      notified_at TEXT
    );
    INSERT INTO widget_docs (id, title, owner_email)
      VALUES ('doc-x', 'X', '${ownerEmail}'), ('doc-y', 'Y', '${ownerEmail}');
    INSERT INTO widget_doc_shares (id, resource_id, principal_type, principal_id, role, created_by, created_at)
      VALUES ('share-y', 'doc-y', 'user', '${friendEmail}', 'viewer', '${ownerEmail}', '2026-01-01'),
             ('share-x', 'doc-x', 'user', '${friendEmail}', 'viewer', '${ownerEmail}', '2026-01-01');
  `);
  db = drizzle(pglite.db);

  sharedClient = {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      const stmt = await pglite.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        const rows = (await stmt.all(...args)) as any[];
        return { rows, rowsAffected: 0 };
      }
      const result = await stmt.run(...args);
      return { rows: [], rowsAffected: Number(result.changes ?? 0) };
    },
  };

  registerShareableResource({
    type: resourceType,
    resourceTable: docs,
    sharesTable: docShares,
    displayName: "Widget Doc",
    titleColumn: "title",
    getDb: () => db,
  });
});

afterEach(async () => {
  await pglite.close();
});

async function snapshot() {
  const resources = await pglite
    .prepare("SELECT id, visibility FROM widget_docs ORDER BY id")
    .all();
  const shares = await pglite
    .prepare(
      "SELECT id, resource_id, principal_id, role FROM widget_doc_shares ORDER BY id",
    )
    .all();
  return { resources, shares };
}

const SHARE_ACTIONS = [
  "share-resource",
  "unshare-resource",
  "set-resource-visibility",
  "list-resource-shares",
] as const;

function grant(
  overrides: Partial<
    NonNullable<ActionRunContext["mcpDirectoryWidgetWrite"]>
  > = {},
): NonNullable<ActionRunContext["mcpDirectoryWidgetWrite"]> {
  return {
    appId: "widget-app",
    resourceIds: { docResourceType: resourceType, docId: "doc-x" },
    actionNames: SHARE_ACTIONS,
    ...overrides,
  };
}

function widgetContext(
  actionName: string,
  mcpDirectoryWidgetWrite?: ActionRunContext["mcpDirectoryWidgetWrite"],
  userEmail = ownerEmail,
): ActionRunContext {
  return {
    caller: "mcp-widget-write",
    actionName,
    userEmail,
    ...(mcpDirectoryWidgetWrite ? { mcpDirectoryWidgetWrite } : {}),
  };
}

const cases = [
  {
    name: "share-resource",
    action: shareResource,
    args: (resourceId: string, type = resourceType) => ({
      resourceType: type,
      resourceId,
      principalType: "user",
      principalId: "new+qa@example.com",
      role: "viewer",
      notify: false,
    }),
  },
  {
    name: "unshare-resource",
    action: unshareResource,
    args: (resourceId: string, type = resourceType) => ({
      resourceType: type,
      resourceId,
      principalType: "user",
      principalId: friendEmail,
    }),
  },
  {
    name: "set-resource-visibility",
    action: setResourceVisibility,
    args: (resourceId: string, type = resourceType) => ({
      resourceType: type,
      resourceId,
      visibility: "public",
    }),
  },
  {
    name: "list-resource-shares",
    action: listResourceShares,
    args: (resourceId: string, type = resourceType) => ({
      resourceType: type,
      resourceId,
    }),
  },
] as const;

describe.each(cases)("$name widget grant binding", (c) => {
  const run = (
    args: Record<string, unknown>,
    ctx: ActionRunContext | undefined,
    userEmail = ownerEmail,
  ) =>
    runWithRequestContext({ userEmail }, () =>
      (c.action.run as (a: any, ctx?: ActionRunContext) => Promise<any>)(
        args,
        ctx,
      ),
    );

  it("rejects a widget write caller with no grant", async () => {
    const before = await snapshot();
    await expect(
      run(c.args("doc-x"), widgetContext(c.name)),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "mcp_widget_grant_required",
    });
    expect(await snapshot()).toEqual(before);
  });

  it("rejects a grant for doc-x acting on doc-y", async () => {
    const before = await snapshot();
    await expect(
      run(c.args("doc-y"), widgetContext(c.name, grant())),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "mcp_widget_resource_mismatch",
    });
    expect(await snapshot()).toEqual(before);
  });

  it("rejects the right id under the wrong resourceType", async () => {
    const before = await snapshot();
    await expect(
      run(c.args("doc-x", "other-doc"), widgetContext(c.name, grant())),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "mcp_widget_resource_mismatch",
    });
    expect(await snapshot()).toEqual(before);
  });

  it("does not let the resource type value stand in for the resource id", async () => {
    // A doc whose id equals the granted resourceType must not match just
    // because that string is among the grant's values.
    await pglite.exec(
      `INSERT INTO widget_docs (id, title, owner_email) VALUES ('${resourceType}', 'T', '${ownerEmail}')`,
    );
    const before = await snapshot();
    await expect(
      run(c.args(resourceType), widgetContext(c.name, grant())),
    ).rejects.toMatchObject({ errorCode: "mcp_widget_resource_mismatch" });
    expect(await snapshot()).toEqual(before);
  });

  it("rejects a grant that does not list this action", async () => {
    const before = await snapshot();
    await expect(
      run(
        c.args("doc-x"),
        widgetContext(
          c.name,
          grant({ actionNames: SHARE_ACTIONS.filter((n) => n !== c.name) }),
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "mcp_widget_action_not_allowed",
    });
    expect(await snapshot()).toEqual(before);
  });

  it("proceeds to the normal admin check when the binding matches", async () => {
    if (c.name === "list-resource-shares") {
      // list-resource-shares returns an empty shape (not a throw) without access.
      await expect(
        run(
          c.args("doc-x"),
          widgetContext(c.name, grant(), outsiderEmail),
          outsiderEmail,
        ),
      ).resolves.toMatchObject({ ownerEmail: null, shares: [] });
      return;
    }
    const before = await snapshot();
    await expect(
      run(
        c.args("doc-x"),
        widgetContext(c.name, grant(), outsiderEmail),
        outsiderEmail,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await snapshot()).toEqual(before);
  });

  it("runs for the owner when the binding matches", async () => {
    const result = await run(c.args("doc-x"), widgetContext(c.name, grant()));
    if (c.name === "list-resource-shares") {
      expect(result).toMatchObject({
        ownerEmail,
        shares: [expect.objectContaining({ principalId: friendEmail })],
      });
    } else {
      expect(result).toBeTruthy();
    }
  });

  it("leaves non-widget callers unchanged", async () => {
    for (const ctx of [
      undefined,
      { caller: "frontend", actionName: c.name, userEmail: ownerEmail },
      { caller: "tool", actionName: c.name, userEmail: ownerEmail },
      // A grant bound to a different doc is irrelevant to a non-widget caller.
      {
        caller: "frontend",
        actionName: c.name,
        userEmail: ownerEmail,
        mcpDirectoryWidgetWrite: grant({
          resourceIds: { docResourceType: resourceType, docId: "doc-z" },
        }),
      },
    ] as Array<ActionRunContext | undefined>) {
      await expect(run(c.args("doc-y"), ctx)).resolves.toBeTruthy();
    }
  });
});

describe("list-resource-shares through a write grant on a read request", () => {
  // A GET made with a write capability reaches the action as caller
  // "mcp-widget" with the grant attached (action-routes.ts).
  const readContext = (
    mcpDirectoryWidgetWrite?: ActionRunContext["mcpDirectoryWidgetWrite"],
  ): ActionRunContext => ({
    caller: "mcp-widget",
    actionName: "list-resource-shares",
    userEmail: ownerEmail,
    mcpDirectoryWidgetReadOnly: true,
    ...(mcpDirectoryWidgetWrite ? { mcpDirectoryWidgetWrite } : {}),
  });
  const run = (resourceId: string, ctx: ActionRunContext) =>
    runWithRequestContext({ userEmail: ownerEmail }, () =>
      (listResourceShares.run as (a: any, ctx?: ActionRunContext) => any)(
        { resourceType, resourceId },
        ctx,
      ),
    );

  it("rejects a grant for another doc", async () => {
    await expect(
      run("doc-y", readContext(grant({ actionNames: ["update-doc"] }))),
    ).rejects.toMatchObject({ errorCode: "mcp_widget_resource_mismatch" });
  });

  it("accepts the granted doc without requiring a read action in actionNames", async () => {
    await expect(
      run("doc-x", readContext(grant({ actionNames: ["update-doc"] }))),
    ).resolves.toMatchObject({ ownerEmail });
  });

  it("leaves a read-only ticket (no grant in context) to the gate", async () => {
    await expect(run("doc-y", readContext())).resolves.toMatchObject({
      ownerEmail,
    });
  });
});
