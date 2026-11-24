import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as schema from "../server/db/schema.js";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  role: "viewer" as "owner" | "viewer",
  denied: new Set<string>(),
  reader: vi.fn(() => "reader@example.test"),
}));
vi.mock("@agent-native/core/sharing", () => ({ resolveAccess: mocks.access }));
vi.mock("@agent-native/core/server", () => ({
  getConfiguredAppBasePath: () => "",
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.reader,
  getRequestOrgId: () => undefined,
}));
vi.mock(
  "@agent-native/core/shared",
  () => import("../../../packages/core/src/shared/link-summary.js"),
);
vi.mock(
  "@agent-native/core/a2a",
  () => import("../../../packages/core/src/a2a/link-summary.js"),
);
vi.mock("../server/db/index.js", async () => ({
  getDb: () => db,
  schema: await import("../server/db/schema.js"),
}));

import action from "./read-link-summary.js";

const client = new PGlite();
let db: PgliteDatabase<typeof schema>;
const now = "2026-11-19T12:00:00.000Z";
const share = (id: string) => `https://clips.example.test/share/${id}`;
const direct = (id: string) => `https://clips.example.test/r/${id}`;

async function createQueryTable(table: PgTable) {
  const config = getTableConfig(table);
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  await client.exec(
    `create table ${quote(config.name)} (${config.columns
      .map((column) => `${quote(column.name)} ${column.getSQLType()}`)
      .join(", ")})`,
  );
}

async function seed(
  id: string,
  options: {
    visibility?: "private" | "org" | "public";
    password?: string | null;
    expiresAt?: string | null;
    trashedAt?: string | null;
    archivedAt?: string | null;
    failureCode?: string | null;
    editsJson?: string;
  } = {},
) {
  await db.insert(schema.recordings).values({
    id,
    organizationId: "fake-workspace",
    ownerEmail: "owner@example.test",
    title: `Walkthrough ${id}`,
    description: "",
    kind: "video",
    visibility: options.visibility ?? "public",
    password: options.password ?? null,
    expiresAt: options.expiresAt ?? null,
    trashedAt: options.trashedAt ?? null,
    archivedAt: options.archivedAt ?? null,
    failureCode: options.failureCode ?? null,
    editsJson: options.editsJson ?? "{}",
    createdAt: now,
    updatedAt: now,
  });
}

function available(url: string, id: string) {
  return {
    status: "available",
    app: "clips",
    kind: "recording",
    title: `Walkthrough ${id}`,
    url,
  };
}

describe("read-link-summary (Clips)", () => {
  beforeAll(async () => {
    db = drizzle(client, { schema });
    await createQueryTable(schema.recordings);
    await createQueryTable(schema.recordingShares);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(now));
  });
  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.role = "viewer";
    mocks.denied.clear();
    mocks.access.mockReset();
    mocks.access.mockImplementation(async (_type: string, id: string) => {
      if (mocks.denied.has(id)) return null;
      const rows = await db
        .select()
        .from(schema.recordings)
        .where(eq(schema.recordings.id, id));
      for (const row of rows) return { role: mocks.role, resource: row };
      return null;
    });
    await db.delete(schema.recordingShares);
    await db.delete(schema.recordings);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await client.close();
  });

  it("answers a Clip the reader can open with its title", async () => {
    await seed("open");
    await expect(
      action.run({
        links: [share("open"), `https://clips.example.test/embed/open`],
      }),
    ).resolves.toEqual({
      summaries: [
        available(share("open"), "open"),
        available("https://clips.example.test/embed/open", "open"),
      ],
    });
  });

  it("answers no access, a missing Clip, and a malformed link the same way", async () => {
    await seed("private", { visibility: "private" });
    mocks.denied.add("private");
    await expect(
      action.run({
        links: [
          share("private"),
          share("missing"),
          "https://clips.example.test/library",
          "not a link",
        ],
      }),
    ).resolves.toEqual({
      summaries: [
        { status: "unavailable" },
        { status: "unavailable" },
        { status: "unavailable" },
        { status: "unavailable" },
      ],
    });
  });

  it("hides a trashed, expired, or password-protected Clip from anyone but its owner", async () => {
    await seed("trashed", { trashedAt: now });
    await seed("expired", { expiresAt: "2026-11-01T00:00:00.000Z" });
    await seed("locked", { password: "fake-password-digest" });
    const ids = ["trashed", "expired", "locked"];
    expect(
      (await action.run({ links: [...ids.map(share), ...ids.map(direct)] }))
        .summaries,
    ).toEqual([...ids, ...ids].map(() => ({ status: "unavailable" })));
    mocks.role = "owner";
    expect((await action.run({ links: ids.map(direct) })).summaries).toEqual(
      ids.map((id) => available(direct(id), id)),
    );
  });

  it("answers a /share/ link to a trashed or expired Clip for no one, as its page does, even its owner", async () => {
    await seed("trashed", { trashedAt: now });
    await seed("expired", { expiresAt: "2026-11-01T00:00:00.000Z" });
    await seed("locked", { password: "fake-password-digest" });
    mocks.role = "owner";
    expect(
      (await action.run({ links: ["trashed", "expired", "locked"].map(share) }))
        .summaries,
    ).toEqual([
      { status: "unavailable" },
      { status: "unavailable" },
      available(share("locked"), "locked"),
    ]);
  });

  it("hides a taken-down Clip from everyone, and one held for redaction from all but its editors", async () => {
    await seed("taken-down", { failureCode: "taken_down" });
    await seed("redacting", {
      editsJson: JSON.stringify({
        burnInProgress: { staleUrls: ["https://media.example.test/old.mp4"] },
      }),
    });
    const links = [share("taken-down"), share("redacting")];
    expect((await action.run({ links })).summaries).toEqual([
      { status: "unavailable" },
      { status: "unavailable" },
    ]);
    mocks.role = "owner";
    expect((await action.run({ links })).summaries).toEqual([
      { status: "unavailable" },
      available(share("redacting"), "redacting"),
    ]);
  });

  it("answers an /embed/ link only for a public, passwordless, live Clip, as the embed does, even for its owner", async () => {
    const embed = (id: string) => `https://clips.example.test/embed/${id}`;
    const ids = [
      "public",
      "private",
      "locked",
      "archived",
      "trashed",
      "expired",
    ];
    await seed("public");
    await seed("private", { visibility: "private" });
    await seed("locked", { password: "fake-password-digest" });
    await seed("archived", { archivedAt: now });
    await seed("trashed", { trashedAt: now });
    await seed("expired", { expiresAt: "2026-11-01T00:00:00.000Z" });
    mocks.role = "owner";
    expect((await action.run({ links: ids.map(embed) })).summaries).toEqual([
      available(embed("public"), "public"),
      ...ids.slice(1).map(() => ({ status: "unavailable" })),
    ]);
  });

  it("answers a public Clip's /r/ link only with an explicit share, as its player does", async () => {
    await seed("public");
    expect((await action.run({ links: [direct("public")] })).summaries).toEqual(
      [{ status: "unavailable" }],
    );
    await db.insert(schema.recordingShares).values({
      id: "share-1",
      resourceId: "public",
      principalType: "user",
      principalId: "reader@example.test",
      role: "viewer",
      createdBy: "owner@example.test",
      createdAt: now,
    });
    expect((await action.run({ links: [direct("public")] })).summaries).toEqual(
      [available(direct("public"), "public")],
    );
  });
});
