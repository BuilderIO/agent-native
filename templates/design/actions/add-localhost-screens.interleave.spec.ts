/**
 * Real-database regression coverage for a localhost refresh racing canvas and
 * tweak writes while collab/file work is in flight.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  pglite: null as null | {
    close(): void;
    exec(sql: string): void;
    query<T extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<{ rows: T[] }>;
  },
  applyText: vi.fn(),
  hasCollabState: vi.fn(),
  seedFromText: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (config: unknown) => config,
  embedApp: (config: unknown) => config,
}));
vi.mock("@agent-native/core/collab", () => ({
  applyText: harness.applyText,
  hasCollabState: harness.hasCollabState,
  seedFromText: harness.seedFromText,
}));
vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: ({ to }: { to?: string }) => to ?? "/design/design_1",
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "user@example.com",
  getRequestOrgId: () => "org_1",
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn().mockResolvedValue({ role: "editor" }),
}));

vi.mock("../server/db/index.js", async () => {
  const [{ createRequire }, { drizzle }, pgliteCore] = await Promise.all([
    import("node:module"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pg-core"),
  ]);

  const designs = pgliteCore.pgTable("designs", {
    id: pgliteCore.text("id").primaryKey(),
    data: pgliteCore.text("data"),
    updatedAt: pgliteCore.text("updated_at"),
  });
  const designFiles = pgliteCore.pgTable("design_files", {
    id: pgliteCore.text("id").primaryKey(),
    designId: pgliteCore.text("design_id").notNull(),
    filename: pgliteCore.text("filename").notNull(),
    content: pgliteCore.text("content").notNull(),
    fileType: pgliteCore.text("file_type").notNull(),
    createdAt: pgliteCore.text("created_at"),
    updatedAt: pgliteCore.text("updated_at"),
  });
  const designLocalhostConnections = pgliteCore.pgTable(
    "design_localhost_connections",
    {
      id: pgliteCore.text("id").primaryKey(),
      name: pgliteCore.text("name").notNull(),
      sourceType: pgliteCore.text("source_type").notNull(),
      devServerUrl: pgliteCore.text("dev_server_url").notNull(),
      bridgeUrl: pgliteCore.text("bridge_url"),
      rootPath: pgliteCore.text("root_path"),
      routeManifest: pgliteCore.text("route_manifest").notNull(),
      capabilities: pgliteCore.text("capabilities").notNull(),
      status: pgliteCore.text("status").notNull(),
      lastSeenAt: pgliteCore.text("last_seen_at"),
      bridgeToken: pgliteCore.text("bridge_token"),
      ownerEmail: pgliteCore.text("owner_email").notNull(),
      orgId: pgliteCore.text("org_id"),
      createdAt: pgliteCore.text("created_at"),
      updatedAt: pgliteCore.text("updated_at"),
    },
  );

  const requireFromCore = createRequire(
    new URL("../../../packages/core/package.json", import.meta.url),
  );
  const Database = requireFromCore("@electric-sql/pglite").PGlite as new (
    filename: string,
  ) => NonNullable<typeof harness.pglite>;
  const pglite = await Database.create("memory://");
  await pglite.exec(`
    CREATE TABLE designs (
      id TEXT PRIMARY KEY,
      data TEXT,
      updated_at TEXT
    );
    CREATE TABLE design_files (
      id TEXT PRIMARY KEY,
      design_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      file_type TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE design_localhost_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      dev_server_url TEXT NOT NULL,
      bridge_url TEXT,
      root_path TEXT,
      route_manifest TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      status TEXT NOT NULL,
      last_seen_at TEXT,
      bridge_token TEXT,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  const schema = { designs, designFiles, designLocalhostConnections };
  const db = drizzle(pglite as never, { schema });
  harness.pglite = pglite;
  return { getDb: () => db, schema };
});

import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import action from "./add-localhost-screens.js";

const manifest = JSON.stringify({
  version: 1,
  sourceType: "localhost",
  devServerUrl: "http://localhost:5173",
  routes: [
    {
      id: "route-settings",
      path: "/settings",
      title: "Settings",
      sourceFile: "app/routes/settings.tsx",
      sourceKind: "react-router",
      metadata: { snapshotRef: "snapshot-current" },
    },
  ],
  generatedAt: "2026-07-09T00:00:00.000Z",
});

function getPglite() {
  if (!harness.pglite) {
    throw new Error("PGlite test database is not initialized");
  }
  return harness.pglite;
}

async function seedDesign(data: string | null) {
  await getPglite().query(
    "INSERT INTO designs (id, data, updated_at) VALUES ($1, $2, $3)",
    ["design_1", data, "2026-07-09T00:00:00.000Z"],
  );
}

async function seedConnection() {
  await getPglite().query(
    `INSERT INTO design_localhost_connections (
        id, name, source_type, dev_server_url, bridge_url, root_path,
        route_manifest, capabilities, status, bridge_token, owner_email,
        org_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      "conn_1",
      "Example app",
      "localhost",
      "http://localhost:5173",
      "http://127.0.0.1:7331",
      "/tmp/example-app",
      manifest,
      "[]",
      "connected",
      "example-bridge-token",
      "user@example.com",
      "org_1",
      "2026-07-09T00:00:00.000Z",
      "2026-07-09T00:00:00.000Z",
    ],
  );
}

async function seedExistingFile() {
  await getPglite().query(
    `INSERT INTO design_files (
        id, design_id, filename, content, file_type, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      "file_1",
      "design_1",
      "localhost-settings.html",
      "http://localhost:5173/settings?old=1",
      "html",
      "2026-07-09T00:00:00.000Z",
      "2026-07-09T00:00:00.000Z",
    ],
  );
}

async function persistedData(): Record<string, any> {
  const { rows } = await getPglite().query<{ data: string | null }>(
    "SELECT data FROM designs WHERE id = $1",
    ["design_1"],
  );
  const row = rows[0];
  if (!row) throw new Error("Design row was not seeded");
  return JSON.parse(row.data ?? "null") as Record<string, any>;
}

beforeEach(async () => {
  await getPglite().exec(
    "DELETE FROM design_files; DELETE FROM design_localhost_connections; DELETE FROM designs;",
  );
  vi.clearAllMocks();
  harness.applyText.mockResolvedValue(undefined);
  harness.hasCollabState.mockResolvedValue(false);
  harness.seedFromText.mockResolvedValue(undefined);
  await seedConnection();
});

afterAll(async () => {
  await harness.pglite?.close();
});

describe("add-localhost-screens concurrent design data writes", () => {
  it("merges an in-flight sibling write and only wins fields the refresh explicitly owns", async () => {
    await seedDesign(
      JSON.stringify({
        keep: { untouched: true },
        canvasFrames: {
          file_1: { x: 10, y: 20, width: 1280, height: 900, z: 1 },
        },
        screenMetadata: {
          file_1: {
            sourceType: "localhost",
            connectionId: "conn_1",
            routeId: "route-settings",
            path: "/settings",
            title: "Old title",
            routeMetadata: { existing: true },
          },
        },
        localhostScreens: {
          file_1: {
            sourceType: "localhost",
            connectionId: "conn_1",
            routeId: "route-settings",
            path: "/settings",
            legacyBefore: true,
          },
        },
      }),
    );
    await seedExistingFile();

    let releaseApplyText!: () => void;
    let markApplyTextReached!: () => void;
    const applyTextReached = new Promise<void>((resolve) => {
      markApplyTextReached = resolve;
    });
    const applyTextReleased = new Promise<void>((resolve) => {
      releaseApplyText = resolve;
    });
    harness.hasCollabState.mockResolvedValue(true);
    harness.applyText.mockImplementation(async () => {
      markApplyTextReached();
      await applyTextReleased;
    });

    const refresh = action.run({
      designId: "design_1",
      connectionId: "conn_1",
      routes: [{ path: "/settings", x: 42 }],
      startX: 0,
      startY: 0,
      gap: 160,
    });
    await Promise.race([
      applyTextReached,
      refresh.then(
        () => {
          throw new Error("refresh completed before reaching collab update");
        },
        (error) => {
          throw error;
        },
      ),
    ]);

    // This commits after add-localhost-screens read its initial snapshot but
    // before that action persists metadata. It represents a simultaneous
    // canvas move/resize plus tweak and per-screen state edits.
    await mutateDesignData({
      designId: "design_1",
      mutate: (current) => ({
        ...current,
        tweakSelections: { accent: "blue" },
        canvasFrames: {
          ...(current.canvasFrames as Record<string, unknown>),
          file_1: {
            x: 777,
            y: 333,
            width: 420,
            height: 860,
            rotation: 12,
            z: 9,
          },
        },
        screenMetadata: {
          ...(current.screenMetadata as Record<string, unknown>),
          file_1: {
            ...((current.screenMetadata as Record<string, any>).file_1 ?? {}),
            title: "Concurrent title",
            canonicalOnly: "keep-canonical",
            routeMetadata: { existing: true, concurrent: true },
          },
        },
        localhostScreens: {
          ...(current.localhostScreens as Record<string, unknown>),
          file_1: {
            ...((current.localhostScreens as Record<string, any>).file_1 ?? {}),
            legacyOnly: "keep-legacy",
          },
        },
      }),
      isApplied: (data) =>
        (data.tweakSelections as Record<string, unknown>)?.accent === "blue",
    });
    releaseApplyText();

    const result = await refresh;
    const data = await persistedData();
    expect(data.keep).toEqual({ untouched: true });
    expect(data.tweakSelections).toEqual({ accent: "blue" });
    expect(data.canvasFrames.file_1).toEqual({
      // Explicit refresh fields win.
      x: 42,
      // Omitted fields keep the concurrent canvas edit.
      y: 333,
      width: 420,
      height: 860,
      rotation: 12,
      z: 9,
    });
    expect(data.screenMetadata.file_1).toMatchObject({
      title: "Settings",
      width: 420,
      height: 860,
      canonicalOnly: "keep-canonical",
      legacyOnly: "keep-legacy",
      routeMetadata: {
        existing: true,
        concurrent: true,
        snapshotRef: "snapshot-current",
      },
    });
    expect(data.localhostScreens.file_1).toMatchObject({
      title: "Settings",
      canonicalOnly: "keep-canonical",
      legacyOnly: "keep-legacy",
    });
    expect(result.placedFrames[0]?.frame).toEqual(data.canvasFrames.file_1);
  });

  it("accepts a legacy NULL data blob as empty data", async () => {
    await seedDesign(null);

    await action.run({
      designId: "design_1",
      connectionId: "conn_1",
      paths: ["/settings"],
      startX: 0,
      startY: 0,
      gap: 160,
    });

    await expect(persistedData()).resolves.toMatchObject({
      sourceType: "localhost",
      sourceMode: "localhost",
      connectionId: "conn_1",
    });
  });

  it("rejects malformed persisted JSON before changing files or collab state", async () => {
    await seedDesign("{broken-json");
    await seedExistingFile();

    await expect(
      action.run({
        designId: "design_1",
        connectionId: "conn_1",
        paths: ["/settings"],
        startX: 0,
        startY: 0,
        gap: 160,
      }),
    ).rejects.toThrow("invalid data JSON");

    const { rows } = await getPglite().query<{ content: string }>(
      "SELECT content FROM design_files WHERE id = $1",
      ["file_1"],
    );
    const file = rows[0];
    if (!file) throw new Error("Design file row was not seeded");
    expect(file.content).toBe("http://localhost:5173/settings?old=1");
    expect(harness.applyText).not.toHaveBeenCalled();
    expect(harness.seedFromText).not.toHaveBeenCalled();
  });
});
