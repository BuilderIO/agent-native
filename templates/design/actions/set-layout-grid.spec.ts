import { closeDbExec, type DbExec } from "@agent-native/core/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  agentToolContext,
  bootDesignDatabase,
  runCall,
  seedDesign,
} from "../server/lib/failed-write-test-harness.js";
import { BOARD_FILENAME } from "../shared/board-file.js";
import action from "./set-layout-grid.js";

describe("set-layout-grid schema", () => {
  const base = { designId: "design_1", screenId: "screen_1" };

  it("accepts a size, a visibility change, and a removal", () => {
    expect(action.schema.safeParse({ ...base, size: 8 }).success).toBe(true);
    expect(action.schema.safeParse({ ...base, visible: false }).success).toBe(
      true,
    );
    expect(action.schema.safeParse({ ...base, remove: true }).success).toBe(
      true,
    );
  });

  it("takes designId and screenId, since grids are per-screen", () => {
    expect(action.schema.safeParse({ screenId: "screen_1" }).success).toBe(
      false,
    );
    expect(action.schema.safeParse({ designId: "design_1" }).success).toBe(
      false,
    );
  });

  it("bounds size to the supported whole-pixel range", () => {
    expect(action.schema.safeParse({ ...base, size: 0 }).success).toBe(false);
    expect(action.schema.safeParse({ ...base, size: 1 }).success).toBe(true);
    expect(action.schema.safeParse({ ...base, size: 1000 }).success).toBe(true);
    expect(action.schema.safeParse({ ...base, size: 1001 }).success).toBe(
      false,
    );
    expect(action.schema.safeParse({ ...base, size: 8.5 }).success).toBe(false);
  });

  it("teaches the agent to author positions on the grid's multiples", () => {
    expect(action.tool.description).toMatch(/multiples of its size/);
  });
});

describe("set-layout-grid run", () => {
  let exec: DbExec;
  let counter = 0;

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory://");
    vi.stubEnv("DATABASE_URL_UNPOOLED", "pglite:memory://");
    vi.stubEnv("DESIGN_DATABASE_URL", "pglite:memory://");
    vi.stubEnv("DESIGN_DATABASE_URL_UNPOOLED", "pglite:memory://");
    exec = await bootDesignDatabase();
  });

  afterAll(async () => {
    await closeDbExec();
    vi.unstubAllEnvs();
  });

  /** A design with one real screen, plus a board file and a CSS file that are not screens. */
  async function seedScreens(layoutGrids?: Record<string, unknown>): Promise<{
    designId: string;
    screenId: string;
    boardId: string;
    cssId: string;
  }> {
    const designId = `grid-${++counter}`;
    await seedDesign(exec, designId, [
      { filename: "index.html", content: "<main>Home</main>" },
      { filename: BOARD_FILENAME, content: "<body></body>" },
    ]);
    const cssId = `${designId}:styles.css`;
    await exec.execute({
      sql: "INSERT INTO design_files (id, design_id, filename, file_type, content) VALUES (?, ?, ?, 'css', ?)",
      args: [cssId, designId, "styles.css", "main { margin: 0; }"],
    });
    if (layoutGrids) {
      await exec.execute({
        sql: "UPDATE designs SET data = ? WHERE id = ?",
        args: [JSON.stringify({ layoutGrids }), designId],
      });
    }
    return {
      designId,
      screenId: `${designId}:index.html`,
      boardId: `${designId}:${BOARD_FILENAME}`,
      cssId,
    };
  }

  async function storedDesign(
    designId: string,
  ): Promise<{ data: string; updatedAt: unknown }> {
    const { rows } = await exec.execute({
      sql: "SELECT data, updated_at FROM designs WHERE id = ?",
      args: [designId],
    });
    return { data: String(rows[0]?.data), updatedAt: rows[0]?.updated_at };
  }

  async function storedGrids(designId: string): Promise<unknown> {
    const { data } = await storedDesign(designId);
    return (JSON.parse(data) as { layoutGrids?: unknown }).layoutGrids;
  }

  function setGrid(args: Record<string, unknown>) {
    return runCall(action, args, agentToolContext("set-layout-grid"));
  }

  /** Refused calls must leave the design row exactly as it was. */
  async function expectRefused(
    designId: string,
    screenId: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const before = await storedDesign(designId);
    const { error, result, effect } = await setGrid({
      designId,
      screenId,
      ...extra,
    });
    expect(result).toBeUndefined();
    expect(error).toMatchObject({
      errorCode: "screen_not_found",
      statusCode: 404,
      noWrite: true,
    });
    expect(effect).toMatchObject({ effect: "none" });
    expect(await storedDesign(designId)).toEqual(before);
  }

  it("writes a grid for a real screen", async () => {
    const { designId, screenId } = await seedScreens();

    const { error, result } = await setGrid({ designId, screenId, size: 16 });

    expect(error).toBeUndefined();
    expect(result).toEqual({
      screenId,
      grid: { kind: "uniform", size: 16, visible: true },
      removed: false,
    });
    expect(await storedGrids(designId)).toEqual({
      [screenId]: { kind: "uniform", size: 16, visible: true },
    });
  });

  it("refuses the design id and writes no orphan entry", async () => {
    const { designId } = await seedScreens();

    await expectRefused(designId, designId, { size: 8 });
  });

  it("refuses a filename, which is not a screen id", async () => {
    const { designId } = await seedScreens();

    await expectRefused(designId, "index.html", { size: 8 });
  });

  it("refuses a screen id that belongs to another design", async () => {
    const { designId } = await seedScreens();
    const other = await seedScreens();

    await expectRefused(designId, other.screenId, { size: 8 });
    expect(await storedGrids(other.designId)).toBeUndefined();
  });

  it("refuses the board file and a non-HTML file", async () => {
    const { designId, boardId, cssId } = await seedScreens();

    await expectRefused(designId, boardId, { size: 8 });
    await expectRefused(designId, cssId, { size: 8 });
  });

  it("refuses to remove a grid from an id that never had one", async () => {
    const { designId } = await seedScreens();

    await expectRefused(designId, designId, { remove: true });
    await expectRefused(designId, "constructor", { remove: true });
  });

  it("removes an existing orphan grid so earlier wrong ids can be cleaned up", async () => {
    const orphan = { kind: "uniform", size: 8, visible: true };
    const { designId, screenId } = await seedScreens();
    const real = { kind: "uniform", size: 4, visible: false };
    await exec.execute({
      sql: "UPDATE designs SET data = ? WHERE id = ?",
      args: [
        JSON.stringify({
          layoutGrids: { "grid-orphan": orphan, [screenId]: real },
        }),
        designId,
      ],
    });

    const { error, result } = await setGrid({
      designId,
      screenId: "grid-orphan",
      remove: true,
    });

    expect(error).toBeUndefined();
    expect(result).toEqual({
      screenId: "grid-orphan",
      grid: null,
      removed: true,
    });
    expect(await storedGrids(designId)).toEqual({ [screenId]: real });
  });

  it("still refuses to set a grid on an id that already holds an orphan", async () => {
    const { designId } = await seedScreens({
      "grid-orphan": { kind: "uniform", size: 8, visible: true },
    });

    await expectRefused(designId, "grid-orphan", { size: 24 });
  });

  it("removes a real screen's grid and leaves other screens' grids alone", async () => {
    const { designId, screenId } = await seedScreens();
    await setGrid({ designId, screenId, size: 8 });

    const { error, result } = await setGrid({
      designId,
      screenId,
      remove: true,
    });

    expect(error).toBeUndefined();
    expect(result).toEqual({ screenId, grid: null, removed: true });
    expect(await storedGrids(designId)).toEqual({});
  });
});
