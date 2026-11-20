import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "../server/db/index.js";
import {
  draftSurveyBlocks,
  singlePageBlocks,
} from "../shared/form-model/fixtures.js";
import {
  as,
  owner,
  startTestDb,
  stopTestDb,
  stranger,
} from "./_test-context.js";
import { MAX_VERSIONS } from "./_versions.js";
import createFolder from "./create-folder.js";
import createForm from "./create-form.js";
import createWorkspace from "./create-workspace.js";
import deleteFolder from "./delete-folder.js";
import getFormVersion from "./get-form-version.js";
import listFormVersions from "./list-form-versions.js";
import listForms from "./list-forms.js";
import listTrash from "./list-trash.js";
import listWorkspaces from "./list-workspaces.js";
import moveForm from "./move-form.js";
import publishForm from "./publish-form.js";
import reorderForms from "./reorder-forms.js";
import restoreFormVersion from "./restore-form-version.js";
import restoreItem from "./restore-item.js";
import saveDraft from "./save-form-draft.js";
import updateFormSettings from "./update-form-settings.js";

const inFolder = (workspaceId: string, folderId: string) =>
  listForms.run({ workspaceId, folderId, limit: 50, offset: 0 });

describe("folders and order", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);

  it("moves a form into a folder and out of the workspace's top level", async () => {
    const { id: workspaceId } = await as(owner, () =>
      createWorkspace.run({ name: "Lab" }),
    );
    const { id: folderId } = await as(owner, () =>
      createFolder.run({ workspaceId, name: "Reports" }),
    );
    const { id } = await as(owner, () => createForm.run({ workspaceId }));
    await as(owner, () => moveForm.run({ id, workspaceId, folderId }));

    const root = await as(owner, () =>
      listForms.run({ workspaceId, folderId: "root", limit: 50, offset: 0 }),
    );
    expect(root.forms).toEqual([]);
    const inside = await as(owner, () => inFolder(workspaceId, folderId));
    expect(inside.forms.map((form) => form.id)).toEqual([id]);

    const { workspaces } = await as(owner, () =>
      listWorkspaces.run({ formLimit: 5 }),
    );
    const lab = workspaces.find((workspace) => workspace.id === workspaceId);
    expect(lab?.folders).toMatchObject([{ id: folderId, formCount: 1 }]);
    expect(lab?.forms).toEqual([]);

    await as(owner, () => moveForm.run({ id, workspaceId }));
    const after = await as(owner, () => inFolder(workspaceId, folderId));
    expect(after.forms).toEqual([]);
  });

  it("refuses a folder from another workspace or organization", async () => {
    const { id: a } = await as(owner, () => createWorkspace.run({ name: "A" }));
    const { id: b } = await as(owner, () => createWorkspace.run({ name: "B" }));
    const { id: folderId } = await as(owner, () =>
      createFolder.run({ workspaceId: a, name: "Only in A" }),
    );
    const { id } = await as(owner, () => createForm.run({ workspaceId: b }));
    await expect(
      as(owner, () => moveForm.run({ id, workspaceId: b, folderId })),
    ).rejects.toMatchObject({ errorCode: "not_found" });
    await expect(
      as(stranger, () => createFolder.run({ workspaceId: a, name: "x" })),
    ).rejects.toMatchObject({ errorCode: "not_found" });
  });

  it("deleting a folder trashes it, returns its forms to the top level, and restore brings it back", async () => {
    const { id: workspaceId } = await as(owner, () =>
      createWorkspace.run({ name: "Trash lab" }),
    );
    const { id: folderId } = await as(owner, () =>
      createFolder.run({ workspaceId, name: "Old" }),
    );
    const { id } = await as(owner, () =>
      createForm.run({ workspaceId, folderId }),
    );
    await as(owner, () => deleteFolder.run({ id: folderId }));

    const root = await as(owner, () =>
      listForms.run({ workspaceId, folderId: "root", limit: 50, offset: 0 }),
    );
    expect(root.forms.map((form) => form.id)).toEqual([id]);
    const trash = await as(owner, () => listTrash.run({}));
    expect(trash.items).toContainEqual(
      expect.objectContaining({ kind: "folder", id: folderId }),
    );

    await as(owner, () => restoreItem.run({ kind: "folder", id: folderId }));
    const { workspaces } = await as(owner, () =>
      listWorkspaces.run({ formLimit: 0 }),
    );
    expect(
      workspaces.find((workspace) => workspace.id === workspaceId)?.folders,
    ).toMatchObject([{ id: folderId, formCount: 0 }]);
  });

  it("persists a manual order that new reads return", async () => {
    const { id: workspaceId } = await as(owner, () =>
      createWorkspace.run({ name: "Ordered" }),
    );
    const ids: string[] = [];
    for (let i = 0; i < 3; i++)
      ids.push((await as(owner, () => createForm.run({ workspaceId }))).id);
    const wanted = [ids[2]!, ids[0]!, ids[1]!];
    await as(owner, () => reorderForms.run({ workspaceId, formIds: wanted }));
    const read = await as(owner, () =>
      listForms.run({ workspaceId, limit: 50, offset: 0 }),
    );
    expect(read.forms.map((form) => form.id)).toEqual(wanted);
  });
});

describe("version history", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);

  const versions = (formId: string) =>
    as(owner, () => listFormVersions.run({ formId }));

  it("snapshots every publish and restoring leaves the published blocks alone", async () => {
    const { id } = await as(owner, () => createForm.run({}));
    await as(owner, () => publishForm.run({ id, blocks: draftSurveyBlocks() }));
    await as(owner, () => publishForm.run({ id, blocks: singlePageBlocks() }));
    const { versions: list } = await versions(id);
    expect(list.map((version) => version.kind)).toEqual(["publish", "publish"]);
    expect(list[0]?.author).toBe(owner.userEmail);

    const older = list[1];
    if (!older) throw new Error("expected two versions");
    const restored = await as(owner, () =>
      restoreFormVersion.run({ formId: id, versionId: older.id }),
    );
    expect(restored.saved).toBe(true);
    const [row] = await getDb()
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.id, id));
    expect(row?.draftBlocks).toEqual(draftSurveyBlocks());
    expect(row?.publishedBlocks).toEqual(singlePageBlocks());
    const read = await as(owner, () =>
      getFormVersion.run({ formId: id, versionId: older.id }),
    );
    expect(read.blocks).toEqual(draftSurveyBlocks());
  });

  it("restores the versioned settings exactly and leaves the others alone", async () => {
    const { id } = await as(owner, () => createForm.run({}));
    await as(owner, () =>
      updateFormSettings.run({
        id,
        settings: { progressBar: true, password: "one" },
      }),
    );
    await as(owner, () => publishForm.run({ id, blocks: draftSurveyBlocks() }));
    await as(owner, () =>
      updateFormSettings.run({
        id,
        settings: { autoJump: true, password: "two" },
      }),
    );
    await as(owner, () => publishForm.run({ id, blocks: singlePageBlocks() }));
    const { versions: list } = await versions(id);
    const older = list[1];
    if (!older) throw new Error("expected two versions");
    await as(owner, () =>
      restoreFormVersion.run({ formId: id, versionId: older.id }),
    );
    const [row] = await getDb()
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.id, id));
    expect(row?.settings).toEqual({ progressBar: true, password: "two" });
  });

  it("publishing unchanged blocks again adds no version", async () => {
    const { id } = await as(owner, () => createForm.run({}));
    await as(owner, () => publishForm.run({ id, blocks: draftSurveyBlocks() }));
    await as(owner, () => publishForm.run({ id, blocks: draftSurveyBlocks() }));
    expect((await versions(id)).versions).toHaveLength(1);
  });

  it("merges autosaves within five minutes, then starts a new version, and never touches a publish snapshot", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      const { id } = await as(owner, () => createForm.run({}));
      const save = (clientTime: number, blocks = draftSurveyBlocks()) =>
        as(owner, () => saveDraft.run({ id, blocks, clientTime }));
      await save(1);
      vi.setSystemTime(new Date("2026-01-01T10:03:00Z"));
      await save(2, singlePageBlocks());
      let list = (await versions(id)).versions;
      expect(list.map((version) => version.kind)).toEqual(["autosave"]);

      vi.setSystemTime(new Date("2026-01-01T10:06:00Z"));
      await save(3);
      list = (await versions(id)).versions;
      expect(list.map((version) => version.kind)).toEqual([
        "autosave",
        "autosave",
      ]);

      vi.setSystemTime(new Date("2026-01-01T10:07:00Z"));
      await as(owner, () =>
        publishForm.run({ id, blocks: singlePageBlocks() }),
      );
      vi.setSystemTime(new Date("2026-01-01T10:08:00Z"));
      await save(4, singlePageBlocks());
      list = (await versions(id)).versions;
      expect(list.map((version) => version.kind)).toEqual([
        "publish",
        "autosave",
        "autosave",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps at most 50 versions, dropping the oldest", async () => {
    const { id } = await as(owner, () => createForm.run({}));
    for (let i = 0; i < MAX_VERSIONS + 3; i++)
      await as(owner, () =>
        publishForm.run({
          id,
          blocks: i % 2 ? draftSurveyBlocks() : singlePageBlocks(),
        }),
      );
    expect((await versions(id)).versions).toHaveLength(MAX_VERSIONS);
  });
});
