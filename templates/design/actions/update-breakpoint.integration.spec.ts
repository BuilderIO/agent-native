import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const localDb = vi.hoisted(() => ({
  pglite: null as null | {
    query(
      sql: string,
      args?: unknown[],
    ): Promise<{ rows: Array<Record<string, unknown>> }>;
    close(): Promise<void>;
  },
}));

const collabState = vi.hoisted(() => ({
  live: new Map<string, string>(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn().mockResolvedValue({ role: "editor" }),
}));

vi.mock("@agent-native/core/collab", () => ({
  applyText: vi.fn(
    async (
      id: string,
      content: string,
      _field: string,
      _source: string,
      options?: { validateBase?: (base: string) => void },
    ) => {
      options?.validateBase?.(collabState.live.get(id) ?? "");
      collabState.live.set(id, content);
      return content;
    },
  ),
  hasCollabState: vi.fn(async (id: string) => collabState.live.has(id)),
  seedFromText: vi.fn(async (id: string, content: string) => {
    collabState.live.set(id, content);
  }),
}));

vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: vi.fn(),
}));

vi.mock("../server/db/index.js", async () => {
  const [{ drizzle }, pgCore, { createRequire }] = await Promise.all([
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pg-core"),
    import("node:module"),
  ]);
  const { PGlite } = createRequire(
    new URL("../../../../packages/core/package.json", import.meta.url),
  )("@electric-sql/pglite");
  const designs = pgCore.pgTable("designs", {
    id: pgCore.text("id").primaryKey(),
    data: pgCore.text("data").notNull(),
    updatedAt: pgCore.text("updated_at"),
  });
  const designFiles = pgCore.pgTable("design_files", {
    id: pgCore.text("id").primaryKey(),
    designId: pgCore.text("design_id").notNull(),
    content: pgCore.text("content").notNull(),
    fileType: pgCore.text("file_type").notNull(),
    contentOperationSource: pgCore.text("content_operation_source"),
    contentOperationRevision: pgCore.integer("content_operation_revision"),
    contentOperationResultHash: pgCore.text("content_operation_result_hash"),
    updatedAt: pgCore.text("updated_at"),
  });
  const pglite = await PGlite.create("memory://");
  await pglite.query(
    "CREATE TABLE designs (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT)",
  );
  await pglite.query(
    "CREATE TABLE design_files (id TEXT PRIMARY KEY, design_id TEXT NOT NULL, content TEXT NOT NULL, file_type TEXT NOT NULL, content_operation_source TEXT, content_operation_revision INTEGER, content_operation_result_hash TEXT, updated_at TEXT)",
  );
  localDb.pglite = pglite;
  return {
    getDb: () => drizzle(pglite, { schema: { designs, designFiles } }),
    schema: { designs, designFiles },
  };
});

import {
  getBreakpointMediaDeclarations,
  injectManagedBreakpointCss,
} from "../shared/breakpoint-media.js";
import updateBreakpoint from "./update-breakpoint.js";

const managedHtml = `<!doctype html><html><head><style data-agent-native-breakpoints>
@media (max-width: 1279px) {
  [data-agent-native-node-id="hero"] {
    left: 137px;
  }
}

@media (max-width: 809px) {
  [data-agent-native-node-id="hero"] {
    top: 24px;
  }
}
</style></head><body><div data-agent-native-node-id="hero">x</div></body></html>`;

const designData = {
  breakpointSet: {
    id: "set-1",
    breakpoints: [
      { id: "phone", label: "Phone", widthPx: 390, prefix: "base" },
      { id: "tablet", label: "Tablet", widthPx: 810, prefix: "md" },
    ],
  },
  screenMetadata: { "file-1": { width: 1280, height: 720 } },
};

async function queryOne<T extends Record<string, unknown>>(
  sql: string,
  args: unknown[] = [],
): Promise<T> {
  const result = await localDb.pglite?.query(sql, args);
  return result?.rows[0] as T;
}

beforeEach(async () => {
  collabState.live.clear();
  await localDb.pglite?.query("DELETE FROM design_files");
  await localDb.pglite?.query("DELETE FROM designs");
  await localDb.pglite?.query(
    "INSERT INTO designs (id, data, updated_at) VALUES ($1, $2, $3)",
    ["design-1", JSON.stringify(designData), "2026-07-09T00:00:00.000Z"],
  );
  await localDb.pglite?.query(
    "INSERT INTO design_files (id, design_id, content, file_type, content_operation_source, content_operation_revision, content_operation_result_hash, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [
      "file-1",
      "design-1",
      managedHtml,
      "html",
      "browser",
      3,
      "old-hash",
      "2026-07-09T00:00:00.000Z",
    ],
  );
});

afterAll(async () => {
  await localDb.pglite?.close();
});

describe("update-breakpoint persistence", () => {
  it("migrates neighboring media bounds atomically and reloads them", async () => {
    const result = await updateBreakpoint.run({
      designId: "design-1",
      breakpointId: "tablet",
      widthPx: 900,
    });

    expect(result).toMatchObject({ updated: true });
    const persistedDesign = await queryOne<{ data: string }>(
      "SELECT data FROM designs WHERE id = $1",
      ["design-1"],
    );
    const persistedFile = await queryOne<{
      content: string;
      content_operation_source: string | null;
      content_operation_revision: number | null;
    }>(
      "SELECT content, content_operation_source, content_operation_revision FROM design_files WHERE id = $1",
      ["file-1"],
    );

    expect(JSON.parse(persistedDesign.data).breakpointSet.breakpoints).toEqual([
      { id: "phone", label: "Phone", widthPx: 390, prefix: "base" },
      { id: "tablet", label: "Tablet", widthPx: 900, prefix: "md" },
    ]);
    expect(
      getBreakpointMediaDeclarations(persistedFile.content, "hero"),
    ).toEqual([
      { maxWidthPx: 1279, nodeId: "hero", property: "left", value: "137px" },
      { maxWidthPx: 899, nodeId: "hero", property: "top", value: "24px" },
    ]);
    expect(persistedFile.content_operation_source).toBeNull();
    expect(persistedFile.content_operation_revision).toBeNull();
  });

  it("migrates interaction-state and exact-range stores with the same width edit", async () => {
    const responsiveHtml = managedHtml.replace(
      "</style></head>",
      `</style>
<style data-agent-native-state-breakpoints>
@media (max-width: 809px) {
  [data-agent-native-node-id="hero"][data-agent-native-node-id="hero"]:hover {
    color: red !important;
  }
}
</style>
<style data-agent-native-breakpoint-range="hero::left::390-809">
@media(max-width:809px) {
  [data-agent-native-node-id="hero"] { left: 24px; }
}
</style></head>`,
    );
    await localDb.pglite?.query(
      "UPDATE design_files SET content = $1 WHERE id = $2",
      [responsiveHtml, "file-1"],
    );

    const result = await updateBreakpoint.run({
      designId: "design-1",
      breakpointId: "tablet",
      widthPx: 900,
    });

    expect(result).toMatchObject({ updated: true });
    const persistedFile = await queryOne<{ content: string }>(
      "SELECT content FROM design_files WHERE id = $1",
      ["file-1"],
    );
    expect(persistedFile.content).toContain(
      '@media (max-width: 899px) {\n  [data-agent-native-node-id="hero"][data-agent-native-node-id="hero"]:hover',
    );
    expect(persistedFile.content).toContain(
      'data-agent-native-breakpoint-range="hero::left::390-899"',
    );
    expect(persistedFile.content).toContain("@media(max-width:899px)");
  });

  it("migrates the lower bound in generated exact-range stores", async () => {
    const exactRangeHtml = managedHtml.replace(
      "</style></head>",
      `</style>
<style data-agent-native-breakpoint-range="hero::left::390-809">
@media (min-width: 390px) and (max-width: 809px) {
  [data-agent-native-node-id="hero"][data-agent-native-node-id="hero"] {
    left: 24px;
  }
}
</style></head>`,
    );
    await localDb.pglite?.query(
      "UPDATE design_files SET content = $1 WHERE id = $2",
      [exactRangeHtml, "file-1"],
    );

    const result = await updateBreakpoint.run({
      designId: "design-1",
      breakpointId: "phone",
      widthPx: 420,
    });

    expect(result).toMatchObject({ updated: true });
    const persistedFile = await queryOne<{ content: string }>(
      "SELECT content FROM design_files WHERE id = $1",
      ["file-1"],
    );
    expect(persistedFile.content).toContain(
      'data-agent-native-breakpoint-range="hero::left::420-809"',
    );
    expect(persistedFile.content).toContain(
      "@media (min-width: 420px) and (max-width: 809px)",
    );
  });

  it("refuses a responsive-store collision without partially updating the design", async () => {
    const collidingHtml = managedHtml.replace(
      "</style></head>",
      `</style>
<style data-agent-native-state-breakpoints>
@media (max-width: 809px) { [data-agent-native-node-id="hero"]:hover { color: red; } }
@media (max-width: 899px) { [data-agent-native-node-id="hero"]:hover { color: blue; } }
</style></head>`,
    );
    await localDb.pglite?.query(
      "UPDATE design_files SET content = $1 WHERE id = $2",
      [collidingHtml, "file-1"],
    );

    const result = await updateBreakpoint.run({
      designId: "design-1",
      breakpointId: "tablet",
      widthPx: 900,
    });

    expect(result).toMatchObject({ updated: false });
    const persistedDesign = await queryOne<{ data: string }>(
      "SELECT data FROM designs WHERE id = $1",
      ["design-1"],
    );
    const persistedFile = await queryOne<{ content: string }>(
      "SELECT content FROM design_files WHERE id = $1",
      ["file-1"],
    );
    expect(JSON.parse(persistedDesign.data)).toEqual(designData);
    expect(persistedFile.content).toBe(collidingHtml);
  });

  it("refuses malformed adjacent stores without partially updating the design", async () => {
    const malformedHtml = managedHtml.replace(
      "</style></head>",
      `</style>
<style data-agent-native-state-breakpoints>
@media (max-width: 809px) { [data-agent-native-node-id="hero"]:hover { color: red; }
</style></head>`,
    );
    await localDb.pglite?.query(
      "UPDATE design_files SET content = $1 WHERE id = $2",
      [malformedHtml, "file-1"],
    );

    const result = await updateBreakpoint.run({
      designId: "design-1",
      breakpointId: "tablet",
      widthPx: 900,
    });

    expect(result).toMatchObject({ updated: false });
    const persistedDesign = await queryOne<{ data: string }>(
      "SELECT data FROM designs WHERE id = $1",
      ["design-1"],
    );
    const persistedFile = await queryOne<{ content: string }>(
      "SELECT content FROM design_files WHERE id = $1",
      ["file-1"],
    );
    expect(JSON.parse(persistedDesign.data)).toEqual(designData);
    expect(persistedFile.content).toBe(malformedHtml);
  });

  it("preserves opaque managed CSS while migrating the media bound", async () => {
    const mixedHtml = managedHtml.replace(
      "@media (max-width: 809px) {\n",
      '@media (max-width: 809px) {\n  /* keep this comment */\n  @supports (display: grid) {\n    .opaque { display: grid; }\n  }\n  [data-custom="opaque"] { color: hotpink; }\n',
    );
    await localDb.pglite?.query(
      "UPDATE design_files SET content = $1 WHERE id = $2",
      [mixedHtml, "file-1"],
    );

    const result = await updateBreakpoint.run({
      designId: "design-1",
      breakpointId: "tablet",
      widthPx: 900,
    });

    expect(result).toMatchObject({ updated: true });
    const persistedFile = await queryOne<{ content: string }>(
      "SELECT content FROM design_files WHERE id = $1",
      ["file-1"],
    );
    expect(persistedFile.content).toContain("@media (max-width: 899px)");
    expect(persistedFile.content).toContain("/* keep this comment */");
    expect(persistedFile.content).toContain("@supports (display: grid)");
    expect(persistedFile.content).toContain(
      '[data-custom="opaque"] { color: hotpink; }',
    );
  });

  it("migrates responsive class bounds wider and preserves unrelated content", async () => {
    const classedHtml = managedHtml
      .replace(
        '<div data-agent-native-node-id="hero">x</div>',
        '<div data-agent-native-node-id="hero" class="max-[809px]:top-6 keep-me max-[1279px]:text-lg">x</div>',
      )
      .replace(
        "</style></head>",
        '</style><style>.opaque::before { content: "max-[809px]:top-6"; }</style></head>',
      );
    await localDb.pglite?.query(
      "UPDATE design_files SET content = $1 WHERE id = $2",
      [classedHtml, "file-1"],
    );

    const result = await updateBreakpoint.run({
      designId: "design-1",
      breakpointId: "tablet",
      widthPx: 900,
    });

    expect(result).toMatchObject({ updated: true });
    const persistedFile = await queryOne<{ content: string }>(
      "SELECT content FROM design_files WHERE id = $1",
      ["file-1"],
    );
    expect(persistedFile.content).toContain(
      'class="max-[899px]:top-6 keep-me max-[1279px]:text-lg"',
    );
    expect(persistedFile.content).toContain('content: "max-[809px]:top-6"');
  });

  it("migrates responsive classes when managed CSS has no affected bound", async () => {
    const classedHtml = managedHtml.replace(
      '<div data-agent-native-node-id="hero">x</div>',
      '<div data-agent-native-node-id="hero" class="max-[809px]:top-6 keep-me">x</div>',
    );
    const classOnlyHtml = injectManagedBreakpointCss(
      classedHtml,
      '@media (max-width: 500px) {\n  [data-custom="opaque"] { color: red; }\n}',
    );
    await localDb.pglite?.query(
      "UPDATE design_files SET content = $1 WHERE id = $2",
      [classOnlyHtml, "file-1"],
    );

    const result = await updateBreakpoint.run({
      designId: "design-1",
      breakpointId: "tablet",
      widthPx: 900,
    });

    expect(result).toMatchObject({ updated: true });
    const persistedFile = await queryOne<{ content: string }>(
      "SELECT content FROM design_files WHERE id = $1",
      ["file-1"],
    );
    expect(persistedFile.content).toContain(
      'class="max-[899px]:top-6 keep-me"',
    );
    expect(persistedFile.content).toContain("@media (max-width: 500px)");
    expect(persistedFile.content).toContain(
      '[data-custom="opaque"] { color: red; }',
    );
  });

  it("migrates responsive class bounds narrower", async () => {
    const classedHtml = managedHtml.replace(
      '<div data-agent-native-node-id="hero">x</div>',
      '<div data-agent-native-node-id="hero" class="max-[809px]:top-6 keep-me max-[1279px]:text-lg">x</div>',
    );
    await localDb.pglite?.query(
      "UPDATE design_files SET content = $1 WHERE id = $2",
      [classedHtml, "file-1"],
    );

    const result = await updateBreakpoint.run({
      designId: "design-1",
      breakpointId: "tablet",
      widthPx: 700,
    });

    expect(result).toMatchObject({ updated: true });
    const persistedFile = await queryOne<{ content: string }>(
      "SELECT content FROM design_files WHERE id = $1",
      ["file-1"],
    );
    expect(persistedFile.content).toContain(
      'class="max-[699px]:top-6 keep-me max-[1279px]:text-lg"',
    );
    expect(persistedFile.content).toContain("@media (max-width: 699px)");
  });

  it("migrates media bounds regardless of at-rule casing", async () => {
    const mixedCaseHtml = managedHtml
      .replace("@media (max-width: 1279px)", "@MEDIA (max-width: 1279px)")
      .replace("@media (max-width: 809px)", "@Media (max-width: 809px)");
    await localDb.pglite?.query(
      "UPDATE design_files SET content = $1 WHERE id = $2",
      [mixedCaseHtml, "file-1"],
    );

    const result = await updateBreakpoint.run({
      designId: "design-1",
      breakpointId: "tablet",
      widthPx: 900,
    });

    expect(result).toMatchObject({ updated: true });
    const persistedFile = await queryOne<{ content: string }>(
      "SELECT content FROM design_files WHERE id = $1",
      ["file-1"],
    );
    expect(persistedFile.content).toContain("@MEDIA (max-width: 1279px)");
    expect(persistedFile.content).toContain("@Media (max-width: 899px)");
  });

  it("rolls back the definition when a managed rule would become base scope", async () => {
    const result = await updateBreakpoint.run({
      designId: "design-1",
      breakpointId: "phone",
      widthPx: 1300,
    });

    expect(result).toMatchObject({ updated: false });
    const persistedDesign = await queryOne<{ data: string }>(
      "SELECT data FROM designs WHERE id = $1",
      ["design-1"],
    );
    const persistedFile = await queryOne<{ content: string }>(
      "SELECT content FROM design_files WHERE id = $1",
      ["file-1"],
    );
    expect(JSON.parse(persistedDesign.data)).toEqual(designData);
    expect(persistedFile.content).toBe(managedHtml);
  });

  it("leaves newer live collaboration content untouched and reports pending reconciliation", async () => {
    const liveContent = managedHtml.replace("top: 24px", "top: 30px");
    collabState.live.set("file-1", liveContent);

    const result = await updateBreakpoint.run({
      designId: "design-1",
      breakpointId: "tablet",
      widthPx: 900,
    });

    expect(result).toMatchObject({
      updated: true,
      collabReconcilePending: ["file-1"],
    });
    expect(collabState.live.get("file-1")).toBe(liveContent);
  });
});
