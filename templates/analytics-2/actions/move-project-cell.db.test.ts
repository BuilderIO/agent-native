import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { createProject } from "../server/model/projects-store.js";
import moveProjectCell from "./move-project-cell.js";

const round = mkdtempSync(join(tmpdir(), "move-cell-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "move-owner@example.test";
const orgId = `qa-move-${randomUUID()}`;
const context = {
  caller: "frontend" as const,
  userEmail: owner,
  orgId,
  appId: "analytics-2",
};

function asActor<T>(call: () => T) {
  return runWithRequestContext(
    {
      userEmail: owner,
      orgId,
      authUserId: owner,
      userName: "QA move",
      isSyntheticTraffic: true,
    },
    call,
  );
}

const markdown = (text: string) => ({
  kind: "markdown" as const,
  markdown: text,
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
});

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_move_cell_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA move",
    createdBy: owner,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: owner,
    role: "owner",
    joinedAt: Date.now(),
  });
  await getDb().insert(appMemberRoles).values({
    id: randomUUID(),
    orgId,
    email: owner,
    appId: "analytics-2",
    role: "owner",
    updatedBy: owner,
    updatedAt: Date.now(),
  });
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round),
    temporary = resolve(tmpdir());
  if (
    owned !== temporary &&
    owned !== resolve(process.cwd()) &&
    owned.startsWith(temporary + "/move-cell-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

describe("move-project-cell", () => {
  it("moves a cell down and back up, and does nothing at an end", async () => {
    const scope = { ownerEmail: owner, orgId };
    const project = await createProject({
      ...scope,
      title: "QA move cells",
      cells: [markdown("one"), markdown("two"), markdown("three")],
    });
    const [first, second, third] = project.cells.map((cell) => cell.id);
    if (first == null || second == null || third == null) {
      throw new Error("fixture cells missing");
    }
    const texts = (cells: { contents: { kind: string } }[]) =>
      cells.map((cell) =>
        cell.contents.kind === "markdown"
          ? (cell.contents as { markdown: string }).markdown
          : "",
      );

    const movedDown = await asActor(() =>
      moveProjectCell.run(
        { projectId: project.id, cellId: first, direction: "down" },
        context,
      ),
    );
    expect(texts(movedDown.project.cells)).toEqual(["two", "one", "three"]);

    const movedUp = await asActor(() =>
      moveProjectCell.run(
        { projectId: project.id, cellId: first, direction: "up" },
        context,
      ),
    );
    expect(texts(movedUp.project.cells)).toEqual(["one", "two", "three"]);

    const atTop = await asActor(() =>
      moveProjectCell.run(
        { projectId: project.id, cellId: first, direction: "up" },
        context,
      ),
    );
    expect(texts(atTop.project.cells)).toEqual(["one", "two", "three"]);

    const atBottom = await asActor(() =>
      moveProjectCell.run(
        { projectId: project.id, cellId: third, direction: "down" },
        context,
      ),
    );
    expect(texts(atBottom.project.cells)).toEqual(["one", "two", "three"]);
  });
  it("moves a cell to any drop target in one write and rejects bad targets", async () => {
    const scope = { ownerEmail: owner, orgId };
    const project = await createProject({
      ...scope,
      title: "QA drag cells",
      cells: [
        markdown("one"),
        markdown("two"),
        markdown("three"),
        markdown("four"),
      ],
    });
    expect(project.cells).toHaveLength(4);
    const [one, two, three, four] = project.cells.map((cell) => cell.id) as [
      string,
      string,
      string,
      string,
    ];
    const texts = (cells: { contents: { kind: string } }[]) =>
      cells.map((cell) =>
        cell.contents.kind === "markdown"
          ? (cell.contents as { markdown: string }).markdown
          : "",
      );
    const drop = (cellId: string, targetId: string, placement: string) =>
      asActor(() =>
        moveProjectCell.run(
          {
            projectId: project.id,
            cellId,
            target: { cellId: targetId, placement },
          } as never,
          context,
        ),
      );

    expect(texts((await drop(one, four, "after")).project.cells)).toEqual([
      "two",
      "three",
      "four",
      "one",
    ]);
    expect(texts((await drop(one, two, "before")).project.cells)).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
    expect(texts((await drop(four, two, "before")).project.cells)).toEqual([
      "one",
      "four",
      "two",
      "three",
    ]);
    // Dropping a cell beside the place it already holds changes nothing.
    expect(texts((await drop(four, two, "before")).project.cells)).toEqual([
      "one",
      "four",
      "two",
      "three",
    ]);
    expect(texts((await drop(four, one, "after")).project.cells)).toEqual([
      "one",
      "four",
      "two",
      "three",
    ]);
    await expect(drop(four, four, "after")).rejects.toThrow();
    await expect(drop(four, "missing-cell", "after")).rejects.toThrow();
    await expect(drop("missing-cell", one, "after")).rejects.toThrow();
    await expect(
      asActor(() =>
        moveProjectCell.run(
          {
            projectId: project.id,
            cellId: one,
            direction: "down",
            target: { cellId: two, placement: "after" },
          } as never,
          context,
        ),
      ),
    ).rejects.toThrow();
    expect(three).toBeDefined();
  });
});

describe("move-project-cell input schema", () => {
  const schema = (moveProjectCell as unknown as { schema: z.ZodType }).schema;

  it("emits a flat object root for MCP and providers", () => {
    expect(schema).toBeDefined();
    const json = z.toJSONSchema(schema) as { type?: string };
    expect(json.type).toBe("object");
    expect(moveProjectCell.tool.parameters?.type).toBe("object");
  });

  it("accepts exactly one of direction or target", () => {
    const base = { projectId: "p", cellId: "a" };
    const target = { cellId: "b", placement: "after" };
    expect(schema.safeParse({ ...base, direction: "up" }).success).toBe(true);
    expect(schema.safeParse({ ...base, target }).success).toBe(true);
    expect(schema.safeParse(base).success).toBe(false);
    expect(schema.safeParse({ ...base, direction: "up", target }).success).toBe(
      false,
    );
  });
});
