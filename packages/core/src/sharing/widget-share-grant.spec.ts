import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CHATGPT_DIRECTORY_PROFILE as slidesProfile } from "../../../../templates/slides/server/lib/chatgpt-directory-tools.js";
import { createTestPglite } from "../a2a/test-pglite.js";
import type { ActionRunContext } from "../action.js";
import { table, text, ownableColumns } from "../db/schema.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  createMcpDirectoryWidgetWriteCapability,
  getMcpDirectoryWidgetWriteCapabilityGrant,
  normalizeMcpDirectoryWidgetReadActionArguments,
  normalizeMcpDirectoryWidgetWriteActionArguments,
  type McpDirectoryWidgetReadArgument,
} from "../shared/embed-auth.js";
import { ForbiddenError } from "./access.js";
import listResourceShares from "./actions/list-resource-shares.js";
import setResourceVisibility from "./actions/set-resource-visibility.js";
import shareResource from "./actions/share-resource.js";
import unshareResource from "./actions/unshare-resource.js";
import { registerShareableResource } from "./registry.js";
import { createSharesTable } from "./schema.js";

const ownerEmail = "owner+deck@example.com";
const adminEmail = "admin+deck@example.com";
const editorEmail = "editor+deck@example.com";
const teammateEmail = "teammate+deck@example.com";
const orgId = "org-deck";
const appId = "slides";
const resourceUri = "ui://slides/shell-v69";
const deckA = "deck-a";
const deckB = "deck-b";

const decks = table("widget_grant_decks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ...ownableColumns(),
});
const deckShares = createSharesTable("widget_grant_deck_shares");

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  pglite = await createTestPglite();
  await pglite.exec(`
    CREATE TABLE widget_grant_decks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
    CREATE TABLE widget_grant_deck_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      notified_at TEXT
    );
  `);
  db = drizzle(pglite.db);
  registerShareableResource({
    type: "deck",
    resourceTable: decks,
    sharesTable: deckShares,
    displayName: "Deck",
    titleColumn: "title",
    getDb: () => db,
  });
  await db.insert(decks).values([
    { id: deckA, title: "A", ownerEmail, orgId, visibility: "private" },
    { id: deckB, title: "B", ownerEmail, orgId, visibility: "private" },
  ]);
  await db.insert(deckShares).values(
    [
      { id: "share-admin", principalId: adminEmail, role: "admin" },
      { id: "share-editor", principalId: editorEmail, role: "editor" },
    ].map((share) => ({
      ...share,
      resourceId: deckA,
      principalType: "user",
      createdBy: ownerEmail,
      createdAt: new Date().toISOString(),
    })),
  );
});

afterEach(async () => {
  await pglite.close();
});

// Mints the write grant the Slides profile gives its deck editors (the server
// does this for anyone authorizeWidgetWrite accepts: editor access or above).
function mintGrant(userEmail: string) {
  const target = slidesProfile.widgetTargets["create-deck"]({}, { id: deckA })!;
  const materialize = (rules: Record<string, McpDirectoryWidgetReadArgument>) =>
    Object.fromEntries(
      Object.entries(rules).map(([name, rule]) => [
        name,
        typeof rule === "string" ? target.resourceIds[rule]! : rule,
      ]),
    );
  const readRules = slidesProfile.widgetReadActionArguments as Record<
    string,
    Record<string, McpDirectoryWidgetReadArgument>
  >;
  const writeRules = slidesProfile.widgetWriteActionArguments as Record<
    string,
    Record<string, McpDirectoryWidgetReadArgument>
  >;
  const scope = createMcpDirectoryWidgetWriteCapability({
    appId,
    resourceUri,
    resourceIds: target.resourceIds,
    userEmail,
    orgId,
    expiresAtMs: Date.now() + 60_000,
    readActionArguments: Object.fromEntries(
      Object.entries(readRules).map(([name, rules]) => [
        name,
        materialize(rules),
      ]),
    ),
    writeActionArguments: Object.fromEntries(
      Object.entries(writeRules)
        .filter(([name]) => target.writeActions.includes(name))
        .map(([name, rules]) => [name, materialize(rules)]),
    ),
  });
  if (!scope) throw new Error("Failed to mint the Slides write capability.");
  return {
    scope,
    context: {
      userEmail,
      orgId,
      appId,
      caller: "mcp-widget-write",
      mcpDirectoryWidgetWrite: {
        appId,
        ...getMcpDirectoryWidgetWriteCapabilityGrant(scope, {
          appId,
          resourceUri,
          userEmail,
          orgId,
        })!,
      },
    } satisfies ActionRunContext,
  };
}

// The route normalizes the call against the capability, then runs the action
// in the user's request context, as action-routes.ts does for a widget write.
async function widgetCall(
  userEmail: string,
  actionName:
    | "share-resource"
    | "unshare-resource"
    | "set-resource-visibility"
    | "list-resource-shares",
  args: Record<string, unknown>,
) {
  const { scope, context } = mintGrant(userEmail);
  const reading = actionName === "list-resource-shares";
  const rules = (
    reading
      ? slidesProfile.widgetReadActionArguments
      : slidesProfile.widgetWriteActionArguments
  ) as Record<string, Record<string, unknown>>;
  const input = {
    actionName,
    appId,
    resourceUri,
    userEmail,
    orgId,
    args,
    allowedArgumentNames: Object.keys(rules[actionName] ?? {}),
  };
  const normalized = reading
    ? normalizeMcpDirectoryWidgetReadActionArguments(scope, input)
    : normalizeMcpDirectoryWidgetWriteActionArguments(scope, input);
  if (!normalized) throw new Error(`${actionName} was not admitted.`);
  const action = {
    "share-resource": shareResource,
    "unshare-resource": unshareResource,
    "set-resource-visibility": setResourceVisibility,
    "list-resource-shares": listResourceShares,
  }[actionName];
  return runWithRequestContext({ userEmail, orgId }, () =>
    action.run(normalized as never, context),
  );
}

const shareArgs = (resourceId = deckA) => ({
  resourceType: "deck",
  resourceId,
  principalType: "user",
  principalId: teammateEmail,
  role: "viewer",
  notify: false,
});
const unshareArgs = (resourceId = deckA) => ({
  resourceType: "deck",
  resourceId,
  principalType: "user",
  principalId: editorEmail,
});
const visibilityArgs = (resourceId = deckA) => ({
  resourceType: "deck",
  resourceId,
  visibility: "org",
});

async function sharesOf(resourceId: string) {
  return (
    await db
      .select({ principalId: deckShares.principalId, role: deckShares.role })
      .from(deckShares)
      .where(eq(deckShares.resourceId, resourceId))
  )
    .map((share) => `${share.principalId}:${share.role}`)
    .sort();
}

async function visibilityOf(resourceId: string) {
  const [deck] = await db.select().from(decks).where(eq(decks.id, resourceId));
  return deck?.visibility;
}

describe("Slides widget write grant versus the share actions' own access checks", () => {
  it("lets an editor hold the grant but not change sharing", async () => {
    const before = await sharesOf(deckA);

    await expect(
      widgetCall(editorEmail, "share-resource", shareArgs()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      widgetCall(editorEmail, "unshare-resource", unshareArgs()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      widgetCall(editorEmail, "set-resource-visibility", visibilityArgs()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      widgetCall(editorEmail, "set-resource-visibility", {
        ...visibilityArgs(),
        visibility: "public",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await sharesOf(deckA)).toEqual(before);
    expect(await visibilityOf(deckA)).toBe("private");
    await expect(
      widgetCall(editorEmail, "list-resource-shares", {
        resourceType: "deck",
        resourceId: deckA,
      }),
    ).resolves.toMatchObject({ role: "editor", visibility: "private" });
  });

  it.each([
    ["an admin", adminEmail],
    ["the owner", ownerEmail],
  ])(
    "lets %s share, change visibility, and unshare through the grant",
    async (_label, userEmail) => {
      await expect(
        widgetCall(userEmail, "share-resource", shareArgs()),
      ).resolves.toMatchObject({ updated: false });
      await expect(
        widgetCall(userEmail, "set-resource-visibility", visibilityArgs()),
      ).resolves.toMatchObject({ ok: true, visibility: "org" });
      await expect(
        widgetCall(userEmail, "unshare-resource", unshareArgs()),
      ).resolves.toMatchObject({ ok: true });

      expect(await sharesOf(deckA)).toContain(`${teammateEmail}:viewer`);
      expect(await sharesOf(deckA)).not.toContain(`${editorEmail}:editor`);
      expect(await visibilityOf(deckA)).toBe("org");
    },
  );

  it("blocks a deck other than the grant's even when the route let the call through", async () => {
    const { context } = mintGrant(adminEmail);

    await runWithRequestContext({ userEmail: adminEmail, orgId }, async () => {
      await expect(
        shareResource.run(shareArgs(deckB) as never, context),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        setResourceVisibility.run(visibilityArgs(deckB) as never, context),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        unshareResource.run(unshareArgs(deckB) as never, context),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    expect(await sharesOf(deckB)).toEqual([]);
    expect(await visibilityOf(deckB)).toBe("private");
  });
});

describe("share actions repeat the widget grant binding", () => {
  const writeActions = [
    ["share-resource", shareResource, shareArgs],
    ["unshare-resource", unshareResource, unshareArgs],
    ["set-resource-visibility", setResourceVisibility, visibilityArgs],
  ] as const;

  function widgetWriteContext(
    overrides: {
      resourceIds?: Record<string, string>;
      actionNames?: readonly string[];
      withGrant?: boolean;
    } = {},
  ): ActionRunContext {
    const { context } = mintGrant(ownerEmail);
    const grant = context.mcpDirectoryWidgetWrite;
    return {
      userEmail: ownerEmail,
      orgId,
      appId,
      caller: "mcp-widget-write",
      ...(overrides.withGrant === false
        ? {}
        : {
            mcpDirectoryWidgetWrite: {
              ...grant,
              ...(overrides.resourceIds
                ? { resourceIds: overrides.resourceIds }
                : {}),
              ...(overrides.actionNames
                ? { actionNames: overrides.actionNames }
                : {}),
            },
          }),
    };
  }

  // The owner owns both decks, so only the grant check can refuse deck B.
  const asOwner = <T>(run: () => Promise<T>) =>
    runWithRequestContext({ userEmail: ownerEmail, orgId }, run);

  it.each(writeActions)(
    "%s refuses a widget write with no grant",
    async (_name, action, argsFor) => {
      await expect(
        asOwner(() =>
          action.run(
            argsFor() as never,
            widgetWriteContext({ withGrant: false }),
          ),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    },
  );

  it.each(writeActions)(
    "%s refuses a deck, resource type or action outside the grant",
    async (name, action, argsFor) => {
      const other = widgetWriteContext({
        resourceIds: { deckId: deckB, resourceType: "deck" },
      });
      await expect(
        asOwner(() => action.run(argsFor(deckA) as never, other)),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await expect(
        asOwner(() =>
          action.run(
            { ...argsFor(), resourceType: "document" } as never,
            widgetWriteContext(),
          ),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await expect(
        asOwner(() =>
          action.run(
            argsFor() as never,
            widgetWriteContext({
              resourceIds: { deckId: deckA },
            }),
          ),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await expect(
        asOwner(() =>
          action.run(
            argsFor() as never,
            widgetWriteContext({
              actionNames: writeActions
                .map(([actionName]) => actionName)
                .filter((actionName) => actionName !== name),
            }),
          ),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);

      expect(await sharesOf(deckA)).toContain(`${editorEmail}:editor`);
      expect(await visibilityOf(deckA)).toBe("private");
    },
  );

  it.each(writeActions)(
    "%s refuses a mutation from a read-only widget session",
    async (_name, action, argsFor) => {
      await expect(
        asOwner(() =>
          action.run(argsFor() as never, {
            userEmail: ownerEmail,
            orgId,
            appId,
            caller: "mcp-widget",
            mcpDirectoryWidgetResourceIds: {
              deckId: deckA,
              resourceType: "deck",
            },
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    },
  );

  it("leaves callers that are not a widget alone", async () => {
    await expect(
      asOwner(() =>
        shareResource.run(shareArgs(deckB) as never, {
          userEmail: ownerEmail,
          orgId,
          caller: "frontend",
        }),
      ),
    ).resolves.toMatchObject({ updated: false });
    expect(await sharesOf(deckB)).toContain(`${teammateEmail}:viewer`);
  });

  describe("list-resource-shares", () => {
    const readContext = (
      resourceIds?: Record<string, string>,
    ): ActionRunContext => ({
      userEmail: ownerEmail,
      orgId,
      appId,
      caller: "mcp-widget",
      mcpDirectoryWidgetReadOnly: true,
      ...(resourceIds ? { mcpDirectoryWidgetResourceIds: resourceIds } : {}),
    });
    const listArgs = (resourceId: string, resourceType = "deck") =>
      ({ resourceType, resourceId }) as never;

    it("reads the deck a read-only widget session is bound to", async () => {
      await expect(
        asOwner(() =>
          listResourceShares.run(
            listArgs(deckA),
            readContext({ deckId: deckA, resourceType: "deck" }),
          ),
        ),
      ).resolves.toMatchObject({ role: "owner" });
    });

    it.each([
      ["no resource ids", undefined, deckA, "deck"],
      ["another deck", { deckId: deckA, resourceType: "deck" }, deckB, "deck"],
      [
        "another resource type",
        { deckId: deckA, resourceType: "deck" },
        deckA,
        "document",
      ],
      ["no resource type", { deckId: deckA }, deckA, "deck"],
    ])(
      "refuses a read-only widget session with %s",
      async (_label, resourceIds, resourceId, resourceType) => {
        await expect(
          asOwner(() =>
            listResourceShares.run(
              listArgs(resourceId, resourceType),
              readContext(resourceIds),
            ),
          ),
        ).rejects.toBeInstanceOf(ForbiddenError);
      },
    );

    it("takes the write grant's resource when the capability is a write one", async () => {
      const { context } = mintGrant(ownerEmail);

      await expect(
        asOwner(() =>
          listResourceShares.run(listArgs(deckA), {
            ...context,
            caller: "mcp-widget",
          }),
        ),
      ).resolves.toMatchObject({ role: "owner" });
      await expect(
        asOwner(() =>
          listResourceShares.run(listArgs(deckB), {
            ...context,
            caller: "mcp-widget",
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
