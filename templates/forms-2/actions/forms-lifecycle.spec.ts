import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, schema } from "../server/db/index.js";
import { draftSurveyBlocks } from "../shared/form-model/fixtures.js";
import {
  createBlock,
  questionBlocks,
  blankFormBlocks,
} from "../shared/form-model/index.js";
import {
  as,
  owner,
  peer,
  startTestDb,
  stopTestDb,
  stranger,
} from "./_test-context.js";
import createForm from "./create-form.js";
import createWorkspace from "./create-workspace.js";
import deleteForm from "./delete-form.js";
import deleteWorkspace from "./delete-workspace.js";
import discardDraft from "./discard-form-draft.js";
import emptyTrash from "./empty-trash.js";
import getForm from "./get-form.js";
import listForms from "./list-forms.js";
import listTrash from "./list-trash.js";
import listWorkspaces from "./list-workspaces.js";
import publishForm from "./publish-form.js";
import restoreForm from "./restore-form.js";
import restoreItem from "./restore-item.js";
import saveDraft from "./save-form-draft.js";
import updateForm from "./update-form.js";

const lone = { userEmail: "lone@example.test", orgId: "org-lone" };
const list = (formLimit = 0) => listWorkspaces.run({ formLimit });
const forms = (query?: string) =>
  listForms.run({ query, limit: 200, offset: 0 });

describe("form lifecycle", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);

  it("creates one default workspace for concurrent first reads and never recreates it", async () => {
    const reads = await Promise.all([
      as(lone, () => list()),
      as(lone, () => list()),
      as(lone, () => list()),
    ]);
    expect(reads.every((r) => r.workspaces.length === 1)).toBe(true);
    const rows = await getDb().select().from(schema.workspaces);
    expect(rows.filter((r) => r.orgId === "org-lone")).toHaveLength(1);

    const id = reads[0]!.workspaces[0]!.id;
    await as(lone, () => deleteWorkspace.run({ id }));
    const after = await as(lone, () => list());
    expect(after.workspaces).toEqual([]);
  });

  it("hides a form from another organization", async () => {
    const { id } = await as(peer, () => createForm.run({}));
    const seen = await as(peer, () => getForm.run({ id }));
    expect(seen.status).toBe("blank");
    await expect(as(stranger, () => getForm.run({ id }))).rejects.toMatchObject(
      {
        errorCode: "not_found",
      },
    );
    const theirs = await as(stranger, () => forms());
    expect(theirs.forms).toEqual([]);
  });

  it("keeps live blocks while a draft is saved and drops stale saves", async () => {
    const { id } = await as(owner, () => createForm.run({}));
    const first = await as(owner, () =>
      saveDraft.run({ id, blocks: draftSurveyBlocks(), clientTime: 100 }),
    );
    expect(first).toMatchObject({
      saved: true,
      status: "draft",
      name: "Draft survey",
    });
    await as(owner, () => publishForm.run({ id }));

    const edited = draftSurveyBlocks();
    edited[0] = createBlock(
      "FORM_TITLE",
      { text: "New title" },
      { uuid: "form-title" },
    );
    const saved = await as(owner, () =>
      saveDraft.run({ id, blocks: edited, clientTime: 200 }),
    );
    expect(saved).toMatchObject({
      saved: true,
      status: "published",
      hasDraftBlocks: true,
    });
    const stale = await as(owner, () =>
      saveDraft.run({ id, blocks: draftSurveyBlocks(), clientTime: 150 }),
    );
    expect(stale.saved).toBe(false);

    const form = await as(owner, () => getForm.run({ id }));
    expect(form.name).toBe("New title");
    expect(JSON.stringify(form.publishedBlocks)).toContain("Draft survey");
    expect(JSON.stringify(form.draftBlocks)).toContain("New title");
  });

  it("discards a draft back to the published blocks", async () => {
    const { id } = await as(owner, () => createForm.run({}));
    await as(owner, () => publishForm.run({ id, blocks: draftSurveyBlocks() }));
    await as(owner, () =>
      saveDraft.run({
        id,
        blocks: [
          ...draftSurveyBlocks(),
          ...questionBlocks({ type: "TEXTAREA", title: "More" }),
        ],
      }),
    );
    const { blocks } = await as(owner, () => discardDraft.run({ id }));
    expect(blocks).toHaveLength(draftSurveyBlocks().length);
    const form = await as(owner, () => getForm.run({ id }));
    expect(form.draftBlocks).toBeNull();
    expect(form.hasDraftBlocks).toBe(false);
  });

  it("refuses to publish an empty form", async () => {
    const { id } = await as(owner, () => createForm.run({}));
    await expect(
      as(owner, () => publishForm.run({ id, blocks: blankFormBlocks() })),
    ).rejects.toMatchObject({ errorCode: "invalid_input" });
  });

  it("publishes idempotently and marks removed questions deleted", async () => {
    const { id } = await as(owner, () => createForm.run({}));
    const two = [
      ...draftSurveyBlocks(),
      ...questionBlocks({ id: "extra", type: "TEXTAREA", title: "Extra" }),
    ];
    const first = await as(owner, () => publishForm.run({ id, blocks: two }));
    const again = await as(owner, () => publishForm.run({ id, blocks: two }));
    expect(first.firstPublish).toBe(true);
    expect(again.firstPublish).toBe(false);
    expect(again.publishedAt).toBe(first.publishedAt);
    const questions = () =>
      getDb()
        .select()
        .from(schema.questions)
        .where(eq(schema.questions.formId, id));
    expect(await questions()).toHaveLength(2);

    await as(owner, () => publishForm.run({ id, blocks: draftSurveyBlocks() }));
    const rows = await questions();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.blockGroupId === "extra")?.isDeleted).toBe(true);
    expect(rows.find((r) => r.blockGroupId === "draft-name")?.isDeleted).toBe(
      false,
    );
  });

  it("renames, soft deletes and restores a form; search follows", async () => {
    const { id } = await as(owner, () => createForm.run({}));
    await as(owner, () => publishForm.run({ id, blocks: draftSurveyBlocks() }));
    await as(owner, () => updateForm.run({ id, name: "Renamed 100%" }));
    expect(
      (await as(owner, () => forms("renamed 100%"))).forms.map((f) => f.id),
    ).toEqual([id]);
    expect((await as(owner, () => forms("%"))).forms.map((f) => f.id)).toEqual([
      id,
    ]);

    await as(owner, () => deleteForm.run({ id }));
    expect((await as(owner, () => forms("renamed"))).forms).toEqual([]);
    const trash = await as(owner, () => listTrash.run({}));
    expect(trash.items.map((i) => [i.kind, i.id])).toEqual([["form", id]]);

    const restored = await as(owner, () => restoreForm.run({ id }));
    expect(restored.status).toBe("published");
    expect((await as(owner, () => listTrash.run({}))).items).toEqual([]);
  });

  it("restores workspaces through restore-item and purges only trash", async () => {
    const ws = await as(owner, () => createWorkspace.run({ name: "Temp" }));
    const { id } = await as(owner, () =>
      createForm.run({ workspaceId: ws.id }),
    );
    await as(owner, () => deleteWorkspace.run({ id: ws.id }));
    expect(
      (await as(owner, () => listTrash.run({}))).items.map((i) => i.kind),
    ).toEqual(["workspace"]);
    await as(owner, () => restoreItem.run({ kind: "workspace", id: ws.id }));
    expect(
      (await as(owner, () => forms())).forms.some((f) => f.id === id),
    ).toBe(true);

    await as(owner, () => deleteForm.run({ id }));
    const purged = await as(owner, () => emptyTrash.run({}));
    expect(purged.purged).toBe(1);
    await expect(as(owner, () => getForm.run({ id }))).rejects.toMatchObject({
      errorCode: "not_found",
    });
    expect(
      (await as(owner, () => list(10))).workspaces.some((w) => w.id === ws.id),
    ).toBe(true);
  });
});
