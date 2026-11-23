import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "@agent-native/core/db/schema";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { seedLegacyPublishedProject } from "./legacy-published-fixture.test-support.js";

const databasePath = join(
  tmpdir(),
  `analytics2-embed-${process.pid}-${Date.now()}.pglite`,
);
const previousDatabaseUrl = process.env.DATABASE_URL;
const owner = "owner@example.test";
const otherOwner = "other@example.test";
const orgId = "org-embed-test";
const otherOrgId = "org-embed-other";
const scope = { ownerEmail: owner, orgId };

const activeWorkspace = vi.hoisted(() => ({
  current: { ownerEmail: "owner@example.test", orgId: "org-embed-test" },
}));

vi.mock("../lib/workspace-access.js", () => ({
  requireCurrentWorkspace: async () => activeWorkspace.current,
}));

vi.mock("../lib/analytics-capabilities.js", () => ({
  ANALYTICS_CONTROL_IDS: {
    manageAppSharing: "analytics.app.manage-sharing",
  },
  requireCapability: async () => {},
}));

let projectsStore: typeof import("./projects-store.js");
let projectViews: typeof import("./project-views.js");
let appEmbedding: typeof import("./app-embedding.js");
let dbModule: typeof import("../db/index.js");
let schemaModule: typeof import("../db/schema.js");

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${databasePath}`;
  await (await import("../plugins/db.js")).default();
  projectsStore = await import("./projects-store.js");
  projectViews = await import("./project-views.js");
  appEmbedding = await import("./app-embedding.js");
  dbModule = await import("../db/index.js");
  schemaModule = await import("../db/schema.js");
}, 180_000);

afterAll(async () => {
  try {
    await (await import("@agent-native/core/db")).closeDbExec();
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    rmSync(databasePath, { recursive: true, force: true });
  }
});

describe("app signed embedding", () => {
  it("persists allowEmbedding, issues signed presigned embed URLs, verifies attributes, and revokes on disable", async () => {
    activeWorkspace.current = scope;
    const created = await projectsStore.createProject({
      ...scope,
      title: "Signed Embed Analytics App",
      cells: [],
    });

    const initial = await appEmbedding.getProjectEmbeddingSettings({
      projectId: created.id,
    });
    expect(initial.allowEmbedding).toBe(false);
    expect(initial.published).toBe(false);
    expect(initial.canManageEmbedding).toBe(true);
    expect(initial.appHref).toBeNull();

    await expect(
      appEmbedding.createPresignedEmbedUrl({
        projectId: created.id,
        expiresInSeconds: 600,
        userAttributes: { region: "us-west" },
      }),
    ).rejects.toThrow();

    const enabledUnpublished = await appEmbedding.setProjectEmbeddingSettings({
      projectId: created.id,
      allowEmbedding: true,
    });
    expect(enabledUnpublished.allowEmbedding).toBe(true);

    await expect(
      appEmbedding.createPresignedEmbedUrl({
        projectId: created.id,
        expiresInSeconds: 600,
        userAttributes: {},
      }),
    ).rejects.toThrow();

    await seedLegacyPublishedProject(scope, created.id);
    await projectViews.recordProjectView(scope, created.id, owner, "app");

    const listed = await projectsStore.listProjects(scope);
    expect(listed.find((p) => p.id === created.id)?.allowEmbedding).toBe(true);

    const popular = await projectViews.listPopularProjects(scope);
    expect(popular.find((p) => p.id === created.id)?.allowEmbedding).toBe(true);

    const afterPublish = await appEmbedding.getProjectEmbeddingSettings({
      projectId: created.id,
    });
    expect(afterPublish.published).toBe(true);
    expect(afterPublish.allowEmbedding).toBe(true);
    expect(afterPublish.appHref).toContain(`/app/${created.id}/latest`);

    const issued = await appEmbedding.createPresignedEmbedUrl({
      projectId: created.id,
      expiresInSeconds: 900,
      userAttributes: { tier: "enterprise", seatCount: 12, active: true },
    });
    expect(issued.embedPath).toContain(`/app/${created.id}/latest?embedded=true&embedToken=`);
    expect(issued.userAttributes).toEqual({
      tier: "enterprise",
      seatCount: 12,
      active: true,
    });

    const storedRows = await dbModule
      .getDb()
      .select()
      .from(schemaModule.signedEmbedTokens)
      .where(eq(schemaModule.signedEmbedTokens.id, issued.id));
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]?.tokenHash).not.toBe(issued.token);
    expect(storedRows[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    const verified = await appEmbedding.verifyPresignedEmbedToken({
      projectId: created.id,
      token: issued.token,
    });
    expect(verified.valid).toBe(true);
    expect(verified.reason).toBe("ok");
    expect(verified.userAttributes).toEqual({
      tier: "enterprise",
      seatCount: 12,
      active: true,
    });

    const tampered = await appEmbedding.verifyPresignedEmbedToken({
      projectId: created.id,
      token: `${issued.token.slice(0, -1)}${issued.token.endsWith("a") ? "b" : "a"}`,
    });
    expect(tampered.valid).toBe(false);
    expect(tampered.reason).toBe("invalid");

    const otherProject = await projectsStore.createProject({
      ownerEmail: otherOwner,
      orgId: otherOrgId,
      title: "Other Org App",
      cells: [],
    });
    const wrongProject = await appEmbedding.verifyPresignedEmbedToken({
      projectId: otherProject.id,
      token: issued.token,
    });
    expect(wrongProject.valid).toBe(false);
    expect(wrongProject.reason).toBe("invalid");

    await dbModule
      .getDb()
      .update(schemaModule.signedEmbedTokens)
      .set({ expiresAt: "2020-01-01T00:00:00.000Z" })
      .where(eq(schemaModule.signedEmbedTokens.id, issued.id));
    const expired = await appEmbedding.verifyPresignedEmbedToken({
      projectId: created.id,
      token: issued.token,
    });
    expect(expired.valid).toBe(false);
    expect(expired.reason).toBe("expired");

    const freshIssued = await appEmbedding.createPresignedEmbedUrl({
      projectId: created.id,
      expiresInSeconds: 900,
      userAttributes: { role: "analyst" },
    });
    await appEmbedding.setProjectEmbeddingSettings({
      projectId: created.id,
      allowEmbedding: false,
    });
    const afterDisable = await appEmbedding.verifyPresignedEmbedToken({
      projectId: created.id,
      token: freshIssued.token,
    });
    expect(afterDisable.valid).toBe(false);
    expect(afterDisable.reason).toBe("disabled");

    await appEmbedding.setProjectEmbeddingSettings({
      projectId: created.id,
      allowEmbedding: true,
    });
    const afterReenable = await appEmbedding.verifyPresignedEmbedToken({
      projectId: created.id,
      token: freshIssued.token,
    });
    expect(afterReenable.valid).toBe(false);
    expect(afterReenable.reason).toBe("revoked");
  });
});
