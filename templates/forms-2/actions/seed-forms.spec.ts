import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedForms } from "../scripts/seed-forms.js";
import { as, owner, startTestDb, stopTestDb } from "./_test-context.js";
import getPublicForm from "./get-public-form.js";
import listSubmissions from "./list-submissions.js";
import listWorkspaces from "./list-workspaces.js";

describe("seed-forms", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);

  it("creates the fixture set and replaces it on a second run", async () => {
    await seedForms(owner, { fresh: false });
    await seedForms(owner, { fresh: false });
    const { workspaces } = await as(owner, () =>
      listWorkspaces.run({ formLimit: 50 }),
    );
    expect(workspaces.slice(0, 2).map((w) => [w.name, w.formCount])).toEqual([
      ["Studio", 10],
      ["Ops", 1],
    ]);
    const open = await getPublicForm.run({ formId: "fixture-pages" });
    expect(open.state).toBe("open");
    expect(await getPublicForm.run({ formId: "fixture-closed" })).toMatchObject(
      { state: "closed" },
    );
    expect(await getPublicForm.run({ formId: "fixture-unpublished" })).toEqual({
      state: "unavailable",
    });
    const results = await as(owner, () =>
      listSubmissions.run({
        formId: "fixture-event-feedback",
        filter: "all",
        limit: 100,
        offset: 0,
      }),
    );
    expect(results.counts).toEqual({ all: 3, completed: 2, partial: 1 });
    expect(results.questions.at(-1)).toMatchObject({
      title: "Favorite snack",
      isDeleted: true,
    });
  });

  it("leaves only an empty default workspace for the fresh fixture", async () => {
    await seedForms(owner, { fresh: true });
    const { workspaces } = await as(owner, () =>
      listWorkspaces.run({ formLimit: 5 }),
    );
    expect(workspaces.map((w) => [w.name, w.formCount])).toEqual([
      ["My workspace", 0],
    ]);
  });
});
