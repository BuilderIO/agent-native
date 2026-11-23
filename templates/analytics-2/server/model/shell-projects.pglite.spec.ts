import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { getDb, schema } from "../db/index.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { listProjects } from "./projects-store.js";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "analytics-shell-projects-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(dir, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await ensureAnalyticsDatabase();
});
afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

it("returns ten recent projects and all active favorites, including older favorites", async () => {
  const scope = { ownerEmail: "shell@example.test", orgId: "shell-org" };
  const base = {
    ...scope,
    visibility: "private" as const,
    description: "unused description ".repeat(500),
    language: "python" as const,
    workingVersionId: "v",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const rows = Array.from({ length: 130 }, (_, i) => ({
    ...base,
    id: `prj-${String(i).padStart(3, "0")}`,
    title: i < 45 ? "Repeated title" : `Project ${i}`,
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 130 - i)).toISOString(),
    lastOpenedAt: i === 110 ? "2027-01-01T00:00:00.000Z" : null,
    favorited: i >= 115,
    archivedAt: i === 116 ? "2026-02-01T00:00:00.000Z" : null,
  }));
  await getDb()
    .insert(schema.projects)
    .values([
      ...rows,
      {
        ...base,
        id: "other-owner",
        ownerEmail: "other@example.test",
        title: "Other",
        updatedAt: "2030-01-01T00:00:00.000Z",
        favorited: true,
      },
    ]);
  const full = (await listProjects(scope)).filter(
    (project) => !project.archivedAt,
  );
  const { readShellProjects } = await import("./shell-projects.js");
  const selected = await readShellProjects(scope);
  expect(selected.recent).toHaveLength(10);
  expect(selected.recent[0]).toMatchObject({
    favorited: false,
    publishedVersionId: null,
  });
  expect(selected.recent.map((row) => row.id)).toEqual(
    [...full]
      .sort(
        (a, b) =>
          (b.lastOpenedAt ?? b.updatedAt).localeCompare(
            a.lastOpenedAt ?? a.updatedAt,
          ) || a.id.localeCompare(b.id),
      )
      .slice(0, 10)
      .map((row) => row.id),
  );
  expect(selected.favorites).toHaveLength(14);
  expect(selected.favorites.map((p) => p.id)).toEqual(
    full.filter((p) => p.favorited).map((p) => p.id),
  );
  expect(Object.keys(selected.recent[0] ?? {}).sort()).toEqual([
    "favorited",
    "id",
    "lastOpenedAt",
    "publishedVersionId",
    "title",
    "updatedAt",
  ]);
  expect(JSON.stringify(selected.recent).length).toBeLessThan(
    JSON.stringify(full).length / 10,
  );
});

it("breaks timestamp ties by project ID before applying the recent limit", async () => {
  const scope = { ownerEmail: "ties@example.test", orgId: "shell-org" };
  const timestamp = "2026-01-01T00:00:00.000Z";
  await getDb()
    .insert(schema.projects)
    .values(
      Array.from({ length: 70 }, (_, i) => ({
        ...scope,
        id: `tie-${String(i).padStart(3, "0")}`,
        title: `Tie ${i}`,
        workingVersionId: "v",
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    );
  const { readShellProjects } = await import("./shell-projects.js");
  const { recent } = await readShellProjects(scope);
  expect(recent.map((row) => row.id)).toEqual(
    Array.from({ length: 10 }, (_, i) => `tie-00${i}`),
  );
});
