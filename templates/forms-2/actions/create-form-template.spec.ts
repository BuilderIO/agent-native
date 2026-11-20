import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deriveQuestions } from "../shared/form-model/index.js";
import { as, owner, startTestDb, stopTestDb } from "./_test-context.js";
import createForm from "./create-form.js";
import getForm from "./get-form.js";

describe("create-form from a template", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);

  it("starts a draft named after the template with its questions", async () => {
    const created = await as(owner, () =>
      createForm.run({ templateId: "contact-form" }),
    );
    const form = await as(owner, () => getForm.run({ id: created.id }));
    expect(form.status).toBe("draft");
    expect(form.name).toBe("Get in touch");
    const types = deriveQuestions(form.draftBlocks ?? []).map((q) => q.type);
    expect(types).toContain("INPUT_EMAIL");
  });
});
